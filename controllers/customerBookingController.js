const { Customer, GroomingAppointment, HotelReservation } = require('../models');
const { parseToken } = require('../util/customerAuth');
const groomingController = require('./groomingController');
const hotelController = require('./hotelController');
const bookingController = require('./bookingController');

const getCustomer = async (req) => {
  const cookie = (req.headers.cookie || '').split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('customer_token='));
  const token = cookie ? decodeURIComponent(cookie.split('=').slice(1).join('=')) : null;
  const email = parseToken(token);
  return email ? Customer.findOne({ where: { email } }) : null;
};

const getBookingContext = async (req) => {
  const type = req.params.type;
  if (!['grooming', 'hotel'].includes(type)) return { error: 'Choose a valid booking type.' };
  const Model = type === 'grooming' ? GroomingAppointment : HotelReservation;
  const customer = await getCustomer(req);
  if (!customer) return { status: 401, error: 'Please sign in to manage bookings.' };
  const booking = await Model.findByPk(req.params.id);
  if (!booking || String(booking.customerId) !== String(customer.id)) {
    return { status: 404, error: 'Booking not found.' };
  }
  return { type, booking, updateController: type === 'grooming'
    ? groomingController.updateAppointment
    : hotelController.updateReservation };
};

const cancelBooking = async (req, res, next) => {
  try {
    const context = await getBookingContext(req);
    if (context.error) return res.status(context.status || 400).json({ error: context.error });
    const { type, booking, updateController } = context;
    if (booking.status !== 'pending' || booking.confirmedAt) {
      return res.status(409).json({ error: 'This booking can no longer be cancelled online because it is no longer awaiting approval.' });
    }
    if (booking.paymentStatus === 'paid') {
      return res.status(409).json({ error: 'This booking is paid. Please contact the business to cancel it and discuss any refund.' });
    }
    if (booking.paymentMethod === 'qrph' && booking.paymentStatus === 'pending') {
      req.body = { bookingType: type, bookingId: booking.id };
      return bookingController.cancelPayment(req, res, next);
    }
    req.body = { status: 'cancelled' };
    return updateController(req, res, next);
  } catch (error) { return next(error); }
};

const rescheduleBooking = async (req, res, next) => {
  try {
    const context = await getBookingContext(req);
    if (context.error) return res.status(context.status || 400).json({ error: context.error });
    const { type, booking, updateController } = context;
    if (booking.status !== 'pending' || booking.confirmedAt) {
      return res.status(409).json({ error: 'This booking can no longer be edited because it is no longer awaiting approval.' });
    }
    if (booking.paymentMethod === 'qrph' && booking.paymentStatus === 'pending') {
      return res.status(409).json({ error: 'Cancel or complete the pending GCash checkout before rescheduling this booking.' });
    }

    const body = req.body || {};
    if (type === 'grooming') {
      if (!body.date || !body.time) return res.status(400).json({ error: 'Choose a new appointment date and time.' });
      req.body = {
        date: String(body.date),
        time: String(body.time),
        ...(body.pickupTime !== undefined ? { pickupTime: String(body.pickupTime) } : {}),
      };
    } else {
      if (!body.checkIn || !body.checkOut || !body.checkInTime || !body.checkOutTime) {
        return res.status(400).json({ error: 'Choose new check-in and check-out dates and times.' });
      }
      req.body = {
        checkIn: String(body.checkIn),
        checkInTime: String(body.checkInTime),
        checkOut: String(body.checkOut),
        checkOutTime: String(body.checkOutTime),
      };
    }
    return updateController(req, res, next);
  } catch (error) { return next(error); }
};

module.exports = { cancelBooking, rescheduleBooking };
