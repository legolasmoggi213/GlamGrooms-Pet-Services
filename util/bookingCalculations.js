const { HOTEL } = require('./serviceCatalog');

const DAY_MS = 24 * 60 * 60 * 1000;
const BUSINESS_TIME_ZONE = 'Asia/Manila';
const MIN_HOTEL_NIGHTS = 3;

const roundMoney = (amount) => Math.round((Number(amount) + Number.EPSILON) * 100) / 100;

const businessDateKey = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(date);

const parseDateKey = (value) => {
  const dateKey = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateKey ? null : date;
};

const validateFutureDate = (value, label = 'Date') => {
  if (!parseDateKey(value)) return { ok: false, error: `${label} must be a valid date.` };
  if (value < businessDateKey()) return { ok: false, error: `${label} cannot be in the past.` };
  return { ok: true };
};

const timeToMinutes = (value) => {
  const match = /^(?:([01]\d|2[0-3])):([0-5]\d)$/.exec(String(value || ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

const validateFutureBookingTime = (date, time, label = 'Appointment') => {
  const dateCheck = validateFutureDate(date, `${label} date`);
  if (!dateCheck.ok) return dateCheck;
  const minutes = timeToMinutes(time);
  if (minutes === null) return { ok: false, error: `${label} time must be valid.` };
  if (date === businessDateKey()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: BUSINESS_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    const nowMinutes = Number(parts.find((part) => part.type === 'hour').value) * 60
      + Number(parts.find((part) => part.type === 'minute').value);
    if (minutes <= nowMinutes) return { ok: false, error: `${label} time must be in the future.` };
  }
  return { ok: true };
};

const getStayNights = (checkIn, checkOut) => {
  const start = parseDateKey(checkIn);
  const end = parseDateKey(checkOut);
  if (!start || !end || end <= start) return 0;
  return Math.round((end.getTime() - start.getTime()) / DAY_MS);
};

const normalizeRoomType = (value) => {
  const aliases = { standard: 'staycation-standard', deluxe: 'staycation-deluxe' };
  const roomType = String(value || '').trim().toLowerCase();
  return aliases[roomType] || roomType;
};

const quoteHotelStay = ({ petRoomTypes, checkIn, checkOut, minimumNights = MIN_HOTEL_NIGHTS }) => {
  const nights = getStayNights(checkIn, checkOut);
  if (nights < minimumNights) {
    return { ok: false, error: `Hotel stays require at least ${minimumNights} nights.`, nights };
  }
  const checkInDate = parseDateKey(checkIn);
  if (!checkInDate || !parseDateKey(checkOut)) {
    return { ok: false, error: 'Check-in and check-out must be valid dates.', nights: 0 };
  }
  if (!Array.isArray(petRoomTypes) || !petRoomTypes.length) {
    return { ok: false, error: 'At least one room type is required.', nights };
  }

  const petQuotes = [];
  let baseAmount = 0;
  let multiPetDiscount = 0;
  for (const [index, submittedRoomType] of petRoomTypes.entries()) {
    const roomType = normalizeRoomType(submittedRoomType);
    if (!roomType.startsWith('staycation-')) {
      return { ok: false, error: 'Day Care uses hourly rates and cannot be quoted as an overnight stay.', nights };
    }
    const stayType = 'Staycation';
    const roomName = roomType.slice('staycation-'.length);
    const catalogRoomName = roomName && roomName[0].toUpperCase() + roomName.slice(1);
    const rates = stayType && HOTEL[stayType] && HOTEL[stayType][catalogRoomName];
    if (!rates) return { ok: false, error: 'A valid room type is required for every pet.', nights };

    let petBaseAmount = 0;
    for (let night = 0; night < nights; night += 1) {
      const date = new Date(checkInDate.getTime() + night * DAY_MS);
      const day = date.getUTCDay();
      petBaseAmount += day === 0 || day === 6 ? rates.weekend : rates.weekday;
    }
    const discountRate = index === 0 ? 0 : index === 1 ? 0.15 : 0.25;
    const petDiscount = petBaseAmount * discountRate;
    baseAmount += petBaseAmount;
    multiPetDiscount += petDiscount;
    petQuotes.push({
      roomType,
      baseAmount: roundMoney(petBaseAmount),
      multiPetDiscount: roundMoney(petDiscount),
      afterMultiPetDiscount: roundMoney(petBaseAmount - petDiscount),
    });
  }

  const afterMultiPetDiscount = baseAmount - multiPetDiscount;
  const longStayDiscount = nights >= 5 ? afterMultiPetDiscount * 0.1 : 0;
  const total = roundMoney(afterMultiPetDiscount - longStayDiscount);
  const longStayRate = nights >= 5 ? 0.1 : 0;
  for (const petQuote of petQuotes) {
    petQuote.longStayDiscount = roundMoney(petQuote.afterMultiPetDiscount * longStayRate);
    petQuote.total = roundMoney(petQuote.afterMultiPetDiscount - petQuote.longStayDiscount);
    petQuote.effectiveNightlyRate = roundMoney(petQuote.total / nights);
  }
  return {
    ok: true,
    nights,
    baseAmount: roundMoney(baseAmount),
    multiPetDiscount: roundMoney(multiPetDiscount),
    longStayDiscount: roundMoney(longStayDiscount),
    total,
    complimentaryBath: nights >= MIN_HOTEL_NIGHTS,
    petQuotes,
  };
};

const groomingServiceDuration = (service) => {
  const key = String(service || '').toLowerCase();
  if (key.startsWith('grooming-basic-')) return 60;
  if (key.startsWith('grooming-full-')) return 90;
  if (key.startsWith('grooming-premium-')) return 120;

  const alaCarteDurations = {
    'face-trim': 15,
    'paw-trim': 15,
    'nail-clipping': 10,
    'ear-cleaning': 15,
    'anal-sac-expressing': 20,
    'de-matting': 45,
  };
  if (key.startsWith('grooming-a-la-carte-')) return alaCarteDurations[key.slice('grooming-a-la-carte-'.length)] || null;
  if (key.startsWith('ayurveda-herb-doctors-')) return 90;
  if (key.startsWith('ayurveda-herb-beauty-') || key.startsWith('ayurveda-herb-moisture-')) return 60;
  if (key.startsWith('ayurveda-pkg-basic-beauty-moisture-')) return 120;
  if (key.startsWith('ayurveda-pkg-basic-doctors-')) return 150;
  if (key.startsWith('ayurveda-pkg-full-beauty-moisture-')) return 180;
  if (key.startsWith('ayurveda-pkg-full-doctors-')) return 210;
  if (key.startsWith('ayurveda-pkg-premium-beauty-moisture-')) return 240;
  if (key.startsWith('ayurveda-pkg-premium-doctors-')) return 270;
  return null;
};

const groomingBookingDuration = (services) => {
  const durations = (Array.isArray(services) ? services : [services]).filter(Boolean).map(groomingServiceDuration);
  return durations.some((duration) => !duration) ? null : durations.reduce((total, duration) => total + duration, 0);
};

const groomingRecordDuration = (booking) => {
  const services = Array.isArray(booking.petServices) && booking.petServices.length
    ? booking.petServices.map((assignment) => assignment.service)
    : booking.service;
  return groomingBookingDuration(services) || 60;
};

module.exports = {
  MIN_HOTEL_NIGHTS,
  businessDateKey,
  parseDateKey,
  validateFutureDate,
  timeToMinutes,
  validateFutureBookingTime,
  getStayNights,
  quoteHotelStay,
  groomingServiceDuration,
  groomingBookingDuration,
  groomingRecordDuration,
};