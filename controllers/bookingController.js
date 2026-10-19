const { Customer, Pet, GroomingAppointment, HotelReservation } = require('../models');
const { SERVICE_PRICES } = require('./groomingController');
const { ROOM_PRICES, ROOM_DETAILS } = require('./hotelController');
const { createQrPhCheckout, getCheckoutSession, expireCheckoutSession, getPayMongoKey, isCheckoutSessionPaid } = require('../util/paymongo');
const { parseToken: parseCustomerToken } = require('../util/customerAuth');
const { parseToken: parseAdminToken } = require('../util/adminAuth');
const {
  BookingConflictError,
  groomingLockIds,
  hotelReservationLockIds,
  releaseGroomingBookingSlots,
  areBookingSlotsAvailable,
  claimBookingSlots,
  releaseBookingSlots,
  releaseBookingSlotsByIds,
} = require('../util/bookingLocks');
const { hotelStayAvailability, claimHotelStayCapacity, HOTEL_PET_CAPACITY } = require('../util/hotelCapacity');
const { validateTime, validatePickupTime, validateAppointmentDuration } = require('../util/businessHours');
const { sendPayMongoReceipt, sendReservationTicket } = require('../util/mailer');
const { markBookingPaidAndConfirmed } = require('../util/paymentConfirmation');
const {
  quoteHotelStay,
  validateFutureDate,
  validateFutureBookingTime,
  timeToMinutes,
  groomingBookingDuration,
  groomingRecordDuration,
  getStayNights,
} = require('../util/bookingCalculations');

