// Glam Grooms operating hours.
// Friday-Saturday: 9 AM - 6 PM
// Sunday:         6 AM - 6 PM
// Monday-Thursday: 9 AM - 6 PM

const OPEN_HOUR = 9;     // 09:00 default open
const SUN_OPEN_HOUR = 6; // 06:00 Sunday open
const CLOSE_HOUR = 18;   // 18:00 close

const DAY_SUNDAY = 0;
const DAY_FRIDAY = 5;
const DAY_SATURDAY = 6;

const dayName = (d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d];

const isSunday = (date) => new Date(date).getDay() === DAY_SUNDAY;
const isFriday = (date) => new Date(date).getDay() === DAY_FRIDAY;
const isSaturday = (date) => new Date(date).getDay() === DAY_SATURDAY;

// Returns the opening hour for a given date string (YYYY-MM-DD).
const openHourFor = (date) => isSunday(date) ? SUN_OPEN_HOUR : OPEN_HOUR;

// Returns true if the business is open at the given hour on the given date.
const isOpenAt = (date, hour) => {
  const h = Number(hour);
  if (Number.isNaN(h)) return false;
  return h >= openHourFor(date) && h < CLOSE_HOUR;
};

// Returns a list of valid time-slot hours for a given date.
const validHoursFor = (date) => {
  const start = openHourFor(date);
  const hours = [];
  for (let h = start; h < CLOSE_HOUR; h++) hours.push(h);
  return hours;
};

// Format an hour number as HH:MM.
const fmtHour = (h) => String(h).padStart(2, '0') + ':00';

// Validate a check-in/check-out time against business hours.
const validateTime = (date, time) => {
  if (!date || !time) return { ok: false, error: 'Date and time are required.' };
  const [h, m] = String(time).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return { ok: false, error: 'Invalid time format.' };
  if (m !== 0) return { ok: false, error: 'Times must be on the hour (e.g. 09:00, 14:00).' };
  const open = openHourFor(date);
  if (h < open || h >= CLOSE_HOUR) {
    return { ok: false, error: `Business hours are ${fmtHour(open)}–${fmtHour(CLOSE_HOUR)} on ${dayName(new Date(date).getDay())}.` };
  }
  return { ok: true };
};

module.exports = {
  OPEN_HOUR,
  SUN_OPEN_HOUR,
  CLOSE_HOUR,
  DAY_SUNDAY,
  DAY_FRIDAY,
  DAY_SATURDAY,
  dayName,
  isSunday,
  isFriday,
  isSaturday,
  openHourFor,
  isOpenAt,
  validHoursFor,
  fmtHour,
  validateTime,
};