const PAYMONGO_API = 'https://api.paymongo.com/v1';
const PAYMONGO_QRPH_REFUNDS_API = 'https://refunds-api.paymongo.com/v1';

const getPayMongoKey = () => {
  const key = String(process.env.PAYMONGO_SECRET_KEY || '').trim();
  return /^sk_(test|live)_/.test(key) ? key : '';
};

const paymongoRequest = async (path, options = {}, baseUrl = PAYMONGO_API) => {
  const secretKey = getPayMongoKey();
  if (!secretKey) throw new Error('PayMongo is not configured. Add PAYMONGO_SECRET_KEY to .env.');

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerError = body.errors?.[0] || {};
    const error = new Error(`${providerError.code ? `${providerError.code}: ` : ''}${providerError.detail || 'PayMongo request failed.'}`);
    error.code = providerError.code || 'PAYMONGO_REQUEST_FAILED';
    error.status = response.status;
    throw error;
  }
  return body;
};

const createQrPhCheckout = async ({ amount, description, metadata, successUrl, cancelUrl }) => {
  const result = await paymongoRequest('/checkout_sessions', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        attributes: {
          line_items: [{
            currency: 'PHP',
            amount: Math.round(Number(amount) * 100),
            name: description,
            quantity: 1,
          }],
          payment_method_types: ['qrph'],
          description,
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata,
        },
      },
    }),
  });

  const attributes = result.data?.attributes || {};
  return {
    id: result.data?.id,
    checkoutUrl: attributes.checkout_url,
  };
};

const getCheckoutSession = (sessionId) => paymongoRequest(`/checkout_sessions/${encodeURIComponent(sessionId)}`);
const expireCheckoutSession = (sessionId) => paymongoRequest(`/checkout_sessions/${encodeURIComponent(sessionId)}/expire`, { method: 'POST' });
const getRefund = (refundId) => paymongoRequest(`/refunds/${encodeURIComponent(refundId)}`);

const resourceId = (resource) => typeof resource === 'string' ? resource : resource?.id;

const resolvePaidPayment = async (checkoutAttributes) => {
  let candidates = Array.isArray(checkoutAttributes.payments) ? checkoutAttributes.payments : [];
  let paidCandidate = candidates.find((candidate) => {
    const status = candidate?.attributes?.status || candidate?.status;
    return status === 'paid' || status === 'succeeded';
  });
  const paymentIntentId = resourceId(checkoutAttributes.payment_intent);
  if (!paidCandidate && paymentIntentId) {
    const paymentIntent = await paymongoRequest(`/payment_intents/${encodeURIComponent(paymentIntentId)}`);
    const intentAttributes = paymentIntent.data?.attributes || {};
    candidates = [
      ...(Array.isArray(intentAttributes.payments) ? intentAttributes.payments : []),
      intentAttributes.latest_payment,
      intentAttributes.last_payment,
    ].filter(Boolean);
    paidCandidate = candidates.find((candidate) => {
      const status = candidate?.attributes?.status || candidate?.status;
      return status === 'paid' || status === 'succeeded';
    });
  }
  const paymentId = [paidCandidate, ...[...candidates].reverse()]
    .map(resourceId)
    .find((id) => typeof id === 'string' && id.startsWith('pay_'));
  if (!paymentId) {
    throw new Error('PayMongo could not identify a refundable payment for this booking.');
  }

  const payment = await paymongoRequest(`/payments/${encodeURIComponent(paymentId)}`);
  const paymentResource = payment.data || {};
  const paymentAttributes = paymentResource.attributes || {};
  if (!['paid', 'succeeded'].includes(paymentAttributes.status)) {
    throw new Error('PayMongo reports that this payment is not in a refundable state.');
  }
  return {
    id: paymentResource.id || paymentId,
    amount: Number(paymentAttributes.amount),
    refunds: paymentAttributes.refunds,
  };
};

const refundCheckoutSession = async (sessionId, existingRefundId = null) => {
  const checkout = await getCheckoutSession(sessionId);
  const attributes = checkout.data?.attributes || {};
  const payment = await resolvePaidPayment(attributes);
  const refunds = [...(Array.isArray(payment.refunds) ? payment.refunds : [])];
  if (existingRefundId) {
    const latestRefundResponse = await getRefund(existingRefundId);
    const latestRefund = latestRefundResponse.data;
    if (!latestRefund?.id || !latestRefund.attributes?.status) {
      throw new Error('PayMongo did not return the current status for this refund.');
    }
    const existingRefundIndex = refunds.findIndex((refund) => resourceId(refund) === latestRefund.id);
    if (existingRefundIndex >= 0) {
      refunds[existingRefundIndex] = latestRefund;
    } else {
      refunds.push(latestRefund);
    }
  }
  const pendingRefund = refunds.find((refund) => ['pending', 'processing', 'refunding'].includes(
    refund?.attributes?.status || refund?.status,
  ));
  if (pendingRefund) {
    return {
      id: pendingRefund.id || null,
      status: pendingRefund.attributes?.status || pendingRefund.status,
      transferLink: pendingRefund.attributes?.transfer_link || pendingRefund.transfer_link || null,
    };
  }
  const refundedAmount = refunds.reduce((total, refund) => {
    const refundStatus = refund?.attributes?.status || refund?.status;
    return refundStatus === 'failed' ? total : total + Number(refund?.attributes?.amount ?? refund?.amount ?? 0);
  }, 0);
  const amount = payment.amount - refundedAmount;
  const completedRefund = refunds.find((refund) => ['refunded', 'succeeded'].includes(
    refund?.attributes?.status || refund?.status,
  ));
  if (amount === 0 && completedRefund) {
    return {
      id: completedRefund.id || null,
      status: completedRefund.attributes?.status || completedRefund.status,
      transferLink: completedRefund.attributes?.transfer_link || completedRefund.transfer_link || null,
    };
  }
  if (!Number.isInteger(amount) || amount < 100) {
    throw new Error('PayMongo could not identify a refundable payment for this booking.');
  }

  const result = await paymongoRequest('/refunds', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        attributes: {
          amount,
          payment_id: payment.id,
          reason: 'others',
          notes: `Booking cancellation for checkout ${sessionId}`,
        },
      },
    }),
  }, PAYMONGO_QRPH_REFUNDS_API);
  return {
    id: result.data?.id || null,
    status: result.data?.attributes?.status || 'pending',
    transferLink: result.data?.attributes?.transfer_link || null,
  };
};

const isCheckoutSessionPaid = (attributes = {}) => attributes.payment_status === 'paid'
  || (Array.isArray(attributes.payments) && attributes.payments.some((payment) => payment?.attributes?.status === 'paid'))
  || attributes.payment_intent?.attributes?.status === 'succeeded';

module.exports = {
  createQrPhCheckout,
  getCheckoutSession,
  expireCheckoutSession,
  getRefund,
  refundCheckoutSession,
  getPayMongoKey,
  isCheckoutSessionPaid,
};