const MS_PER_DAY = 1000 * 60 * 60 * 24;

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
const findOrCreateCustomerWithPets = async (customerData, petsData) => {
  let customer = await Customer.findOne({
    where: { email: customerData.email },
  });
  if (!customer) {
    customer = await Customer.create(customerData);
  }

  const pets = await Promise.all(petsData.map((petData) => Pet.create({ ...petData, customerId: customer.id })));

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
      if (isExpired && await expireStaleCheckout(resv)) {
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
    const signedInCustomer = await getSignedInCustomer(req);
    if (!signedInCustomer || String(signedInCustomer.email).toLowerCase() !== String(customerData.email).trim().toLowerCase()) {
      return res.status(401).json({ error: 'Please sign in with the customer account used for this booking.' });
    }
    if (!String(customerData.address || '').trim()) return res.status(400).json({ error: 'Address is required' });

    // Release only stale PayMongo attempts; never delete a customer's active checkout.
    await cleanupAbandonedPayMongoBookings();
    if (petsData.length > 5) return res.status(400).json({ error: 'A booking may include up to 5 pets.' });
    if (petsData.some((pet) => !['dog', 'cat'].includes(String(pet.species).toLowerCase()) || !String(pet.name || '').trim())) {
      return res.status(400).json({ error: 'Our services are available for cats and dogs only, and each pet needs a name' });
    }
    if (petsData.some((pet) => !String(pet.breed || '').trim() || pet.age === undefined || pet.age === null || String(pet.age).trim() === '' || !Number.isFinite(Number(pet.age)) || Number(pet.age) < 0)) {
      return res.status(400).json({ error: 'Each pet needs a breed and valid age' });
    }
    if (petServiceKeys.some((petService) => !Object.prototype.hasOwnProperty.call(SERVICE_PRICES, petService))) {
      return res.status(400).json({ error: 'A valid service is required for every pet' });
    }
    if (!date || !time) {
      return res.status(400).json({ error: 'A valid date and time are required' });
    }
    const dateCheck = validateFutureDate(date, 'Appointment date');
    if (!dateCheck.ok) return res.status(400).json({ error: dateCheck.error });
    const durationMinutes = groomingBookingDuration(petServiceKeys);
    if (!durationMinutes) return res.status(400).json({ error: 'A valid service is required for every pet.' });
    if (paymentMethod === 'qrph' && !getPayMongoKey()) {
      return res.status(503).json({ error: 'Online GCash payment is not configured. Please choose counter cash or contact the administrator.' });
    }
    const timeCheck = validateFutureBookingTime(date, time, 'Appointment');
    if (!timeCheck.ok) return res.status(400).json({ error: timeCheck.error });
    const durationCheck = validateAppointmentDuration(date, time, durationMinutes);
    if (!durationCheck.ok) return res.status(400).json({ error: durationCheck.error });
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
      const { customer, pets } = await findOrCreateCustomerWithPets(customerData, petsData);
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
    const { customer: customerData, pet: petData, pets: submittedPets, roomType: submittedRoomType, checkIn, checkInTime, checkOut, checkOutTime, notes, paymentMethod } = req.body;
    const roomType = normalizeRoomType(submittedRoomType);
    const petsData = Array.isArray(submittedPets) && submittedPets.length ? submittedPets : [petData];
    const petRoomTypes = petsData.map((pet) => normalizeRoomType(pet?.roomType || submittedRoomType));

    if (!customerData || !petsData[0]) {
      return res.status(400).json({ error: 'Customer and pet information are required' });
    }
    const signedInCustomer = await getSignedInCustomer(req);
    if (!signedInCustomer || String(signedInCustomer.email).toLowerCase() !== String(customerData.email).trim().toLowerCase()) {
      return res.status(401).json({ error: 'Please sign in with the customer account used for this booking.' });
    }
    if (!String(customerData.address || '').trim()) return res.status(400).json({ error: 'Address is required' });

    // Release only stale PayMongo attempts; never delete a customer's active checkout.
    await cleanupAbandonedPayMongoBookings();
    if (petsData.length > 5) return res.status(400).json({ error: 'A booking may include up to 5 pets.' });
    if (petsData.some((pet) => !['dog', 'cat'].includes(String(pet.species).toLowerCase()) || !String(pet.name || '').trim())) {
      return res.status(400).json({ error: 'Our services are available for cats and dogs only, and each pet needs a name' });
    }
    if (petsData.some((pet) => !String(pet.breed || '').trim() || pet.age === undefined || pet.age === null || String(pet.age).trim() === '' || !Number.isFinite(Number(pet.age)) || Number(pet.age) < 0)) {
      return res.status(400).json({ error: 'Each pet needs a breed and valid age' });
    }
    if (petRoomTypes.some((petRoomType) => !Object.prototype.hasOwnProperty.call(ROOM_PRICES, petRoomType))) {
      return res.status(400).json({ error: 'A valid room type is required for every pet' });
    }

    const checkInDate = validateFutureDate(checkIn, 'Check-in');
    if (!checkInDate.ok) return res.status(400).json({ error: checkInDate.error });
    const checkOutDate = validateFutureDate(checkOut, 'Check-out');
    if (!checkOutDate.ok) return res.status(400).json({ error: checkOutDate.error });
    const quote = quoteHotelStay({ petRoomTypes, checkIn, checkOut });
    if (!quote.ok) return res.status(400).json({ error: quote.error });
    const nights = quote.nights;
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
    const { lockIds: capacityLockIds } = await claimHotelStayCapacity({
      petCount: petsData.length,
      checkIn,
      checkOut,
    });
    let reservationCreated = false;
    let reservationRecord = null;
    try {
      const { customer, pets } = await findOrCreateCustomerWithPets(customerData, petsData);
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
      res.status(201).json({ message: 'Hotel reservation booked', reservation, customer, pet: primaryPet, pets, checkout });
    } finally {
      if (!reservationCreated) await releaseBookingSlotsByIds(capacityLockIds);
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
    await markBookingPaidAndConfirmed(booking, sessionId);

    const [customer, pets] = await Promise.all([
      Customer.findByPk(booking.customerId),
      Promise.all((booking.petIds || (booking.petId ? [booking.petId] : [])).map((petId) => Pet.findByPk(petId))),
    ]);
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
        : null;
      if (lockIds) await releaseBookingSlotsByIds(lockIds);
      else await releaseGroomingBookingSlots(booking.date, booking.time, groomingRecordDuration(booking));
      await booking.destroy();
      deleted = true;
    }
    res.json({ success: true, bookingId, deleted, paid: booking.paymentStatus === 'paid' });
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

    const requestedPetCount = Number(req.query.petCount || 1);
    if (!Number.isInteger(requestedPetCount) || requestedPetCount < 1 || requestedPetCount > 5) {
      return res.status(400).json({ error: 'petCount must be between 1 and 5' });
    }
    const capacity = await hotelStayAvailability(checkIn, checkOut);
    res.json({
      roomType,
      checkIn,
      checkOut,
      capacity: HOTEL_PET_CAPACITY,
      availablePets: capacity.availablePets,
      available: capacity.availablePets >= requestedPetCount,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  bookGrooming,
  bookHotel,
  verifyPayment,
  cancelPayment,
  getGroomingAvailability,
  getHotelAvailability,
};
