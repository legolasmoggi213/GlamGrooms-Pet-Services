// SMS notification service — uses Twilio when configured, otherwise logs.
// This is a fallback for customers without mobile data or internet access.

const isPlaceholder = (value) =>
  !value ||
  value.includes('your_') ||
  value.includes('youraccount') ||
  value.includes('AC0000000000000000000000000000000');

const hasTwilioConfig =
  !isPlaceholder(process.env.TWILIO_ACCOUNT_SID) &&
  !isPlaceholder(process.env.TWILIO_AUTH_TOKEN) &&
  !isPlaceholder(process.env.TWILIO_FROM_NUMBER);

let client = null;
if (hasTwilioConfig) {
  try {
    const twilio = require('twilio');
    client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  } catch (err) {
    console.warn('Twilio SDK not available, SMS disabled:', err.message);
  }
}

const sendSms = async ({ to, message }) => {
  if (!to) return false;

  const cleaned = String(to).replace(/[^0-9+]/g, '');
  if (!cleaned) return false;

  if (!client) {
    console.log('[SMS-DRY-RUN]', cleaned, message);
    return true;
  }

  try {
    await client.messages.create({
      body: message,
      from: process.env.TWILIO_FROM_NUMBER,
      to: cleaned,
    });
    return true;
  } catch (err) {
    console.error('SMS send failed:', err.message);
    return false;
  }
};

const sendBookingSms = async ({ to, customerName, type, service, date, time, petName }) => {
  const isGrooming = type === 'grooming';
  const subject = isGrooming ? `Grooming: ${service}` : `Hotel: ${service}`;
  const text = `Hello ${customerName || 'Customer'}, your Glam Grooms ${subject} is confirmed. Pet: ${petName || 'Your pet'}. Date: ${date} at ${time}. See you soon!`;
  return sendSms({ to, message: text });
};

module.exports = { sendSms, sendBookingSms, hasTwilioConfig };