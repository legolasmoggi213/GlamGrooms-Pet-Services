const nodemailer = require('nodemailer');

const isPlaceholder = (value) => !value || value.includes('yourgmail.com') || value.includes('your_16_character');
const hasMailConfig = !isPlaceholder(process.env.SMTP_USER) && !isPlaceholder(process.env.SMTP_PASS);
const smtpPassword = (process.env.SMTP_PASS || '').replace(/\s+/g, '');
const hasResendConfig = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);

if (!hasMailConfig && !hasResendConfig) {
  console.warn('Booking emails disabled: configure RESEND_API_KEY + RESEND_FROM_EMAIL or SMTP_USER + SMTP_PASS in .env / Railway variables.');
}

const transporter = hasMailConfig
  ? nodemailer.createTransport({
      service: process.env.SMTP_SERVICE || 'gmail',
      auth: {
        user: process.env.SMTP_USER,
        pass: smtpPassword,
      },
    })
  : null;

const sendWithResend = async ({ to, subject, text, from }) => {
  if (!hasResendConfig || !to) return false;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Resend email failed: ${response.status} ${detail}`);
  }

  return true;
};

const sendEmail = async ({ to, subject, text, from }) => {
  if (!to) return false;

  if (hasResendConfig) {
    try {
      return await sendWithResend({ to, subject, text, from });
    } catch (error) {
      console.error('Resend email failed, falling back to SMTP:', error.message);
    }
  }

  if (!transporter) return false;

  await transporter.sendMail({ from, to, subject, text });
  return true;
};

const sendBookingConfirmation = async ({ to, customerName, type, service, date, time, pickupTime, petName }) => {
  const isGrooming = type === 'grooming';
  const subject = `Booking confirmed - Glam Grooms ${isGrooming ? 'grooming' : 'hotel'}`;
  const details = isGrooming
    ? `Service: ${service}\nDate: ${date}\nTime: ${time}${pickupTime ? `\nPickup Time: ${pickupTime}` : ''}`
    : `Suite: ${service}\nCheck-in: ${date}\nCheck-out: ${time}`;

  const text = `Hello ${customerName || 'Customer'},\n\nYour Glam Grooms booking has been confirmed.\n\nPet: ${petName || 'Your pet'}\n${details}\n\nWe look forward to seeing you.\n\nGlam Grooms Pet Spa & Hotel`;
  return sendEmail({
    to,
    subject,
    text,
    from: process.env.RESEND_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER,
  });
};

const sendServiceReminder = async ({ to, customerName, type, service, date, time, petName }) => {
  const isGrooming = type === 'grooming';
  const details = isGrooming
    ? `Service: ${service}\nAppointment: ${date} at ${time}`
    : `Suite: ${service}\nCheck-in: ${date} at ${time || '2:00 PM'}`;

  const text = `Hello ${customerName || 'Customer'},\n\nThis is a reminder about your upcoming Glam Grooms booking.\n\nPet: ${petName || 'Your pet'}\n${details}\n\nWe look forward to seeing you.\n\nGlam Grooms Pet Spa & Hotel`;
  return sendEmail({
    to,
    subject: `Reminder: Glam Grooms ${isGrooming ? 'grooming appointment' : 'hotel check-in'} tomorrow`,
    text,
    from: process.env.RESEND_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER,
  });
};

module.exports = { sendBookingConfirmation, sendServiceReminder };
