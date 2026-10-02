const { Customer, Pet, GroomingAppointment, HotelReservation } = require('../models');
const { SERVICE_PRICES } = require('./groomingController');
const { ROOM_PRICES, ROOM_DETAILS } = require('./hotelController');
const { createQrPhCheckout, getCheckoutSession, getPayMongoKey } = require('../util/paymongo');
const { parseToken: parseCustomerToken } = require('../util/customerAuth');
const { parseToken: parseAdminToken } = require('../util/adminAuth');
const {
  BookingConflictError,
  groomingLockIds,
  hotelLockIdsForTypes,
  areBookingSlotsAvailable,
  claimBookingSlots,
  releaseBookingSlots,
  releaseBookingSlotsByIds,
} = require('../util/bookingLocks');
const { validateTime, validatePickupTime } = require('../util/businessHours');
const { sendPayMongoReceipt } = require('../util/mailer');

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
  const appUrl = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
  return createQrPhCheckout({
    amount,
    description,
    metadata: { bookingType, bookingId: String(bookingId) },
    successUrl: `${appUrl}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${appUrl}/payment-cancelled.html?booking_type=${encodeURIComponent(bookingType)}&booking_id=${encodeURIComponent(bookingId)}`,
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

const cleanupAbandonedPayMongoBookings = async (customerId = null) => {
  const EXPIRY_MS = 15 * 60 * 1000;
  const now = Date.now();

  try {
    const groomingPending = await GroomingAppointment.findAll({
      where: { paymentMethod: 'qrph', paymentStatus: 'pending' },
    });
    for (const appt of groomingPending) {
      const isOwner = customerId && String(appt.customerId) === String(customerId);
      const isExpired = appt.createdAt && (now - new Date(appt.createdAt).getTime() > EXPIRY_MS);
      if (isOwner || isExpired) {
        const lockIds = groomingLockIds(appt.date, appt.time);
        await releaseBookingSlotsByIds(lockIds);
        await appt.destroy();
      }
    }

    const hotelPending = await HotelReservation.findAll({
      where: { paymentMethod: 'qrph', paymentStatus: 'pending' },
    });
    for (const resv of hotelPending) {
      const isOwner = customerId && String(resv.customerId) === String(customerId);
      const isExpired = resv.createdAt && (now - new Date(resv.createdAt).getTime() > EXPIRY_MS);
      if (isOwner || isExpired) {
        const lockIds = hotelLockIdsForTypes(reservationRoomTypes(resv), resv.checkIn, resv.checkOut);
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

    // Release any previous uncompleted PayMongo attempts by this customer to prevent double-booking or slot-locking
    await cleanupAbandonedPayMongoBookings(signedInCustomer.id);
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
    if (paymentMethod === 'qrph' && !getPayMongoKey()) {
      return res.status(503).json({ error: 'Online GCash payment is not configured. Please choose counter cash or contact the administrator.' });
    }
    const timeCheck = validateTime(date, time);
    if (!timeCheck.ok) return res.status(400).json({ error: timeCheck.error });
    if (!pickupTime) return res.status(400).json({ error: 'A pickup time is required' });
    const pickupCheck = validatePickupTime(date, pickupTime);
    if (!pickupCheck.ok) return res.status(400).json({ error: pickupCheck.error });

    const existingAppointments = await GroomingAppointment.findAll({ where: { date, time } });
    if (existingAppointments.some((appointment) => appointment.status !== 'cancelled')) {
      throw new BookingConflictError('That schedule is already booked. The first customer to request it was prioritized. Please choose another time or date.');
    }

    const lockRefs = await claimBookingSlots(groomingLockIds(date, time), { type: 'grooming', date, time });
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

    // Release any previous uncompleted PayMongo attempts by this customer to prevent double-booking or slot-locking
    await cleanupAbandonedPayMongoBookings(signedInCustomer.id);
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

    const nights = Math.round((new Date(checkOut) - new Date(checkIn)) / MS_PER_DAY);
    if (nights < 1) {
      return res.status(400).json({ error: 'Check-out must be after check-in' });
    }
    if (!checkInTime || !checkOutTime) {
      return res.status(400).json({ error: 'Check-in and check-out times are required' });
    }
    const checkInCheck = validateTime(checkIn, checkInTime);
    if (!checkInCheck.ok) return res.status(400).json({ error: checkInCheck.error });
    const checkOutCheck = validateTime(checkOut, checkOutTime);
    if (!checkOutCheck.ok) return res.status(400).json({ error: checkOutCheck.error });
    if (paymentMethod === 'qrph' && !getPayMongoKey()) {
      return res.status(503).json({ error: 'Online GCash payment is not configured. Please choose counter cash or contact the administrator.' });
    }

    const requestedRoomTypes = [...new Set(petRoomTypes)];
    const lockRefs = await claimBookingSlots(hotelLockIdsForTypes(requestedRoomTypes, checkIn, checkOut), {
      type: 'hotel', roomTypes: requestedRoomTypes, checkIn, checkOut,
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
        pricePerNight: ROOM_PRICES[petRoomTypes[index]],
      }));
      const pricePerNight = requestedRoomTypes.length === 1 ? ROOM_PRICES[requestedRoomTypes[0]] : null;
      const totalPrice = petRooms.reduce((sum, petRoom) => sum + petRoom.pricePerNight * nights, 0);
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
        status: 'pending',
        pricePerNight,
        totalPrice,
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
      }
      reservationCreated = true;
      res.status(201).json({ message: 'Hotel reservation booked', reservation, customer, pet: primaryPet, pets, checkout });
    } finally {
      if (!reservationCreated) await releaseBookingSlots(lockRefs);
      if (!reservationCreated && reservationRecord) await reservationRecord.destroy();
    }
  } catch (error) {
    if (error instanceof BookingConflictError) return res.status(error.status).json({ error: error.message });
    next(error);
  }
};

const verifyPayment = async (req, res, next) => {
  try {
    const sessionId = String(req.body?.sessionId || '').trim();
    if (!sessionId) return res.status(400).json({ error: 'A PayMongo session ID is required' });

    const result = await getCheckoutSession(sessionId);
    const attributes = result.data?.attributes || {};
    if (attributes.payment_status !== 'paid') return res.status(400).json({ error: 'Payment has not been completed.' });

    const metadata = attributes.metadata || {};
    if (!['grooming', 'hotel'].includes(metadata.bookingType) || !metadata.bookingId) {
      return res.status(400).json({ error: 'The payment is not linked to a valid booking.' });
    }
    const Model = metadata.bookingType === 'hotel' ? HotelReservation : GroomingAppointment;
    const booking = await Model.findByPk(metadata.bookingId);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (!(await canAccessBooking(req, booking))) return res.status(403).json({ error: 'You are not allowed to update this booking.' });
    if (booking.paymentMethod !== 'qrph') return res.status(409).json({ error: 'This booking was not paid through PayMongo.' });
    const alreadyVerified = booking.paymentStatus === 'paid' && booking.paymentReference === sessionId;
    if (!alreadyVerified && (booking.paymentStatus !== 'pending' || booking.status === 'cancelled')) {
      return res.status(409).json({ error: 'This booking is no longer available for payment.' });
    }
    if (!alreadyVerified) await booking.update({ paymentStatus: 'paid', paymentReference: sessionId, paymentPaidAt: new Date() });

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
    if (booking.paymentStatus === 'pending') {
      const lockIds = bookingType === 'hotel'
        ? hotelLockIdsForTypes(reservationRoomTypes(booking), booking.checkIn, booking.checkOut)
        : groomingLockIds(booking.date, booking.time);
      await releaseBookingSlotsByIds(lockIds);
      await booking.destroy();
    }
    res.json({ success: true, bookingId, deleted: true });
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

    const { validHoursFor, fmtHour } = require('../util/businessHours');
    const hours = validHoursFor(date);

    const existing = await GroomingAppointment.findAll({ where: { date } });
    const bookedTimes = new Set(
      existing
        .filter((a) => a.status !== 'cancelled')
        .map((a) => a.time)
    );

    const slots = hours.map((h) => ({
      time: fmtHour(h),
      available: !bookedTimes.has(fmtHour(h)),
    }));

    res.json({ date, slots });
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

    const lockIds = hotelLockIdsForTypes([roomType], checkIn, checkOut);
    const available = await areBookingSlotsAvailable(lockIds);

    res.json({ roomType, checkIn, checkOut, available });
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
