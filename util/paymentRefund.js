const { refundCheckoutSession } = require('./paymongo');

const requestGcashBookingRefund = async (booking) => {
  if (booking.paymentMethod !== 'qrph' || booking.paymentStatus !== 'paid') return null;

  try {
    await booking.update({ paymentRefundStatus: 'processing', paymentRefundError: null });
    const refund = await refundCheckoutSession(booking.paymentReference, booking.paymentRefundReference || null);
    await booking.update({
      paymentRefundStatus: refund.status,
      paymentRefundReference: refund.id,
      paymentRefundTransferLink: refund.transferLink || null,
      paymentRefundRequestedAt: new Date(),
      paymentRefundError: null,
    });
    return { status: refund.status, reference: refund.id, transferLink: refund.transferLink || null };
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