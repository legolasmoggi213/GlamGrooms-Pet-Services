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

module.exports = { createQrPhCheckout, getCheckoutSession, getPayMongoKey };