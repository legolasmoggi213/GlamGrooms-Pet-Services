// Service reminders — sends one email/SMS reminder about 24 hours before an event.

const { GroomingAppointment, HotelReservation, Customer, Pet } = require('../models');
const { sendServiceReminder } = require('./mailer');
const { sendSms, hasTwilioConfig } = require('./sms');

const REMINDER_HOURS_BEFORE = 24;
const REMINDER_SCAN_INTERVAL_MS = 5 * 60 * 1000;
const REMINDER_GRACE_MS = 15 * 60 * 1000;
const REMINDER_LEAD_MS = REMINDER_HOURS_BEFORE * 60 * 60 * 1000;
const REMINDER_TIME_ZONE = process.env.REMINDER_TIME_ZONE || 'Asia/Manila';
const inFlight = new Set();
let scheduler;

const eventDateTime = (date, time = '14:00') => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(String(time || ''));
  if (!match || !timeMatch) return null;

  const [, year, month, day] = match;
  const [, hour, minute] = timeMatch;
  const targetUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  if (new Date(targetUtc).toISOString().slice(0, 16) !== `${date}T${time}`) return null;

  let timestamp = targetUtc;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: REMINDER_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]));
    const representedUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const offset = representedUtc - Math.floor(timestamp / 1000) * 1000;
    timestamp = targetUtc - offset;
  }
  return new Date(timestamp);
};

const isReminderDue = (eventAt, now = new Date()) => {
  if (!eventAt || eventAt <= now) return false;
  const lead = eventAt.getTime() - now.getTime();
  return lead <= REMINDER_LEAD_MS && lead > REMINDER_LEAD_MS - REMINDER_GRACE_MS;
};

const deliverReminder = async ({ booking, customer, pet, type, service, date, time, eventAt }) => {
  const key = `${type}:${booking.id}:${eventAt.toISOString()}`;
  if (inFlight.has(key) || booking.reminderSentFor === eventAt.toISOString()) return false;
  inFlight.add(key);

  try {
    const emailSent = await sendServiceReminder({
      to: customer.email,
      customerName: customer.name,
      type,
      service,
      date,
      time,
      petName: pet && pet.name,
    }).catch((error) => {
      console.error('Reminder email failed:', error.message);
      return false;
    });

    let smsSent = false;
    if (hasTwilioConfig && customer.phone) {
      const when = `tomorrow (${date}) at ${time || '2:00 PM'}`;
      const message = type === 'grooming'
        ? `Reminder: Glam Grooms ${service} appointment ${when}. See you soon!`
        : `Reminder: Glam Grooms hotel check-in ${when}. We're ready for your pet!`;
      smsSent = await sendSms({ to: customer.phone, message }).catch((error) => {
        console.error('Reminder SMS failed:', error.message);
        return false;
      });
    }

    if (!emailSent && !smsSent) return false;
    await booking.update({ reminderSentFor: eventAt.toISOString() });
    return true;
  } finally {
    inFlight.delete(key);
  }
};

const sendReminders = async () => {
  const now = new Date();
  let checked = 0;
  let sent = 0;

  const upcomingGrooming = await GroomingAppointment.findAll({
    where: { status: ['confirmed', 'scheduled'] },
  });
  for (const appt of upcomingGrooming) {
    const eventAt = eventDateTime(appt.date, appt.time);
    if (!isReminderDue(eventAt, now)) continue;
    checked += 1;
    const customer = await Customer.findByPk(appt.customerId);
    if (!customer) continue;
    const pet = await Pet.findByPk(appt.petId);
    if (await deliverReminder({
      booking: appt, customer, pet, type: 'grooming', service: appt.service,
      date: appt.date, time: appt.time, eventAt,
    })) sent += 1;
  }

  const upcomingHotel = await HotelReservation.findAll({
    where: { status: ['confirmed', 'reserved'] },
  });
  for (const resv of upcomingHotel) {
    const eventAt = eventDateTime(resv.checkIn, resv.checkInTime || '14:00');
    if (!isReminderDue(eventAt, now)) continue;
    checked += 1;
    const customer = await Customer.findByPk(resv.customerId);
    if (!customer) continue;
    const pet = await Pet.findByPk(resv.petId);
    if (await deliverReminder({
      booking: resv, customer, pet, type: 'hotel', service: resv.roomType,
      date: resv.checkIn, time: resv.checkInTime || '14:00', eventAt,
    })) sent += 1;
  }

  return { sent, checked };
};

const startReminderScheduler = () => {
  if (scheduler) return scheduler;
  const run = () => sendReminders().catch((error) => console.error('Automated reminder run failed:', error));
  scheduler = setInterval(run, REMINDER_SCAN_INTERVAL_MS);
  scheduler.unref();
  return scheduler;
};

module.exports = {
  sendReminders,
  startReminderScheduler,
  eventDateTime,
  isReminderDue,
  REMINDER_HOURS_BEFORE,
  REMINDER_SCAN_INTERVAL_MS,
  REMINDER_GRACE_MS,
  REMINDER_TIME_ZONE,
};