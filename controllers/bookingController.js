const { Customer, Pet, GroomingAppointment, HotelReservation } = require('../models');
const { randomUUID } = require('crypto');
const { SERVICE_PRICES } = require('./groomingController');
const { ROOM_PRICES, ROOM_DETAILS } = require('./hotelController');
const { createQrPhCheckout, getCheckoutSession, expireCheckoutSession, getPayMongoKey, isCheckoutSessionPaid } = require('../util/paymongo');
const { parseToken: parseCustomerToken } = require('../util/customerAuth');
const { parseToken: parseAdminToken } = require('../util/adminAuth');
const {
  BookingConflictError,
  groomingLockIds,
  hotelLockIdsForTypes,
  HOTEL_DAILY_CAPACITY,
  hotelLockIdsForSlots,
  hotelLockIdsForAssignments,
  claimHotelSlots,
  hotelDateKeys,
  getUnavailableBookingSlotIds,
  claimBookingSlots,
  releaseBookingSlots,
  releaseBookingSlotsByIds,
} = require('../util/bookingLocks');
const { validateTime, validatePickupTime } = require('../util/businessHours');
const { sendPayMongoReceipt } = require('../util/mailer');
const { isValidMobileNumber } = require('../util/mobileNumber');
const { notifyStaffOfBooking, notifyStaffOfCancellation } = require('../util/staffNotifications');

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const isValidDateKey = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const businessDateKeyToday = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const normalizeRoomType = (roomType) => {
  const aliases = {
    standard: 'staycation-standard',
    deluxe: 'staycation-deluxe',
  };
  const value = String(roomType || '').trim().toLowerCase();
  return aliases[value] || value;
};

const reservationRoomTypes = (reservation) => [...new Set(
  (Array.isArray(reservation.roomTypes) && reservation.roomTypes.length
    ? reservation.roomTypes
    : Array.isArray(reservation.petRooms) && reservation.petRooms.length
      ? reservation.petRooms.map((petRoom) => petRoom.roomType)
      : [reservation.roomType])
    .map(normalizeRoomType)
    .filter(Boolean)
)];

const reservationPetCount = (reservation) => Math.max(
  1,
  (Array.isArray(reservation.petRooms) && reservation.petRooms.length)
    || (Array.isArray(reservation.petIds) && reservation.petIds.length)
    || (reservation.petId ? 1 : 0),
);

const isHotelReservationOccupyingSpace = (reservation) => !['cancelled', 'checked-out'].includes(reservation.status);

const getLegacyHotelOccupancyByDate = async (checkIn, checkOut, excludeReservationId = null) => {
  const reservations = await HotelReservation.findAll();
  const occupancy = new Map(hotelDateKeys(checkIn, checkOut).map((date) => [date, new Set()]));
  for (const reservation of reservations) {
    if (!isHotelReservationOccupyingSpace(reservation)
      || (excludeReservationId && String(reservation.id) === String(excludeReservationId))
      || reservation.checkIn >= checkOut
      || (reservation.status !== 'checked-in' && reservation.checkOut <= checkIn)) continue;
    const petCount = reservationPetCount(reservation);
    const keepOccupiedUntilCheckedOut = reservation.status === 'checked-in';
    const overlapDates = hotelDateKeys(
      reservation.checkIn > checkIn ? reservation.checkIn : checkIn,
      keepOccupiedUntilCheckedOut || reservation.checkOut >= checkOut ? checkOut : reservation.checkOut,
    );
    for (const date of overlapDates) {
      const usedSlots = occupancy.get(date);
      const recordedSlots = reservation.hotelSlotAssignments?.[date]
        || (keepOccupiedUntilCheckedOut ? Object.values(reservation.hotelSlotAssignments || {}).find((slots) => slots.length) : null)
        || reservation.hotelSlotNumbers
        || [];
      if (recordedSlots.length) {
        recordedSlots.forEach((slot) => usedSlots.add(Number(slot)));
        continue;
      }
      let assigned = 0;
      for (let slot = 1; slot <= HOTEL_DAILY_CAPACITY && assigned < petCount; slot += 1) {
        if (!usedSlots.has(slot)) {
          usedSlots.add(slot);
          assigned += 1;
        }
      }
    }
  }
  return occupancy;
};

const hotelSlotsForDates = async (reservations, dates) => {
  const unavailable = new Map(dates.map((date) => [date, new Set()]));
  for (const reservation of reservations) {
    if (!isHotelReservationOccupyingSpace(reservation)) continue;
    for (const date of dates) {
      const keepOccupiedUntilCheckedOut = reservation.status === 'checked-in';
      if (reservation.checkIn > date || (!keepOccupiedUntilCheckedOut && reservation.checkOut <= date)) continue;
      const recordedSlots = reservation.hotelSlotAssignments?.[date]
        || (keepOccupiedUntilCheckedOut ? Object.values(reservation.hotelSlotAssignments || {}).find((slots) => slots.length) : null)
        || reservation.hotelSlotNumbers
        || [];
      const usedSlots = unavailable.get(date);
      if (recordedSlots.length) {
        recordedSlots.forEach((slot) => usedSlots.add(Number(slot)));
      } else {
        let assigned = 0;
        for (let slot = 1; slot <= HOTEL_DAILY_CAPACITY && assigned < reservationPetCount(reservation); slot += 1) {
          if (!usedSlots.has(slot)) {
            usedSlots.add(slot);
            assigned += 1;
          }
        }
      }
    }
  }
  return unavailable;
};

const getAvailableHotelSlots = async (reservations, checkIn, checkOut) => {
  const stayDates = hotelDateKeys(checkIn, checkOut);
  const occupiedByDate = await hotelSlotsForDates(reservations, stayDates);
  const lockIds = hotelLockIdsForSlots(
    Array.from({ length: HOTEL_DAILY_CAPACITY }, (_, index) => index + 1),
    checkIn,
    checkOut,
  );
  const locked = await getUnavailableBookingSlotIds(lockIds);
  return Array.from({ length: HOTEL_DAILY_CAPACITY }, (_, index) => index + 1)
    .filter((slot) => stayDates.every((date) => !occupiedByDate.get(date).has(slot)
      && !locked.has(`hotel_capacity_${date}_${slot}`)));
};

