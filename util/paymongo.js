const PAYMONGO_API = 'https://api.paymongo.com/v1';

const getPayMongoKey = () => {
  const key = String(process.env.PAYMONGO_SECRET_KEY || '').trim();
  return /^sk_(test|live)_/.test(key) ? key : '';
};

const paymongoRequest = async (path, options = {}) => {
  const secretKey = getPayMongoKey();
  if (!secretKey) throw new Error('PayMongo is not configured. Add PAYMONGO_SECRET_KEY to .env.');

  const response = await fetch(`${PAYMONGO_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.errors?.[0]?.detail || 'PayMongo request failed.';
    throw new Error(message);
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
  };
};

const refundCheckoutSession = async (sessionId) => {
  const checkout = await getCheckoutSession(sessionId);
  const attributes = checkout.data?.attributes || {};
  const payment = await resolvePaidPayment(attributes);
  const amount = payment.amount;
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
          reason: 'requested_by_customer',
          notes: `Booking cancellation for checkout ${sessionId}`,
        },
      },
    }),
  });
  return {
    id: result.data?.id || null,
    status: result.data?.attributes?.status || 'pending',
  };
};

const isCheckoutSessionPaid = (attributes = {}) => attributes.payment_status === 'paid'
  || (Array.isArray(attributes.payments) && attributes.payments.some((payment) => payment?.attributes?.status === 'paid'))
  || attributes.payment_intent?.attributes?.status === 'succeeded';

module.exports = {
  createQrPhCheckout,
  getCheckoutSession,
  expireCheckoutSession,
  refundCheckoutSession,
  getPayMongoKey,
  isCheckoutSessionPaid,
};