const { refundCheckoutSession } = require('./paymongo');

const requestGcashBookingRefund = async (booking) => {
  if (booking.paymentMethod !== 'qrph' || booking.paymentStatus !== 'paid') return null;
  if (booking.paymentRefundStatus && booking.paymentRefundStatus !== 'failed') {
    return { status: booking.paymentRefundStatus, reference: booking.paymentRefundReference || null };
  }

  try {
    await booking.update({ paymentRefundStatus: 'processing', paymentRefundError: null });
    const refund = await refundCheckoutSession(booking.paymentReference);
    await booking.update({
      paymentRefundStatus: refund.status,
      paymentRefundReference: refund.id,
      paymentRefundRequestedAt: new Date(),
      paymentRefundError: null,
    });
    return { status: refund.status, reference: refund.id };
  } catch (error) {
    try {
      await booking.update({ paymentRefundStatus: 'failed', paymentRefundError: error.message });
    } catch (updateError) {
      console.error(`Unable to record refund failure for booking ${booking.id}:`, updateError);
    }
    console.error(`Unable to refund GCash booking ${booking.id}:`, error);
    return { status: 'failed' };
  }
};

module.exports = { requestGcashBookingRefund };