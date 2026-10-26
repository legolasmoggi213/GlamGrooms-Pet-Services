// PayMongo webhook handler — confirms a booking after a paid Hosted Checkout session.

const crypto = require('crypto');
const { GroomingAppointment, HotelReservation } = require('../models');
const { sendPayMongoReceipt, sendReservationTicket } = require('./mailer');
const { sendSms } = require('./sms');
const { notifyStaffOfBooking } = require('./staffNotifications');

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

    const event = req.body?.data;
    const eventType = event?.attributes?.type || event?.type;
    if (!event || !eventType) {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    if (eventType !== 'checkout_session.payment.paid') {
      return res.json({ received: true, skipped: true });
    }

    const checkoutSession = event?.attributes?.data || event?.data;
    const attributes = checkoutSession && checkoutSession.attributes;
    const metadata = attributes?.metadata || eventAttributes.metadata || {};
    const sessionId = String(checkoutSession?.id || eventAttributes.checkout_session_id || '').trim();
    if (metadata.type === 'walk-in') {
      const { CashTransaction } = require('../models');
      const transactionId = metadata.transactionId;
      if (!transactionId || !sessionId) {
        return res.status(400).json({ error: 'Webhook missing walk-in payment metadata' });
      }
      const transaction = await CashTransaction.findByPk(transactionId);
      if (!transaction) return res.status(404).json({ error: 'Walk-in transaction not found' });
      if (transaction.paymentMethod !== 'qrph' || transaction.type !== 'walk-in') {
        return res.json({ received: true, skipped: true });
      }
      if (transaction.paymentReference && transaction.paymentReference !== sessionId) {
        return res.json({ received: true, skipped: true });
      }
      const alreadyPaid = transaction.paymentStatus === 'paid';
      if (!alreadyPaid) {
        await transaction.update({
          paymentStatus: 'paid',
          paymentReference: sessionId,
          paidAt: new Date(),
        });
      }
      return res.json({ received: true, transactionId, status: 'paid', alreadyPaid });
    }

    const bookingType = metadata.bookingType;
    const bookingId = metadata.bookingId;
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
    if (!alreadyPaid || (bookingType === 'hotel' && booking.status !== 'confirmed')) {
      const updatePayload = {
        paymentStatus: 'paid',
        paymentReference: sessionId,
        paymentPaidAt: new Date(),
      };
      if (bookingType === 'hotel') {
        updatePayload.status = 'confirmed';
        updatePayload.confirmedAt = booking.confirmedAt || new Date();
      }
      await booking.update(updatePayload);
    }

    // Fetch booking details for the receipt and payment notification.
    const { Customer, Pet } = require('../models');
    const customer = await Customer.findByPk(booking.customerId);
    const pets = await Promise.all((booking.petIds || (booking.petId ? [booking.petId] : [])).map((petId) => Pet.findByPk(petId)));
    await notifyStaffOfBooking({ type: bookingType, booking, customer, pets: pets.filter(Boolean) });

    // The verification endpoint and webhook may both run; the mailer claims delivery once.
    if (customer) {
      await sendPayMongoReceipt({
        bookingRecord: booking,
        type: bookingType,
        to: customer.email,
        customer: booking.customerDetails || customer,
        pets: pets.filter(Boolean),
      });
      await sendReservationTicket({
        bookingRecord: booking,
        type: bookingType,
        to: customer.email,
        customer: booking.customerDetails || customer,
        pets: pets.filter(Boolean),
      });

      if (!alreadyPaid) {
        await sendSms({
          to: customer.phone,
          message: bookingType === 'hotel'
            ? `Hello ${customer.name || 'Customer'}, your GCash payment for Glam Grooms hotel reservation #${booking.id} was received and your reservation is confirmed. View your reservation in My Account.`
            : `Hello ${customer.name || 'Customer'}, your GCash payment for Glam Grooms grooming booking #${booking.id} has been received. The reservation ticket will be available in My Account after an admin confirms your appointment.`,
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