const hotelReservationLockIds = (reservation) => reservation.hotelSlotAssignments
  ? hotelLockIdsForAssignments(reservation.hotelSlotAssignments)
  : Array.isArray(reservation.hotelSlotNumbers)
    ? hotelLockIdsForSlots(reservation.hotelSlotNumbers, reservation.checkIn, reservation.checkOut)
    : hotelLockIdsForTypes(reservationRoomTypes(reservation), reservation.checkIn, reservation.checkOut);

const getCookie = (req, name) => {
  const part = (req.headers.cookie || '').split(';').map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.split('=').slice(1).join('=')) : null;
};

const getSignedInCustomer = async (req) => {
  const email = parseCustomerToken(getCookie(req, 'customer_token'));
  return email ? Customer.findOne({ where: { email } }) : null;
};

const canAccessBooking = async (req, booking) => {
  if (parseAdminToken(getCookie(req, 'admin_token')) === 'ADMIN') return true;
  const customer = await getSignedInCustomer(req);
  return Boolean(customer && String(customer.id) === String(booking.customerId));
};

const paymentDetails = (paymentMethod) => ({
  paymentMethod: paymentMethod === 'qrph' ? 'qrph' : 'cash',
  paymentStatus: paymentMethod === 'qrph' ? 'pending' : 'unpaid',
});

