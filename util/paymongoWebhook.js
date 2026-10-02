// PayMongo webhook handler — confirms a booking after a paid Hosted Checkout session.

const crypto = require('crypto');
const { GroomingAppointment, HotelReservation } = require('../models');
const { sendBookingConfirmation } = require('./mailer');
const { sendBookingSms } = require('./sms');

const isValidSignature = (rawBody, signature, secret) => {
  if (!Buffer.isBuffer(rawBody) || !secret || !/^[a-f\d]{64}$/i.test(String(signature || ''))) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const supplied = String(signature);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
};

const handlePayMongoWebhook = async (req, res) => {
  try {
    const secret = process.env.PAYMONGO_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ error: 'Webhook verification is not configured.' });
    if (!isValidSignature(req.rawBody, req.headers['paymongo-signature'], secret)) {
      return res.status(401).json({ error: 'Invalid webhook signature.' });
    }

    const eventAttributes = req.body?.data?.attributes;
    if (!eventAttributes || !eventAttributes.type) {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    if (eventAttributes.type !== 'checkout_session.payment.paid') {
      return res.json({ received: true, skipped: true });
    }

    const checkoutSession = eventAttributes.data;
    const attributes = checkoutSession && checkoutSession.attributes;
    const metadata = attributes?.metadata || eventAttributes.metadata || {};
    const bookingType = metadata.bookingType;
    const bookingId = metadata.bookingId;
    const sessionId = String(checkoutSession?.id || eventAttributes.checkout_session_id || '').trim();
    if (!['grooming', 'hotel'].includes(bookingType) || !bookingId || !sessionId) {
      return res.status(400).json({ error: 'Webhook missing booking metadata' });
    }

    const Model = bookingType === 'hotel' ? HotelReservation : GroomingAppointment;
    const booking = await Model.findByPk(bookingId);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (booking.paymentMethod !== 'qrph' || booking.status === 'cancelled') {
      return res.json({ received: true, skipped: true });
    }

    if (booking.paymentStatus === 'paid') {
      return res.json({ received: true, alreadyPaid: true });
    }

    const updatePayload = {
      paymentStatus: 'paid',
      paymentReference: sessionId,
      paymentPaidAt: new Date(),
    };
    if (booking.status === 'pending') updatePayload.status = 'confirmed';
    await booking.update(updatePayload);

    // Fetch customer + pet for notifications
    const { Customer, Pet } = require('../models');
    const customer = await Customer.findByPk(booking.customerId);
    const pet = await Pet.findByPk(booking.petId);

    // Send email + SMS confirmation
    if (customer) {
      const bookingDetails = bookingType === 'grooming'
        ? {
          service: Array.isArray(booking.petServices) && booking.petServices.length
            ? booking.petServices.map((assignment) => `${assignment.petName || 'Pet'}: ${String(assignment.service || '').replace(/^grooming-/, '').replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())}`).join('\n')
            : booking.service,
          date: booking.date,
          time: booking.time,
          pickupTime: booking.pickupTime,
        }
        : { service: booking.roomType, date: booking.checkIn, time: booking.checkOut };

      await sendBookingConfirmation({
        to: customer.email,
        customerName: customer.name,
        type: bookingType,
        service: bookingDetails.service,
        date: bookingDetails.date,
        time: bookingDetails.time,
        pickupTime: bookingDetails.pickupTime,
        petName: bookingType === 'grooming' && Array.isArray(booking.petNames) && booking.petNames.length
          ? booking.petNames.join(', ')
          : (pet ? pet.name : undefined),
      });

      await sendBookingSms({
        to: customer.phone,
        customerName: customer.name,
        type: bookingType,
        service: bookingDetails.service,
        date: bookingDetails.date,
        time: bookingDetails.time,
        petName: pet ? pet.name : undefined,
      });
    }

    return res.json({ received: true, bookingId, status: 'paid' });
  } catch (error) {
    console.error('PayMongo webhook error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};

module.exports = { handlePayMongoWebhook, isValidSignature };