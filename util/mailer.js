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
      family: 4,
      auth: {
        user: process.env.SMTP_USER,
        pass: smtpPassword,
      },
    })
  : null;

const sendWithResend = async ({ to, subject, text, html, from }) => {
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
      ...(html ? { html } : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Resend email failed: ${response.status} ${detail}`);
  }

  return true;
};

const sendEmail = async ({ to, subject, text, html, from }) => {
  if (!to) return false;

  if (hasResendConfig) {
    try {
      return await sendWithResend({ to, subject, text, html, from });
    } catch (error) {
      console.error('Resend email failed, falling back to SMTP:', error.message);
    }
  }

  if (!transporter) return false;

  await transporter.sendMail({ from, to, subject, text, html });
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

const escapeHtml = (value) => String(value ?? 'Not provided')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const formatCurrency = (value) => `PHP ${Number(value || 0).toLocaleString('en-PH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

const formatServiceName = (value) => String(value || 'Grooming service')
  .replace(/^grooming-/, '')
  .replace(/^ayurveda-herb-/, '')
  .replace(/^ayurveda-pkg-/, '')
  .replace(/-/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase())
  .replace(/\bXl\b/g, 'XL')
  .replace(/\bDoctors\b/g, "Doctor's");

const renderBookingEmail = ({ type, booking, customer, pets, paid, receipt }) => {
  const isGrooming = type === 'grooming';
  const petDetails = (pets || []).map((pet) => {
    const age = pet.age == null ? 'Age not provided' : `${pet.age} year${Number(pet.age) === 1 ? '' : 's'}`;
    return `${pet.name || 'Pet'} (${pet.species || 'Species not provided'}, ${pet.breed || 'Breed not provided'}, ${age})`;
  });
  const serviceDetails = isGrooming
    ? Array.isArray(booking.petServices) && booking.petServices.length
      ? booking.petServices.map((assignment) => `${assignment.petName || 'Pet'}: ${formatServiceName(assignment.service)} (${formatCurrency(assignment.price)})`)
      : [formatServiceName(booking.service)]
    : [`${booking.roomType || 'Pet hotel'} (${formatCurrency(booking.pricePerNight)} per night)`];
  const rows = [
    ['Booking reference', booking.id],
    ['Customer', customer.name],
    ['Email', customer.email],
    ['Phone', customer.phone],
    ['Address', customer.address],
    ['Pet(s)', petDetails.length ? petDetails.join('\n') : (booking.petNames || []).join(', ')],
    [isGrooming ? 'Service(s)' : 'Room', serviceDetails.join('\n')],
  ];

  if (isGrooming) {
    rows.push(['Appointment date', booking.date], ['Appointment time', booking.time]);
    if (booking.pickupTime) rows.push(['Pickup time', booking.pickupTime]);
  } else {
    rows.push(
      ['Check-in', `${booking.checkIn || 'Not provided'}${booking.checkInTime ? ` at ${booking.checkInTime}` : ''}`],
      ['Check-out', `${booking.checkOut || 'Not provided'}${booking.checkOutTime ? ` at ${booking.checkOutTime}` : ''}`],
    );
  }
  if (booking.notes) rows.push(['Special requests', booking.notes]);
  rows.push(
    ['Payment method', booking.paymentMethod === 'qrph' ? 'GCash (PayMongo)' : 'Cash at the counter'],
    ['Payment status', paid ? 'PAID' : 'Unpaid - due at the counter'],
  );
  if (paid && booking.paymentReference) rows.push(['PayMongo reference', booking.paymentReference]);
  if (paid && booking.paymentPaidAt) rows.push(['Paid at', new Date(booking.paymentPaidAt).toLocaleString('en-PH')]);
  if (!isGrooming && booking.pricePerNight) rows.push(['Price per night', formatCurrency(booking.pricePerNight)]);
  rows.push(['Total', formatCurrency(isGrooming ? booking.price : booking.totalPrice)]);

  const title = receipt ? 'Payment receipt' : 'Reservation ticket';
  const intro = receipt
    ? 'Your online payment through GCash has been processed. This email is your paid receipt.'
    : 'Your booking has been confirmed by our team. Please present this reservation ticket when you arrive.';
  const text = [
    `Hello ${customer.name || 'Customer'},`,
    '',
    title,
    intro,
    '',
    ...rows.map(([label, value]) => `${label}: ${value || 'Not provided'}`),
    '',
    'Glam Grooms Pet Spa & Hotel',
  ].join('\n');
  const htmlRows = rows.map(([label, value]) => `
    <tr>
      <th style="padding:10px 12px;text-align:left;vertical-align:top;border-bottom:1px solid #e5e7eb;color:#475569">${escapeHtml(label)}</th>
      <td style="padding:10px 12px;white-space:pre-line;border-bottom:1px solid #e5e7eb;color:#111827">${escapeHtml(value || 'Not provided')}</td>
    </tr>`).join('');
  const html = `
    <div style="margin:0;padding:28px 12px;background:#f3f4f6;font-family:Arial,sans-serif;color:#111827">
      <div style="max-width:680px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <div style="padding:22px 26px;background:#111827;color:#fff">
          <div style="font-size:20px;font-weight:700">Glam Grooms</div>
          <div style="margin-top:4px;color:#d1d5db">Pet Spa &amp; Hotel</div>
        </div>
        <div style="padding:24px 26px">
          <h1 style="margin:0 0 10px;font-size:22px">${title}</h1>
          <p style="margin:0 0 20px;line-height:1.5">Hello ${escapeHtml(customer.name || 'Customer')}, ${intro}</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px">${htmlRows}</table>
          <p style="margin:22px 0 0;color:#6b7280;font-size:12px">Please keep this email for your records.</p>
        </div>
      </div>
    </div>`;
  return { title, text, html };
};

const sendBookingEmailOnce = async ({ bookingRecord, type, customer, pets, to, paid, receipt = false }) => {
  const sentField = receipt ? 'paymentReceiptEmailSentAt' : 'reservationTicketEmailSentAt';
  const claimField = receipt ? 'paymentReceiptEmailClaimedAt' : 'reservationTicketEmailClaimedAt';
  const ref = bookingRecord && bookingRecord._ref;
  let claimed = false;

  if (ref && ref.firestore && typeof ref.firestore.runTransaction === 'function') {
    claimed = await ref.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return false;
      const data = snapshot.data() || {};
      if (data[sentField]) return false;
      const claimedAt = data[claimField];
      const claimedAtMs = claimedAt && typeof claimedAt.toMillis === 'function'
        ? claimedAt.toMillis()
        : new Date(claimedAt).getTime();
      if (Number.isFinite(claimedAtMs) && Date.now() - claimedAtMs < 2 * 60 * 1000) return false;
      transaction.update(ref, { [claimField]: new Date() });
      return true;
    });
  } else {
    claimed = !bookingRecord[sentField];
  }
  if (!claimed) return false;

  const booking = bookingRecord;
  const rendered = renderBookingEmail({ type, booking, customer, pets, paid, receipt });
  const from = process.env.RESEND_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
  try {
    const sent = await sendEmail({
      to: to || customer.email,
      subject: `${rendered.title} #${booking.id} - Glam Grooms`,
      text: rendered.text,
      html: rendered.html,
      from,
    });
    if (!sent) {
      await booking.update({ [claimField]: null });
      return false;
    }
    await booking.update({ [sentField]: new Date(), [claimField]: null });
    return true;
  } catch (error) {
    try {
      await booking.update({ [claimField]: null });
    } catch (releaseError) {
      console.error('Unable to release booking email claim:', releaseError.message);
    }
    throw error;
  }
};

const sendReservationTicket = (details) => sendBookingEmailOnce({
  ...details,
  paid: details.bookingRecord.paymentStatus === 'paid',
});
const sendPayMongoReceipt = (details) => sendBookingEmailOnce({ ...details, paid: true, receipt: true });

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

module.exports = { sendBookingConfirmation, sendPayMongoReceipt, sendReservationTicket, sendServiceReminder };