const startGcashCheckout = async ({ req, bookingType, bookingId, amount, description }) => {
  const appUrl = new URL(process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`);
  if (['glamgrooms.net', 'www.glamgrooms.net'].includes(appUrl.hostname.toLowerCase())) {
    appUrl.protocol = 'https:';
    appUrl.hostname = 'www.glamgrooms.net';
  }
  const baseUrl = appUrl.origin;
  return createQrPhCheckout({
    amount,
    description,
    metadata: { bookingType, bookingId: String(bookingId) },
    successUrl: `${baseUrl}/payment-success.html?booking_type=${encodeURIComponent(bookingType)}&booking_id=${encodeURIComponent(bookingId)}`,
    cancelUrl: `${baseUrl}/payment-cancelled.html?booking_type=${encodeURIComponent(bookingType)}&booking_id=${encodeURIComponent(bookingId)}`,
  });
};

// Finds a customer by email or creates a new one, then registers the pet.
const findOrCreateCustomerWithPets = async (customerData, petsData, signedInCustomer = null) => {
  let customer = signedInCustomer || await Customer.findOne({
    where: { email: customerData.email },
  });
  if (!customer) {
    customer = await Customer.create(customerData);
  }

  const pets = await Promise.all(petsData.map(async (petData) => {
    if (petData.id) {
      const existingPet = await Pet.findByPk(petData.id);
      if (!existingPet || String(existingPet.customerId) !== String(customer.id)) {
        const error = new Error('A selected pet profile does not belong to your account.');
        error.status = 403;
        throw error;
      }
      return existingPet;
    }
    return Pet.create({
      name: String(petData.name || '').trim(),
      species: String(petData.species || '').trim().toLowerCase(),
      breed: String(petData.breed || '').trim(),
      age: Number(petData.age),
      customerId: customer.id,
    });
  }));

  return { customer, pets };
};

const cleanupAbandonedPayMongoBookings = async () => {
  const EXPIRY_MS = 15 * 60 * 1000;
  const now = Date.now();
  const expireStaleCheckout = async (booking) => {
    const sessionId = String(booking.paymentReference || '').trim();
    if (!sessionId) return false;

    let checkout = await getCheckoutSession(sessionId);
    let attributes = checkout.data?.attributes || {};
    if (isCheckoutSessionPaid(attributes)) {
      await markBookingPaidAndConfirmed(booking, sessionId);
      return false;
    }
    if (attributes.status === 'expired') return true;

    try {
      checkout = await expireCheckoutSession(sessionId);
      attributes = checkout.data?.attributes || {};
    } catch (expireError) {
      checkout = await getCheckoutSession(sessionId);
      attributes = checkout.data?.attributes || {};
    }

    if (isCheckoutSessionPaid(attributes)) {
      await markBookingPaidAndConfirmed(booking, sessionId);
      return false;
    }
    return attributes.status === 'expired';
  };

  try {
    const groomingPending = await GroomingAppointment.findAll({
      where: { paymentMethod: 'qrph', paymentStatus: 'pending' },
    });
    for (const appt of groomingPending) {
      const isExpired = appt.createdAt && (now - new Date(appt.createdAt).getTime() > EXPIRY_MS);
      if (isExpired && await expireStaleCheckout(appt)) {
        await releaseGroomingBookingSlots(appt.date, appt.time, groomingRecordDuration(appt));
        await appt.destroy();
      }
    }

    const hotelPending = await HotelReservation.findAll({
      where: { paymentMethod: 'qrph', paymentStatus: 'pending' },
    });
    for (const resv of hotelPending) {
      const isExpired = resv.createdAt && (now - new Date(resv.createdAt).getTime() > EXPIRY_MS);
      if (isOwner || isExpired) {
        const lockIds = hotelReservationLockIds(resv);
        await releaseBookingSlotsByIds(lockIds);
        await resv.destroy();
      }
    }
  } catch (err) {
    console.error('Error cleaning up abandoned PayMongo bookings:', err);
  }
};

// POST /api/v1/bookings/grooming
  // One-shot public booking: customer info + pet info + appointment details.
  const bookGrooming = async (req, res, next) => {
  try {
    const { customer: customerData, pet: petData, pets: submittedPets, service, date, time, pickupTime, notes, paymentMethod } = req.body;
    const petsData = Array.isArray(submittedPets) && submittedPets.length ? submittedPets : [petData];
    const petServiceKeys = petsData.map((pet) => String(pet?.service || service || ''));

    if (!customerData || !petsData[0]) {
      return res.status(400).json({ error: 'Customer and pet information are required' });
    }
    if (!isOptionalPhoneNumber(customerData.phone)) {
      return res.status(400).json({ error: 'Phone number must contain digits only.' });
    }
    const signedInCustomer = await getSignedInCustomer(req);
    if (!signedInCustomer || String(signedInCustomer.email).toLowerCase() !== String(customerData.email).trim().toLowerCase()) {
      return res.status(401).json({ error: 'Please sign in with the customer account used for this booking.' });
    }
    if (!isValidMobileNumber(customerData.phone)) {
      return res.status(400).json({ error: 'Phone number must contain exactly 11 digits.' });
    }
    if (!String(customerData.address || '').trim()) return res.status(400).json({ error: 'Address is required' });

    // Release only stale PayMongo attempts; never delete a customer's active checkout.
    await cleanupAbandonedPayMongoBookings();
    if (petsData.length > 5) return res.status(400).json({ error: 'A booking may include up to 5 pets.' });
    const selectedPetIds = petsData.filter((pet) => pet.id).map((pet) => String(pet.id));
    if (new Set(selectedPetIds).size !== selectedPetIds.length) {
      return res.status(400).json({ error: 'Choose a saved pet only once per booking.' });
    }
    if (petsData.some((pet) => !['dog', 'cat'].includes(String(pet.species).toLowerCase()) || !String(pet.name || '').trim())) {
      return res.status(400).json({ error: 'Our services are available for cats and dogs only, and each pet needs a name' });
    }
    if (petsData.some((pet) => !String(pet.breed || '').trim() || !isDigitsOnly(pet.age) || Number(pet.age) > 50)) {
      return res.status(400).json({ error: 'Each pet needs a breed and valid age' });
    }
    if (petServiceKeys.some((petService) => !Object.prototype.hasOwnProperty.call(SERVICE_PRICES, petService))) {
      return res.status(400).json({ error: 'A valid service is required for every pet' });
    }
    if (!date || !time) {
      return res.status(400).json({ error: 'A valid date and time are required' });
    }
    if (!isValidDateKey(date) || date < businessDateKeyToday()) {
      return res.status(400).json({ error: 'Choose today or a future grooming date.' });
    }
    if (paymentMethod === 'qrph' && !getPayMongoKey()) {
      return res.status(503).json({ error: 'Online GCash payment is not configured. Please choose counter cash or contact the administrator.' });
    }
    const timeCheck = validateFutureBookingTime(date, time, 'Appointment');
    if (!timeCheck.ok) return res.status(400).json({ error: timeCheck.error });
    if (!isFutureBooking({ date, time }, 'grooming')) {
      return res.status(400).json({ error: 'Choose a future appointment time.' });
    }
    if (!pickupTime) return res.status(400).json({ error: 'A pickup time is required' });
    const pickupCheck = validatePickupTime(date, pickupTime);
    if (!pickupCheck.ok) return res.status(400).json({ error: pickupCheck.error });
    if (timeToMinutes(pickupTime) < timeToMinutes(durationCheck.pickupEarliest)) {
      return res.status(400).json({ error: `Pickup must be at or after ${durationCheck.pickupEarliest}, when the selected services are complete.` });
    }

    const requestedStart = timeToMinutes(time);
    const requestedEnd = requestedStart + durationMinutes;
    const existingAppointments = await GroomingAppointment.findAll({ where: { date } });
    if (existingAppointments.some((appointment) => {
      if (appointment.status === 'cancelled') return false;
      const existingStart = timeToMinutes(appointment.time);
      if (existingStart === null) return false;
      return existingStart < requestedEnd && existingStart + groomingRecordDuration(appointment) > requestedStart;
    })) {
      throw new BookingConflictError('That schedule is already booked. The first customer to request it was prioritized. Please choose another time or date.');
    }

    const lockRefs = await claimBookingSlots(groomingLockIds(date, time, durationMinutes), { type: 'grooming', date, time, durationMinutes });
    let appointmentCreated = false;
    let appointmentRecord = null;
    try {
      const { customer, pets } = await findOrCreateCustomerWithPets(customerData, petsData, signedInCustomer);
      const primaryPet = pets[0];
      const petServices = pets.map((pet, index) => ({
        petId: pet.id,
        petName: pet.name,
        service: petServiceKeys[index],
        price: SERVICE_PRICES[petServiceKeys[index]],
      }));
      const distinctServices = [...new Set(petServiceKeys)];
      const totalPrice = petServices.reduce((sum, item) => sum + item.price, 0);

      const appointment = await GroomingAppointment.create({
        service: distinctServices.length === 1 ? distinctServices[0] : 'multiple-services',
        petServices,
        customerDetails: {
          name: customerData.name || customer.name,
          email: customerData.email || customer.email,
          phone: customerData.phone || customer.phone,
          address: customerData.address || customer.address,
        },
        date,
        time,
        pickupTime: pickupTime || null,
        notes,
        customerId: customer.id,
        petId: primaryPet.id,
        petIds: pets.map((pet) => pet.id),
        petNames: pets.map((pet) => pet.name),
        petTypes: pets.map((pet) => pet.type || 'adult'), // Include pet type in the record
        status: 'pending',
        price: totalPrice,
        ...paymentDetails(paymentMethod),
      });
      appointmentRecord = appointment;
      let checkout = null;
      if (paymentMethod === 'qrph') {
        checkout = await startGcashCheckout({
          req,
          bookingType: 'grooming',
          bookingId: appointment.id,
          amount: appointment.price,
          description: `Glam Grooms grooming for ${pets.length} pet${pets.length === 1 ? '' : 's'}`,
        });
        if (!checkout.checkoutUrl) throw new Error('PayMongo did not return a checkout URL.');
        if (!checkout.id) throw new Error('PayMongo did not return a checkout session ID.');
        await appointment.update({ paymentReference: checkout.id });
      }
      appointmentCreated = true;
      if (appointment.paymentMethod !== 'qrph') {
        await notifyStaffOfBooking({ type: 'grooming', booking: appointment, customer, pets });
      }
      res.status(201).json({ message: 'Grooming appointment booked', appointment, customer, pet: primaryPet, pets, checkout });
    } finally {
      if (!appointmentCreated) await releaseBookingSlots(lockRefs);
      if (!appointmentCreated && appointmentRecord) await appointmentRecord.destroy();
    }
  } catch (error) {
    if (error instanceof BookingConflictError) return res.status(error.status).json({ error: error.message });
    next(error);
  }
};

// POST /api/v1/bookings/hotel
// One-shot public reservation: customer info + pet info + stay details.
const bookHotel = async (req, res, next) => {
  try {
    const { customer: customerData, pet: petData, pets: submittedPets, roomType: submittedRoomType, slotNumbers: submittedSlotNumbers, checkIn, checkInTime, checkOut, checkOutTime, notes, paymentMethod } = req.body;
    const roomType = normalizeRoomType(submittedRoomType);
    const petsData = Array.isArray(submittedPets) && submittedPets.length ? submittedPets : [petData];
    const petRoomTypes = petsData.map((pet) => normalizeRoomType(pet?.roomType || submittedRoomType));

    if (!customerData || !petsData[0]) {
      return res.status(400).json({ error: 'Customer and pet information are required' });
    }
    if (!isOptionalPhoneNumber(customerData.phone)) {
      return res.status(400).json({ error: 'Phone number must contain digits only.' });
    }
    const signedInCustomer = await getSignedInCustomer(req);
    if (!signedInCustomer || String(signedInCustomer.email).toLowerCase() !== String(customerData.email).trim().toLowerCase()) {
      return res.status(401).json({ error: 'Please sign in with the customer account used for this booking.' });
    }
    if (!isValidMobileNumber(customerData.phone)) {
      return res.status(400).json({ error: 'Phone number must contain exactly 11 digits.' });
    }
    if (!String(customerData.address || '').trim()) return res.status(400).json({ error: 'Address is required' });

    // Release only stale PayMongo attempts; never delete a customer's active checkout.
    await cleanupAbandonedPayMongoBookings();
    if (petsData.length > 5) return res.status(400).json({ error: 'A booking may include up to 5 pets.' });
    const selectedPetIds = petsData.filter((pet) => pet.id).map((pet) => String(pet.id));
    if (new Set(selectedPetIds).size !== selectedPetIds.length) {
      return res.status(400).json({ error: 'Choose a saved pet only once per booking.' });
    }
    if (petsData.some((pet) => !['dog', 'cat'].includes(String(pet.species).toLowerCase()) || !String(pet.name || '').trim())) {
      return res.status(400).json({ error: 'Our services are available for cats and dogs only, and each pet needs a name' });
    }
    if (petsData.some((pet) => !String(pet.breed || '').trim() || !isDigitsOnly(pet.age) || Number(pet.age) > 50)) {
      return res.status(400).json({ error: 'Each pet needs a breed and valid age' });
    }
    if (petRoomTypes.some((petRoomType) => !Object.prototype.hasOwnProperty.call(ROOM_PRICES, petRoomType))) {
      return res.status(400).json({ error: 'A valid room type is required for every pet' });
    }

    if (!isValidDateKey(checkIn) || !isValidDateKey(checkOut)) {
      return res.status(400).json({ error: 'Choose valid check-in and check-out dates.' });
    }
    if (checkIn < businessDateKeyToday()) {
      return res.status(400).json({ error: 'Choose today or a future hotel check-in date.' });
    }
    const nights = Math.round((new Date(checkOut) - new Date(checkIn)) / MS_PER_DAY);
    if (nights < 1) {
      return res.status(400).json({ error: 'Check-out must be after check-in' });
    }
    if (!Array.isArray(submittedSlotNumbers)
      || submittedSlotNumbers.length !== petsData.length
      || submittedSlotNumbers.some((slot) => !Number.isInteger(slot) || slot < 1 || slot > HOTEL_DAILY_CAPACITY)
      || new Set(submittedSlotNumbers).size !== submittedSlotNumbers.length) {
      return res.status(400).json({ error: `Choose ${petsData.length} different available hotel slot${petsData.length === 1 ? '' : 's'} from 1 to ${HOTEL_DAILY_CAPACITY}.` });
    }
    if (!checkInTime || !checkOutTime) {
      return res.status(400).json({ error: 'Check-in and check-out times are required' });
    }
    const checkInCheck = validateTime(checkIn, checkInTime);
    if (!checkInCheck.ok) return res.status(400).json({ error: checkInCheck.error });
    const futureCheckInTime = validateFutureBookingTime(checkIn, checkInTime, 'Check-in');
    if (!futureCheckInTime.ok) return res.status(400).json({ error: futureCheckInTime.error });
    const checkOutCheck = validateTime(checkOut, checkOutTime);
    if (!checkOutCheck.ok) return res.status(400).json({ error: checkOutCheck.error });
    if (paymentMethod === 'qrph' && !getPayMongoKey()) {
      return res.status(503).json({ error: 'Online GCash payment is not configured. Please choose counter cash or contact the administrator.' });
    }

    const requestedRoomTypes = [...new Set(petRoomTypes)];
    const hotelSlotOwnerId = randomUUID();
    const legacyOccupancyByDate = await getLegacyHotelOccupancyByDate(checkIn, checkOut);
    const hotelSlotAssignments = await claimHotelSlots({
      checkIn,
      checkOut,
      slotCount: petsData.length,
      selectedSlotNumbers: submittedSlotNumbers,
      legacyOccupancyByDate,
      ownerId: hotelSlotOwnerId,
      details: { roomTypes: requestedRoomTypes, checkIn, checkOut },
    });
    const hotelLockIds = hotelLockIdsForAssignments(hotelSlotAssignments);
    let reservationCreated = false;
    let reservationRecord = null;
    try {
      const { customer, pets } = await findOrCreateCustomerWithPets(customerData, petsData, signedInCustomer);
      const primaryPet = pets[0];

      const petRooms = pets.map((pet, index) => ({
        petId: pet.id,
        petName: pet.name,
        roomType: petRoomTypes[index],
        pricePerNight: quote.petQuotes[index].effectiveNightlyRate,
      }));
      const pricePerNight = quote.total / nights;
      const totalPrice = quote.total;
      const reservation = await HotelReservation.create({
        roomType: requestedRoomTypes.length === 1 ? requestedRoomTypes[0] : 'multiple-rooms',
        roomTypes: requestedRoomTypes,
        petRooms,
        customerDetails: {
          name: customerData.name || customer.name,
          email: customerData.email || customer.email,
          phone: customerData.phone || customer.phone,
          address: customerData.address || customer.address,
        },
        checkIn,
        checkInTime,
        checkOut,
        checkOutTime,
        notes,
        customerId: customer.id,
        petId: primaryPet.id,
        petIds: pets.map((pet) => pet.id),
        petNames: pets.map((pet) => pet.name),
        petTypes: pets.map((pet) => pet.type || 'adult'), // Include pet type in the record
        capacityManaged: true,
        capacityLockIds,
        status: 'pending',
        hotelSlotAssignments,
        hotelSlotOwnerId,
        pricePerNight,
        totalPrice,
        pricingBreakdown: quote,
        roomDetails: requestedRoomTypes.length === 1 ? ROOM_DETAILS[requestedRoomTypes[0]] : null,
        roomDetailsByType: Object.fromEntries(requestedRoomTypes.map((type) => [type, ROOM_DETAILS[type]])),
        ...paymentDetails(paymentMethod),
      });
      reservationRecord = reservation;
      let checkout = null;
      if (paymentMethod === 'qrph') {
        checkout = await startGcashCheckout({
          req,
          bookingType: 'hotel',
          bookingId: reservation.id,
          amount: reservation.totalPrice,
          description: `Glam Grooms ${roomType} hotel reservation`,
        });
        if (!checkout.checkoutUrl) throw new Error('PayMongo did not return a checkout URL.');
        if (!checkout.id) throw new Error('PayMongo did not return a checkout session ID.');
        await reservation.update({ paymentReference: checkout.id });
      }
      reservationCreated = true;
      if (reservation.paymentMethod !== 'qrph') {
        await notifyStaffOfBooking({ type: 'hotel', booking: reservation, customer, pets });
      }
      res.status(201).json({ message: 'Hotel reservation booked', reservation, customer, pet: primaryPet, pets, checkout });
    } finally {
      if (!reservationCreated) await releaseBookingSlotsByIds(hotelLockIds);
      if (!reservationCreated && reservationRecord) await reservationRecord.destroy();
    }
  } catch (error) {
    if (error instanceof BookingConflictError) return res.status(error.status).json({ error: error.message });
    next(error);
  }
};

const verifyPayment = async (req, res, next) => {
  try {
    let sessionId = String(req.body?.sessionId || '').trim();
    const requestedBookingType = String(req.body?.bookingType || '').trim();
    const requestedBookingId = String(req.body?.bookingId || '').trim();
    let booking = null;

    if (requestedBookingType || requestedBookingId) {
      if (!['grooming', 'hotel'].includes(requestedBookingType) || !requestedBookingId) {
        return res.status(400).json({ error: 'A valid booking type and ID are required.' });
      }
      const RequestedModel = requestedBookingType === 'hotel' ? HotelReservation : GroomingAppointment;
      booking = await RequestedModel.findByPk(requestedBookingId);
      if (!booking) return res.status(404).json({ error: 'Booking not found' });
      if (!(await canAccessBooking(req, booking))) return res.status(403).json({ error: 'You are not allowed to update this booking.' });
      if (booking.paymentMethod !== 'qrph') return res.status(409).json({ error: 'This booking was not paid through PayMongo.' });

      const storedSessionId = String(booking.paymentReference || '').trim();
      if (!/^cs_[A-Za-z0-9]+$/.test(sessionId)) sessionId = storedSessionId;
      else if (storedSessionId && storedSessionId !== sessionId) {
        return res.status(409).json({ error: 'The checkout session does not match this booking.' });
      }
    }
    if (!/^cs_[A-Za-z0-9]+$/.test(sessionId)) {
      return res.status(400).json({ error: 'A valid PayMongo checkout session is not available for this booking.' });
    }

    const result = await getCheckoutSession(sessionId);
    const attributes = result.data?.attributes || {};
    if (!isCheckoutSessionPaid(attributes)) return res.status(400).json({ error: 'Payment has not been completed.' });

    const metadata = attributes.metadata || {};
    if (!['grooming', 'hotel'].includes(metadata.bookingType) || !metadata.bookingId) {
      return res.status(400).json({ error: 'The payment is not linked to a valid booking.' });
    }
    if (booking && (requestedBookingType !== metadata.bookingType || String(booking.id) !== String(metadata.bookingId))) {
      return res.status(409).json({ error: 'The PayMongo session does not match this booking.' });
    }
    const Model = metadata.bookingType === 'hotel' ? HotelReservation : GroomingAppointment;
    booking = booking || await Model.findByPk(metadata.bookingId);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (!(await canAccessBooking(req, booking))) return res.status(403).json({ error: 'You are not allowed to update this booking.' });
    if (booking.paymentMethod !== 'qrph') return res.status(409).json({ error: 'This booking was not paid through PayMongo.' });
    const alreadyVerified = booking.paymentStatus === 'paid' && booking.paymentReference === sessionId;
    if (!alreadyVerified && (booking.paymentStatus !== 'pending' || booking.status === 'cancelled')) {
      return res.status(409).json({ error: 'This booking is no longer available for payment.' });
    }
    if (!alreadyVerified || (metadata.bookingType === 'hotel' && booking.status !== 'confirmed')) {
      const paymentUpdate = { paymentStatus: 'paid', paymentReference: sessionId, paymentPaidAt: new Date() };
      if (metadata.bookingType === 'hotel') {
        paymentUpdate.status = 'confirmed';
        paymentUpdate.confirmedAt = booking.confirmedAt || new Date();
      }
      await booking.update(paymentUpdate);
    }

    const [customer, pets] = await Promise.all([
      Customer.findByPk(booking.customerId),
      Promise.all((booking.petIds || (booking.petId ? [booking.petId] : [])).map((petId) => Pet.findByPk(petId))),
    ]);
    await notifyStaffOfBooking({ type: metadata.bookingType, booking, customer, pets: pets.filter(Boolean) });
    const petNames = booking.petNames && booking.petNames.length
      ? booking.petNames
      : pets.filter(Boolean).map((pet) => pet.name);
    const receipt = {
      bookingType: metadata.bookingType,
      bookingId: booking.id,
      customerName: customer ? customer.name : 'Customer',
      petNames,
      paymentMethod: 'GCash QR Ph',
      paymentReference: sessionId,
      paidAt: booking.paymentPaidAt || booking.updatedAt || new Date(),
      amount: Number(metadata.bookingType === 'hotel' ? booking.totalPrice : booking.price),
    };
    try {
      await sendPayMongoReceipt({
        bookingRecord: booking,
        type: metadata.bookingType,
        to: customer && customer.email,
        customer: booking.customerDetails || customer || {},
        pets: pets.filter(Boolean),
      });
    } catch (emailError) {
      console.error('PayMongo payment receipt email failed:', emailError);
    }
    try {
      await sendReservationTicket({
        bookingRecord: booking,
        type: metadata.bookingType,
        to: customer && customer.email,
        customer: booking.customerDetails || customer || {},
        pets: pets.filter(Boolean),
      });
    } catch (emailError) {
      console.error('PayMongo reservation ticket email failed:', emailError);
    }
    if (metadata.bookingType === 'hotel') {
      Object.assign(receipt, {
        service: booking.roomType,
        roomTypes: booking.roomTypes || [booking.roomType],
        petRooms: booking.petRooms || [],
        checkIn: booking.checkIn,
        checkInTime: booking.checkInTime,
        checkOut: booking.checkOut,
        checkOutTime: booking.checkOutTime,
      });
    } else {
      Object.assign(receipt, {
        service: booking.service,
        petServices: booking.petServices || [],
        date: booking.date,
        time: booking.time,
        pickupTime: booking.pickupTime || null,
      });
    }
    res.json({ success: true, bookingType: metadata.bookingType, bookingId: booking.id, receipt });
  } catch (error) {
    next(error);
  }
};

const cancelPayment = async (req, res, next) => {
  try {
    const bookingType = req.body?.bookingType === 'hotel' ? 'hotel' : 'grooming';
    const bookingId = String(req.body?.bookingId || '').trim();
    if (!bookingId) return res.status(400).json({ error: 'A booking ID is required' });

    const Model = bookingType === 'hotel' ? HotelReservation : GroomingAppointment;
    const booking = await Model.findByPk(bookingId);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (!(await canAccessBooking(req, booking))) return res.status(403).json({ error: 'You are not allowed to cancel this booking.' });
    let deleted = false;
    if (booking.paymentStatus === 'pending') {
      const sessionId = String(booking.paymentReference || '').trim();
      if (!sessionId) {
        return res.status(409).json({ error: 'The payment session cannot be verified, so this booking was kept. Please contact the business before trying to pay again.' });
      }

      let checkout = await getCheckoutSession(sessionId);
      let attributes = checkout.data?.attributes || {};
      if (isCheckoutSessionPaid(attributes)) {
        await markBookingPaidAndConfirmed(booking, sessionId);
        return res.json({ success: true, bookingId, paid: true, deleted: false });
      }

      if (attributes.status !== 'expired') {
        try {
          checkout = await expireCheckoutSession(sessionId);
          attributes = checkout.data?.attributes || {};
        } catch (expireError) {
          checkout = await getCheckoutSession(sessionId);
          attributes = checkout.data?.attributes || {};
          if (isCheckoutSessionPaid(attributes)) {
            await markBookingPaidAndConfirmed(booking, sessionId);
            return res.json({ success: true, bookingId, paid: true, deleted: false });
          }
          if (attributes.status !== 'expired') {
            return res.status(409).json({ error: 'Payment is still processing, so this booking was kept. Please check your profile before trying to pay again.' });
          }
        }
      }

      if (isCheckoutSessionPaid(attributes)) {
        await markBookingPaidAndConfirmed(booking, sessionId);
        return res.json({ success: true, bookingId, paid: true, deleted: false });
      }
      if (attributes.status !== 'expired') {
        return res.status(409).json({ error: 'PayMongo could not confirm cancellation, so this booking was kept. Please contact the business before trying to pay again.' });
      }

      const lockIds = bookingType === 'hotel'
        ? hotelReservationLockIds(booking)
        : groomingLockIds(booking.date, booking.time);
      await releaseBookingSlotsByIds(lockIds);
      await booking.destroy();
      deleted = true;
    }
    res.json({ success: true, bookingId, deleted, paid: booking.paymentStatus === 'paid' });
  } catch (error) {
    next(error);
  }
};

const customerBookingContext = async (req, res, bookingType) => {
  const customer = await getSignedInCustomer(req);
  if (!customer) {
    res.status(401).json({ error: 'Sign in to manage your bookings.' });
    return null;
  }
  const Model = bookingType === 'hotel' ? HotelReservation : GroomingAppointment;
  const booking = await Model.findByPk(req.params.id);
  if (!booking || String(booking.customerId) !== String(customer.id)) {
    res.status(404).json({ error: 'Booking not found.' });
    return null;
  }
  return { customer, booking };
};

const isFutureBooking = (booking, bookingType) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const values = Object.fromEntries(formatter.formatToParts(new Date())
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  const nowDate = `${values.year}-${values.month}-${values.day}`;
  const nowTime = `${values.hour}:${values.minute}`;
  const startDate = bookingType === 'hotel' ? booking.checkIn : booking.date;
  const startTime = bookingType === 'hotel' ? booking.checkInTime : booking.time;
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return false;
  const parsedDate = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== startDate) return false;
  return startDate > nowDate || (startDate === nowDate && (!startTime || startTime > nowTime));
};

const ensureCustomerCanChangeBooking = (booking, bookingType, res) => {
  if (String(booking.status || '').toLowerCase() !== 'pending') {
    res.status(409).json({ error: 'Only pending bookings can be changed from your account.' });
    return false;
  }
  if (!isFutureBooking(booking, bookingType)) {
    res.status(409).json({ error: 'Only upcoming pending bookings can be changed from your account.' });
    return false;
  }
  if (booking.paymentStatus === 'paid' || booking.paymentMethod === 'qrph') {
    res.status(409).json({ error: 'Only unpaid counter-payment bookings can be changed online. Contact the team about paid or pending QR bookings.' });
    return false;
  }
  return true;
};

const updateCustomerBooking = async (req, res, next) => {
  try {
    const bookingType = req.params.bookingType;
    if (!['grooming', 'hotel'].includes(bookingType)) {
      return res.status(400).json({ error: 'Choose grooming or hotel as the booking type.' });
    }
    const context = await customerBookingContext(req, res, bookingType);
    if (!context) return;
    const { booking } = context;
    if (!ensureCustomerCanChangeBooking(booking, bookingType, res)) return;
    const body = req.body || {};
    const notes = body.notes === undefined ? booking.notes : String(body.notes).trim().slice(0, 1000) || null;

    if (bookingType === 'grooming') {
      const date = String(body.date || '').trim();
      const time = String(body.time || '').trim();
      const pickupTime = String(body.pickupTime || '').trim();
      if (!isValidDateKey(date)) {
        return res.status(400).json({ error: 'Choose a valid appointment date.' });
      }
      const timeCheck = validateTime(date, time);
      if (!timeCheck.ok) return res.status(400).json({ error: timeCheck.error });
      if (!pickupTime) return res.status(400).json({ error: 'A pickup time is required.' });
      const pickupCheck = validatePickupTime(date, pickupTime);
      if (!pickupCheck.ok) return res.status(400).json({ error: pickupCheck.error });

      const oldLockIds = groomingLockIds(booking.date, booking.time);
      const newLockIds = groomingLockIds(date, time);
      const scheduleChanged = date !== booking.date || time !== booking.time;
      let claimedLockIds = [];
      if (scheduleChanged) {
        claimedLockIds = await claimReplacementBookingSlots(oldLockIds, newLockIds, { type: 'grooming', date, time });
      }
      try {
        await booking.update({ date, time, pickupTime, notes });
      } catch (error) {
        if (claimedLockIds.length) await releaseBookingSlotsByIds(claimedLockIds);
        throw error;
      }
      if (scheduleChanged) {
        await releaseBookingSlotsByIds(oldLockIds.filter((id) => !newLockIds.includes(id)));
      }
      return res.json({ success: true, bookingId: booking.id });
    }

    const checkIn = String(body.checkIn || '').trim();
    const checkInTime = String(body.checkInTime || '').trim();
    const checkOut = String(body.checkOut || '').trim();
    const checkOutTime = String(body.checkOutTime || '').trim();
    if (!isValidDateKey(checkIn) || !isValidDateKey(checkOut)) {
      return res.status(400).json({ error: 'Choose valid check-in and check-out dates.' });
    }
    const nights = Math.round((new Date(`${checkOut}T00:00:00Z`) - new Date(`${checkIn}T00:00:00Z`)) / MS_PER_DAY);
    if (nights < 1) return res.status(400).json({ error: 'Check-out must be after check-in.' });
    const checkInCheck = validateTime(checkIn, checkInTime);
    if (!checkInCheck.ok) return res.status(400).json({ error: checkInCheck.error });
    const checkOutCheck = validateTime(checkOut, checkOutTime);
    if (!checkOutCheck.ok) return res.status(400).json({ error: checkOutCheck.error });
    if (!isFutureBooking({ checkIn, checkInTime }, 'hotel')) {
      return res.status(400).json({ error: 'Choose a future hotel check-in time.' });
    }

    const roomTypes = reservationRoomTypes(booking);
    const oldLockIds = hotelReservationLockIds(booking);
    const stayChanged = checkIn !== booking.checkIn || checkOut !== booking.checkOut;
    const ownerId = booking.hotelSlotOwnerId || String(booking.id);
    const legacyOccupancyByDate = await getLegacyHotelOccupancyByDate(checkIn, checkOut, booking.id);
    let claimedLockIds = [];
    let newSlotAssignments = booking.hotelSlotAssignments || {};
    if (stayChanged) {
      newSlotAssignments = await claimHotelSlots({
        checkIn,
        checkOut,
        slotCount: reservationPetCount(booking),
        selectedSlotNumbers: Object.values(booking.hotelSlotAssignments || {})[0] || booking.hotelSlotNumbers,
        legacyOccupancyByDate,
        ownerId,
        details: { roomTypes, checkIn, checkOut, bookingId: String(booking.id) },
      });
      const newLockIds = hotelLockIdsForAssignments(newSlotAssignments);
      claimedLockIds = newLockIds.filter((id) => !oldLockIds.includes(id));
    }
    try {
      await booking.update({
        checkIn,
        checkInTime,
        checkOut,
        checkOutTime,
        ...(stayChanged ? { hotelSlotAssignments: newSlotAssignments, hotelSlotOwnerId: ownerId } : {}),
        totalPrice: (booking.petRooms || []).length
          ? booking.petRooms.reduce((sum, petRoom) => sum + Number(petRoom.pricePerNight || 0) * nights, 0)
          : Number(booking.pricePerNight || 0) * nights,
        notes,
      });
    } catch (error) {
      if (claimedLockIds.length) await releaseBookingSlotsByIds(claimedLockIds);
      throw error;
    }
    if (stayChanged) {
      const newLockIds = hotelLockIdsForAssignments(newSlotAssignments);
      await releaseBookingSlotsByIds(oldLockIds.filter((id) => !newLockIds.includes(id)));
    }
    return res.json({ success: true, bookingId: booking.id });
  } catch (error) {
    if (error instanceof BookingConflictError) return res.status(error.status).json({ error: error.message });
    next(error);
  }
};

const cancelCustomerBooking = async (req, res, next) => {
  try {
    const bookingType = req.params.bookingType;
    if (!['grooming', 'hotel'].includes(bookingType)) {
      return res.status(400).json({ error: 'Choose grooming or hotel as the booking type.' });
    }
    const context = await customerBookingContext(req, res, bookingType);
    if (!context) return;
    const { customer, booking } = context;
    if (!ensureCustomerCanChangeBooking(booking, bookingType, res)) return;

    const lockIds = bookingType === 'hotel'
      ? hotelReservationLockIds(booking)
      : groomingLockIds(booking.date, booking.time);
    await booking.update({ status: 'cancelled' });
    await releaseBookingSlotsByIds(lockIds);
    const bookingPetIds = Array.isArray(booking.petIds) && booking.petIds.length
      ? booking.petIds
      : booking.petId ? [booking.petId] : [];
    const pets = (await Promise.all(bookingPetIds.map((id) => Pet.findByPk(id)))).filter(Boolean);
    const fallbackPetNames = booking.petNames
      || booking.petServices?.map((item) => item.petName)
      || booking.petRooms?.map((item) => item.petName)
      || [];
    const notificationSent = await notifyStaffOfCancellation({
      type: bookingType,
      booking,
      customer,
      pets: pets.length ? pets : fallbackPetNames.map((name) => ({ name })),
    });
    return res.json({ success: true, bookingId: booking.id, status: 'cancelled', notificationSent });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/bookings/grooming/availability?date=YYYY-MM-DD
// Returns which grooming time slots are still available on the given date.
const getGroomingAvailability = async (req, res, next) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'A date is required' });
    const dateCheck = validateFutureDate(date, 'Appointment date');
    if (!dateCheck.ok) return res.status(400).json({ error: dateCheck.error });

    const { validHoursFor, fmtHour } = require('../util/businessHours');
    const services = Array.isArray(req.query.service) ? req.query.service : [req.query.service].filter(Boolean);
    const durationMinutes = services.length ? groomingBookingDuration(services) : 60;
    if (!durationMinutes) return res.status(400).json({ error: 'A valid grooming service is required.' });
    const hours = validHoursFor(date);
    const existing = (await GroomingAppointment.findAll({ where: { date } })).filter((booking) => booking.status !== 'cancelled');
    const slots = await Promise.all(hours.map(async (hour) => {
      const time = fmtHour(hour);
      const start = timeToMinutes(time);
      const schedule = validateAppointmentDuration(date, time, durationMinutes);
      const future = validateFutureBookingTime(date, time, 'Appointment');
      const end = start + durationMinutes;
      const overlaps = existing.some((booking) => {
        const existingStart = timeToMinutes(booking.time);
        return existingStart !== null
          && existingStart < end
          && existingStart + groomingRecordDuration(booking) > start;
      });
      const lockAvailable = schedule.ok
        ? await areBookingSlotsAvailable(groomingLockIds(date, time, durationMinutes))
        : false;
      return {
        time,
        endTime: schedule.ok ? schedule.endTime : null,
        pickupEarliest: schedule.ok ? schedule.pickupEarliest : null,
        available: schedule.ok && future.ok && !overlaps && lockAvailable,
      };
    }));

    res.json({ date, durationMinutes, slots });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/bookings/hotel/availability?roomType=standard&checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD
// Returns whether a room type is available for the requested stay dates.
const getHotelAvailability = async (req, res, next) => {
  try {
    const { month: requestedMonth, nights: requestedNights, roomTypes: submittedRoomTypes } = req.query;
    const requestedPets = Number(req.query.pets || 1);
    if (!Number.isInteger(requestedPets) || requestedPets < 1 || requestedPets > 5) {
      return res.status(400).json({ error: 'Choose between 1 and 5 pets.' });
    }
    if (requestedMonth !== undefined) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)) {
        return res.status(400).json({ error: 'Choose a valid calendar month.' });
      }
      const nights = Number(requestedNights);
      if (!Number.isInteger(nights) || nights < 1 || nights > 365) {
        return res.status(400).json({ error: 'Stay duration must be from 1 to 365 nights.' });
      }
      const roomTypes = [...new Set(String(submittedRoomTypes || '').split(',').map(normalizeRoomType).filter(Boolean))];
      if (!roomTypes.length || roomTypes.length > 5 || roomTypes.some((roomType) => !Object.prototype.hasOwnProperty.call(ROOM_PRICES, roomType))) {
        return res.status(400).json({ error: 'Choose one or more valid hotel room types.' });
      }
      const [year, month] = requestedMonth.split('-').map(Number);
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const dates = Array.from({ length: daysInMonth }, (_, index) => {
        const date = new Date(Date.UTC(year, month - 1, index + 1));
        return date.toISOString().slice(0, 10);
      });
      const reservations = await HotelReservation.findAll();
      const occupancyDates = Array.from({ length: daysInMonth + nights - 1 }, (_, index) => {
        const date = new Date(Date.UTC(year, month - 1, index + 1));
        return date.toISOString().slice(0, 10);
      });
      const occupiedByDate = await hotelSlotsForDates(reservations, occupancyDates);
      const slots = dates.map((checkIn) => {
        const stayDates = hotelDateKeys(checkIn, (() => {
          const checkOutDate = new Date(`${checkIn}T00:00:00.000Z`);
          checkOutDate.setUTCDate(checkOutDate.getUTCDate() + nights);
          return checkOutDate.toISOString().slice(0, 10);
        })());
        const availableSlotNumbers = Array.from({ length: HOTEL_DAILY_CAPACITY }, (_, index) => index + 1)
          .filter((slot) => stayDates.every((date) => !occupiedByDate.get(date)?.has(slot)));
        const remainingSlots = availableSlotNumbers.length;
        return { date: checkIn, available: remainingSlots >= requestedPets, remainingSlots };
      });
      return res.json({ month: requestedMonth, nights, roomTypes, pets: requestedPets, capacity: HOTEL_DAILY_CAPACITY, slots });
    }

    const { roomType: submittedRoomType, checkIn, checkOut } = req.query;
    const roomType = normalizeRoomType(submittedRoomType);
    if (!roomType || !checkIn || !checkOut) {
      return res.status(400).json({ error: 'roomType, checkIn, and checkOut are required' });
    }
    if (!Object.prototype.hasOwnProperty.call(ROOM_PRICES, roomType)) {
      return res.status(400).json({ error: 'A valid roomType is required' });
    }
    const checkInDate = validateFutureDate(checkIn, 'Check-in');
    if (!checkInDate.ok) return res.status(400).json({ error: checkInDate.error });
    const checkOutDate = validateFutureDate(checkOut, 'Check-out');
    if (!checkOutDate.ok) return res.status(400).json({ error: checkOutDate.error });
    const nights = getStayNights(checkIn, checkOut);
    if (nights < 3) return res.status(400).json({ error: 'Hotel stays require at least 3 nights.' });

    if (!isValidDateKey(checkIn) || !isValidDateKey(checkOut) || checkOut <= checkIn) {
      return res.status(400).json({ error: 'Choose valid check-in and check-out dates.' });
    }
    const reservations = await HotelReservation.findAll();
    const availableSlotNumbers = await getAvailableHotelSlots(reservations, checkIn, checkOut);
    const remainingSlots = availableSlotNumbers.length;
    const available = remainingSlots >= requestedPets;

    res.json({ roomType, checkIn, checkOut, available, remainingSlots, availableSlotNumbers, capacity: HOTEL_DAILY_CAPACITY });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  bookGrooming,
  bookHotel,
  verifyPayment,
  cancelPayment,
  updateCustomerBooking,
  cancelCustomerBooking,
  getGroomingAvailability,
  getHotelAvailability,
};
