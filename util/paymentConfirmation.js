const markBookingPaidAndConfirmed = async (booking, sessionId) => {
  const paidAt = booking.paymentPaidAt || new Date();
  const updates = {};

  if (booking.paymentStatus !== 'paid') {
    updates.paymentStatus = 'paid';
    updates.paymentReference = sessionId;
    updates.paymentPaidAt = paidAt;
  } else if (!booking.paymentReference) {
    updates.paymentReference = sessionId;
  }

  if (['pending', 'reserved'].includes(booking.status)) {
    updates.status = 'confirmed';
    updates.confirmedAt = booking.confirmedAt || paidAt;
  }

  if (Object.keys(updates).length) await booking.update(updates);
};

module.exports = { markBookingPaidAndConfirmed };