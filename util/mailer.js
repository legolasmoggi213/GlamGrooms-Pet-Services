const nodemailer = require('nodemailer');

const isPlaceholder = (value) => !value || value.includes('yourgmail.com') || value.includes('your_16_character');
const hasMailConfig = !isPlaceholder(process.env.SMTP_USER) && !isPlaceholder(process.env.SMTP_PASS);
const smtpPassword = (process.env.SMTP_PASS || '').replace(/\s+/g, '');

if (!hasMailConfig) {
  console.warn('Booking emails disabled: configure SMTP_USER and SMTP_PASS in .env.');
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

const sendBookingConfirmation = async ({ to, customerName, type, service, date, time, pickupTime, petName }) => {
  if (!transporter || !to) return false;

  const isGrooming = type === 'grooming';
  const subject = `Booking confirmed - Glam Grooms ${isGrooming ? 'grooming' : 'hotel'}`;
  const details = isGrooming
    ? `Service: ${service}\nDate: ${date}\nTime: ${time}${pickupTime ? `\nPickup Time: ${pickupTime}` : ''}`
    : `Suite: ${service}\nCheck-in: ${date}\nCheck-out: ${time}`;

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text: `Hello ${customerName || 'Customer'},\n\nYour Glam Grooms booking has been confirmed.\n\nPet: ${petName || 'Your pet'}\n${details}\n\nWe look forward to seeing you.\n\nGlam Grooms Pet Spa & Hotel`,
  });
  return true;
};

const sendServiceReminder = async ({ to, customerName, type, service, date, time, petName }) => {
  if (!transporter || !to) return false;

  const isGrooming = type === 'grooming';
  const details = isGrooming
    ? `Service: ${service}\nAppointment: ${date} at ${time}`
    : `Suite: ${service}\nCheck-in: ${date} at ${time || '2:00 PM'}`;

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: `Reminder: Glam Grooms ${isGrooming ? 'grooming appointment' : 'hotel check-in'} tomorrow`,
    text: `Hello ${customerName || 'Customer'},\n\nThis is a reminder about your upcoming Glam Grooms booking.\n\nPet: ${petName || 'Your pet'}\n${details}\n\nWe look forward to seeing you.\n\nGlam Grooms Pet Spa & Hotel`,
  });
  return true;
};

module.exports = { sendBookingConfirmation, sendServiceReminder };
