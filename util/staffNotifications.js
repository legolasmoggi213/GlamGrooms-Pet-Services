const { firestore } = require('../config/firebase');
const { StaffNotification } = require('../models');

const notifyStaffOfBooking = async ({ type, booking, customer, pets }) => {
  try {
    const notificationId = `booking_${type}_${booking.id}`;
    const ref = firestore.collection('staffNotifications').doc(notificationId);
    const notification = {
      type: 'booking',
      bookingType: type,
      bookingId: String(booking.id),
      customerName: customer?.name || booking.customerDetails?.name || 'Customer',
      petNames: (pets || []).map((pet) => pet.name).filter(Boolean),
      schedule: type === 'hotel'
        ? `${booking.checkIn || ''} ${booking.checkInTime || ''} – ${booking.checkOut || ''} ${booking.checkOutTime || ''}`.trim()
        : `${booking.date || ''} ${booking.time || ''}`.trim(),
      status: booking.status || 'pending',
      read: false,
      createdAt: new Date(),
    };
    await firestore.runTransaction(async (transaction) => {
      const existing = await transaction.get(ref);
      if (!existing.exists) transaction.create(ref, notification);
    });
    return true;
  } catch (error) {
    console.error(`Unable to notify staff about ${type} booking ${booking.id}:`, error);
    return false;
  }
};

const notifyStaffOfCancellation = async ({ type, booking, customer, pets }) => {
  try {
    await StaffNotification.create({
      type: 'booking_cancelled',
      bookingType: type,
      bookingId: String(booking.id),
      customerName: customer?.name || booking.customerDetails?.name || 'Customer',
      petNames: (pets || []).map((pet) => pet.name).filter(Boolean),
      schedule: type === 'hotel'
        ? `${booking.checkIn || ''} ${booking.checkInTime || ''} – ${booking.checkOut || ''} ${booking.checkOutTime || ''}`.trim()
        : `${booking.date || ''} ${booking.time || ''}`.trim(),
      status: 'cancelled',
      read: false,
      createdAt: new Date(),
    });
    return true;
  } catch (error) {
    console.error(`Unable to notify staff about cancelled ${type} booking ${booking.id}:`, error);
    return false;
  }
};

const notifyStaffOfReschedule = async ({ type, booking, customer, pets, previousSchedule }) => {
  try {
    await StaffNotification.create({
      type: 'booking_rescheduled',
      bookingType: type,
      bookingId: String(booking.id),
      customerName: customer?.name || booking.customerDetails?.name || 'Customer',
      petNames: (pets || []).map((pet) => pet.name).filter(Boolean),
      previousSchedule,
      schedule: type === 'hotel'
        ? `${booking.checkIn || ''} ${booking.checkInTime || ''} – ${booking.checkOut || ''} ${booking.checkOutTime || ''}`.trim()
        : `${booking.date || ''} ${booking.time || ''}`.trim(),
      status: booking.status || 'pending',
      read: false,
      createdAt: new Date(),
    });
    return true;
  } catch (error) {
    console.error(`Unable to notify staff about rescheduled ${type} booking ${booking.id}:`, error);
    return false;
  }
};

module.exports = { notifyStaffOfBooking, notifyStaffOfCancellation, notifyStaffOfReschedule };
