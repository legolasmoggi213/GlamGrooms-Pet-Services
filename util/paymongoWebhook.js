// PayMongo webhook handler — confirms a booking after a paid Hosted Checkout session.

const crypto = require('crypto');
const { GroomingAppointment, HotelReservation } = require('../models');
const { sendPayMongoReceipt } = require('./mailer');
const { sendSms } = require('./sms');

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

    const alreadyPaid = booking.paymentStatus === 'paid';
    if (!alreadyPaid) {
      const updatePayload = {
        paymentStatus: 'paid',
        paymentReference: sessionId,
        paymentPaidAt: new Date(),
      };
      await booking.update(updatePayload);
    }

    // Fetch booking details for the receipt and payment notification.
    const { Customer, Pet } = require('../models');
    const customer = await Customer.findByPk(booking.customerId);
    const pets = await Promise.all((booking.petIds || (booking.petId ? [booking.petId] : [])).map((petId) => Pet.findByPk(petId)));

    // The verification endpoint and webhook may both run; the mailer claims delivery once.
    if (customer) {
      await sendPayMongoReceipt({
        bookingRecord: booking,
        type: bookingType,
        to: customer.email,
        customer: booking.customerDetails || customer,
        pets: pets.filter(Boolean),
      });

      if (!alreadyPaid) {
        await sendSms({
          to: customer.phone,
          message: `Hello ${customer.name || 'Customer'}, your GCash payment for Glam Grooms booking #${booking.id} has been received. The reservation ticket will be available in My Account after an admin confirms your booking.`,
        });
      }
    }

    return res.json({ received: true, bookingId, status: 'paid', alreadyPaid });
  } catch (error) {
    console.error('PayMongo webhook error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};

module.exports = { handlePayMongoWebhook, isValidSignature };