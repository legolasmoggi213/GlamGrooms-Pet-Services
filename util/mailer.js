const nodemailer = require('nodemailer');

const isPlaceholder = (value) => !value || value.includes('yourgmail.com') || value.includes('your_16_character');
const hasMailConfig = !isPlaceholder(process.env.SMTP_USER) && !isPlaceholder(process.env.SMTP_PASS);
const smtpPassword = (process.env.SMTP_PASS || '').replace(/\s+/g, '');
const hasResendConfig = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
const getEmailDeliveryConfig = () => ({
  configured: hasResendConfig || hasMailConfig,
  providers: [hasResendConfig && 'Resend', hasMailConfig && 'SMTP'].filter(Boolean),
});

if (!hasMailConfig && !hasResendConfig) {
  console.warn('Booking emails disabled: configure RESEND_API_KEY + RESEND_FROM_EMAIL or SMTP_USER + SMTP_PASS in .env / Render environment variables.');
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
  const total = Number(isGrooming ? booking.price : booking.totalPrice);
  const petDetails = (pets || []).map((pet) => {
    const age = pet.age == null ? 'Age not provided' : `${pet.age} year${Number(pet.age) === 1 ? '' : 's'}`;
    return `${pet.name || 'Pet'} (${pet.species || 'Species not provided'}, ${pet.breed || 'Breed not provided'}, ${age})`;
  });
  const serviceDetails = isGrooming
    ? Array.isArray(booking.petServices) && booking.petServices.length
      ? booking.petServices.map((assignment) => `${assignment.petName || 'Pet'}: ${formatServiceName(assignment.service)} (${formatCurrency(assignment.price)})`)
      : [formatServiceName(booking.service)]
    : Array.isArray(booking.petRooms) && booking.petRooms.length
      ? booking.petRooms.map((petRoom) => `${petRoom.petName || 'Pet'}: ${String(petRoom.roomType || 'Pet hotel').replace(/^staycation-/, '').replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())} (${formatCurrency(petRoom.pricePerNight)} per night)`)
      : [`${booking.roomType || 'Pet hotel'} (${formatCurrency(booking.pricePerNight)} per night)`];
  const receiptItems = isGrooming
    ? Array.isArray(booking.petServices) && booking.petServices.length
      ? booking.petServices.map((item) => ({
        label: `${item.petName || 'Pet'} — ${formatServiceName(item.service)}`,
        detail: 'Grooming service',
        amount: Number(item.price || 0),
      }))
      : [{ label: formatServiceName(booking.service), detail: 'Grooming service', amount: total }]
    : Array.isArray(booking.petRooms) && booking.petRooms.length
      ? booking.petRooms.map((item, index) => ({
        label: `${item.petName || 'Pet'} — ${String(item.roomType || 'Pet hotel').replace(/^staycation-/, '').replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())}`,
        detail: `${booking.checkIn || 'Check-in not provided'} to ${booking.checkOut || 'Check-out not provided'}`,
        amount: Number(booking.pricingBreakdown?.petQuotes?.[index]?.total ?? (total / booking.petRooms.length)),
      }))
      : [{ label: booking.roomType || 'Pet hotel', detail: `${booking.checkIn || 'Check-in not provided'} to ${booking.checkOut || 'Check-out not provided'}`, amount: total }];
  const rows = [
    ['Booking reference', booking.id],
    ['Customer', customer.name],
    ['Email', customer.email],
    ['Phone', customer.phone],
    ['Address', customer.address],
    ['Pet(s)', petDetails.length ? petDetails.join('\n') : (booking.petNames || []).join(', ')],
    [isGrooming ? 'Service(s)' : 'Room(s)', serviceDetails.join('\n')],
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
  if (!isGrooming) {
    const nightlyTotal = Array.isArray(booking.petRooms) && booking.petRooms.length
      ? booking.petRooms.reduce((sum, petRoom) => sum + Number(petRoom.pricePerNight || 0), 0)
      : Number(booking.pricePerNight || 0) * Math.max(1, (booking.petIds || []).length);
    if (nightlyTotal) rows.push(['Total per night', formatCurrency(nightlyTotal)]);
  }
  rows.push(['Total', formatCurrency(total)]);

  const title = receipt ? 'Payment receipt' : 'Reservation ticket';
  const issuedAt = booking.paymentPaidAt || booking.updatedAt || booking.createdAt;
  const emailDetailRows = receipt
    ? rows.filter(([label]) => label !== 'Total' && label !== (isGrooming ? 'Service(s)' : 'Room(s)'))
    : rows;
  const receiptRows = receiptItems.map((item) => `
    <tr>
      <td style="padding:11px 12px;border-bottom:1px solid #e5e7eb;color:#111827">${escapeHtml(item.label)}</td>
      <td style="padding:11px 12px;border-bottom:1px solid #e5e7eb;color:#475569">${escapeHtml(item.detail)}</td>
      <td style="padding:11px 12px;text-align:right;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:700">${formatCurrency(item.amount)}</td>
    </tr>`).join('');
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
  const htmlRows = emailDetailRows.map(([label, value]) => `
    <tr>
      <th style="padding:10px 12px;text-align:left;vertical-align:top;border-bottom:1px solid #e5e7eb;color:#475569">${escapeHtml(label)}</th>
      <td style="padding:10px 12px;white-space:pre-line;border-bottom:1px solid #e5e7eb;color:#111827">${escapeHtml(value || 'Not provided')}</td>
    </tr>`).join('');
  const html = `
    <div style="margin:0;padding:28px 12px;background:#f3f4f6;font-family:Arial,sans-serif;color:#111827">
      <div style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden">
        <div style="padding:24px 28px;background:#263238;color:#fff">
          <div style="font-size:22px;font-weight:700;letter-spacing:.2px">Glam Grooms</div>
          <div style="margin-top:4px;color:#f5df8d">Pet Spa &amp; Hotel</div>
        </div>
        <div style="padding:26px 28px">
          <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start">
            <div><h1 style="margin:0 0 7px;font-size:24px;color:#263238">${title}</h1><p style="margin:0 0 20px;line-height:1.5;color:#5f6b73">Hello ${escapeHtml(customer.name || 'Customer')}, ${intro}</p></div>
            ${receipt ? '<span style="padding:7px 12px;border-radius:999px;background:#e7f5ec;color:#176b45;font-size:12px;font-weight:700">PAID</span>' : ''}
          </div>
          ${receipt ? `<div style="margin-bottom:18px;padding:14px 16px;background:#f7f6f1;border-radius:8px"><div style="margin-bottom:6px"><strong>Receipt / booking ID:</strong> ${escapeHtml(booking.id)}</div><div><strong>Transaction date:</strong> ${escapeHtml(issuedAt ? new Date(issuedAt).toLocaleString('en-PH') : 'Confirmed')}</div></div>
          <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:18px">
            <thead><tr style="background:#f7f6f1"><th style="padding:11px 12px;text-align:left">Service / room</th><th style="padding:11px 12px;text-align:left">Details</th><th style="padding:11px 12px;text-align:right">Amount</th></tr></thead>
            <tbody>${receiptRows}</tbody>
            <tfoot><tr><th colspan="2" style="padding:14px 12px;text-align:right;font-size:15px;border-top:2px solid #d9d6cc">TOTAL PAID</th><th style="padding:14px 12px;text-align:right;font-size:18px;color:#8a6900;border-top:2px solid #d9d6cc">${formatCurrency(total)}</th></tr></tfoot>
          </table>` : ''}
          <table style="width:100%;border-collapse:collapse;font-size:14px">${htmlRows}</table>
          <p style="margin:22px 0 0;color:#6b7280;font-size:12px">Please keep this email for your records. Thank you for trusting us with your pet’s care.</p>
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

module.exports = { sendBookingConfirmation, sendPayMongoReceipt, sendReservationTicket, sendServiceReminder, getEmailDeliveryConfig };
