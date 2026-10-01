const { HotelReservation, Customer, Pet } = require('../models');
const { sendBookingConfirmation } = require('../util/mailer');
const { hotelLockIds, claimBookingSlots, claimReplacementBookingSlots, releaseBookingSlots, releaseBookingSlotsByIds } = require('../util/bookingLocks');
const { validateTime } = require('../util/businessHours');
const catalog = require('../util/serviceCatalog');

// Exact hotel menus from the Glam Grooms flyers.
const { HOTEL, HOTEL_POLICIES } = catalog;

const ROOM_PRICES = {};

Object.entries(HOTEL).forEach(([stayType, rooms]) => {
  Object.entries(rooms).forEach(([roomType, rates]) => {
    ROOM_PRICES[`${stayType.toLowerCase()}-${roomType.toLowerCase()}`] = rates.weekday;
  });
});

const ROOM_DETAILS = {
  'day-care-standard': { category: 'Day Care', size: 'Small', occupancy: 1, amenities: ['Play area', 'Air Conditioning', 'Treats'], description: 'Standard hourly day care — weekday ₱55 / weekend ₱76 per hour' },
  'day-care-deluxe': { category: 'Day Care', size: 'Medium', occupancy: 1, amenities: ['Play area', 'Air Conditioning', 'Treats', 'Enrichment toys'], description: 'Deluxe hourly day care — weekday ₱80 / weekend ₱100 per hour' },
  'staycation-standard': { category: 'Staycation', size: 'Medium', occupancy: 2, amenities: ['WiFi', 'Air Conditioning', 'TV', 'Bathroom'], description: 'Standard overnight stay — weekday ₱500 / weekend ₱700 per night' },
  'staycation-deluxe': { category: 'Staycation', size: 'Large', occupancy: 2, amenities: ['WiFi', 'Air Conditioning', 'TV', 'Bathroom', 'Mini Fridge', 'Balcony'], description: 'Deluxe overnight stay — weekday ₱800 / weekend ₱1000 per night' },
};

const VALID_STATUSES = ['pending', 'reserved', 'confirmed', 'checked-in', 'checked-out', 'cancelled'];

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const includeAll = [
  { model: Customer, attributes: ['id', 'name', 'email', 'phone'] },
  { model: Pet, attributes: ['id', 'name', 'species', 'breed'] },
];

const addRelatedRecords = async (reservation) => {
  if (!reservation) return reservation;
  const [customer, pet] = await Promise.all([
    Customer.findByPk(reservation.customerId),
    Pet.findByPk(reservation.petId),
  ]);
  reservation.Customer = customer;
  reservation.Pet = pet;
  return reservation;
};

const nightsBetween = (checkIn, checkOut) => {
  const nights = Math.round((new Date(checkOut) - new Date(checkIn)) / MS_PER_DAY);
  return Number.isFinite(nights) ? nights : 0;
};

const listReservations = async (req, res, next) => {
  try {
    const reservations = await HotelReservation.findAll({
      include: includeAll,
      order: [['checkIn', 'DESC']],
    });
    const valid = reservations.filter((r) => !(r.paymentMethod === 'qrph' && r.paymentStatus === 'pending'));
    res.json(await Promise.all(valid.map(addRelatedRecords)));
  } catch (error) {
    next(error);
  }
};

const getReservation = async (req, res, next) => {
  try {
    const reservation = await HotelReservation.findByPk(req.params.id, { include: includeAll });
    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    res.json(await addRelatedRecords(reservation));
  } catch (error) {
    next(error);
  }
};

const createReservation = async (req, res, next) => {
  try {
    const { roomType, checkIn, checkInTime, checkOut, checkOutTime, notes, customerId, petId, status } = req.body;

    const [customer, pet] = await Promise.all([
      Customer.findByPk(customerId),
      Pet.findByPk(petId),
    ]);
    if (!customer) {
      return res.status(400).json({ error: 'A valid customerId is required' });
    }
    if (!pet) {
      return res.status(400).json({ error: 'A valid petId is required' });
    }
    if (!Object.prototype.hasOwnProperty.call(ROOM_PRICES, roomType)) {
      return res.status(400).json({ error: 'A valid roomType is required' });
    }
    if (req.body.status && !VALID_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ error: 'A valid status is required' });
    }
    if (checkInTime) {
      const check = validateTime(checkIn, checkInTime);
      if (!check.ok) return res.status(400).json({ error: check.error });
    }
    if (checkOutTime) {
      const check = validateTime(checkOut, checkOutTime);
      if (!check.ok) return res.status(400).json({ error: check.error });
    }

    const nights = nightsBetween(checkIn, checkOut);
    if (nights < 1) {
      return res.status(400).json({ error: 'Check-out must be after check-in' });
    }

    const existingReservations = await HotelReservation.findAll({ where: { roomType } });
    const overlapsExisting = existingReservations.some((item) => item.status !== 'cancelled'
      && new Date(item.checkIn) < new Date(checkOut)
      && new Date(item.checkOut) > new Date(checkIn));
    if (overlapsExisting) return res.status(409).json({ error: 'That room is already reserved for those dates.' });

    const pricePerNight = ROOM_PRICES[roomType];
    const lockRefs = status === 'cancelled' ? [] : await claimBookingSlots(hotelLockIds(roomType, checkIn, checkOut), { type: 'hotel', roomType, checkIn, checkOut });
    let created = false;
    let reservation;
    try {
      reservation = await HotelReservation.create({
        roomType,
        checkIn,
        checkInTime,
        checkOut,
        checkOutTime,
        notes,
        customerId,
        petId,
        status: status || 'pending',
        pricePerNight,
        totalPrice: pricePerNight * nights,
      });
      created = true;
    } finally {
      if (!created) await releaseBookingSlots(lockRefs);
    }
    const full = await HotelReservation.findByPk(reservation.id, { include: includeAll });
    res.status(201).json(await addRelatedRecords(full));
  } catch (error) {
    next(error);
  }
};

const updateReservation = async (req, res, next) => {
  try {
    const reservation = await HotelReservation.findByPk(req.params.id);
    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    const { roomType, checkIn, checkInTime, checkOut, checkOutTime, status, notes, customerId, petId } = req.body;
    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'A valid status is required' });
    }
    if (checkInTime) {
      const check = validateTime(checkIn, checkInTime);
      if (!check.ok) return res.status(400).json({ error: check.error });
    }
    if (checkOutTime) {
      const check = validateTime(checkOut, checkOutTime);
      if (!check.ok) return res.status(400).json({ error: check.error });
    }

    if (customerId !== undefined && !(await Customer.findByPk(customerId))) {
      return res.status(400).json({ error: 'A valid customerId is required' });
    }
    if (petId !== undefined && !(await Pet.findByPk(petId))) {
      return res.status(400).json({ error: 'A valid petId is required' });
    }

    const nextRoomType = roomType || reservation.roomType;
    const nextCheckIn = checkIn || reservation.checkIn;
    const nextCheckOut = checkOut || reservation.checkOut;
    const stayChanged = nextRoomType !== reservation.roomType
      || nextCheckIn !== reservation.checkIn
      || nextCheckOut !== reservation.checkOut;

    if (roomType && !Object.prototype.hasOwnProperty.call(ROOM_PRICES, roomType)) {
      return res.status(400).json({ error: 'A valid roomType is required' });
    }

    const nights = nightsBetween(nextCheckIn, nextCheckOut);
    if (nights < 1) {
      return res.status(400).json({ error: 'Check-out must be after check-in' });
    }
    if (stayChanged && status !== 'cancelled') {
      const conflicts = await HotelReservation.findAll({ where: { roomType: nextRoomType } });
      const overlaps = conflicts.some((item) => String(item.id) !== String(reservation.id)
        && item.status !== 'cancelled'
        && new Date(item.checkIn) < new Date(nextCheckOut)
        && new Date(item.checkOut) > new Date(nextCheckIn));
      if (overlaps) return res.status(409).json({ error: 'That room is already reserved for those dates.' });
    }

    const pricePerNight = ROOM_PRICES[nextRoomType];
    const wasConfirmed = reservation.status === 'confirmed';
    const oldRoomType = reservation.roomType;
    const oldCheckIn = reservation.checkIn;
    const oldCheckOut = reservation.checkOut;
    const oldLockIds = hotelLockIds(oldRoomType, oldCheckIn, oldCheckOut);
    const newLockIds = hotelLockIds(nextRoomType, nextCheckIn, nextCheckOut);
    let claimedNewLockIds = [];
    if (stayChanged && status !== 'cancelled') {
      claimedNewLockIds = await claimReplacementBookingSlots(oldLockIds, newLockIds, { type: 'hotel', roomType: nextRoomType, checkIn: nextCheckIn, checkOut: nextCheckOut });
    }
    try {
      const updates = {
      roomType: nextRoomType,
      checkIn: nextCheckIn,
      checkInTime: checkInTime || reservation.checkInTime || null,
      checkOut: nextCheckOut,
      checkOutTime: checkOutTime || reservation.checkOutTime || null,
      status: status || reservation.status,
      notes: notes === undefined ? reservation.notes : notes,
      customerId: customerId === undefined ? reservation.customerId : customerId,
      petId: petId === undefined ? reservation.petId : petId,
      pricePerNight,
      totalPrice: pricePerNight * nights * (reservation.petIds && reservation.petIds.length ? reservation.petIds.length : 1),
      };
      if (status === 'confirmed' && !wasConfirmed) updates.confirmedAt = new Date();
      await reservation.update(updates);
    } catch (error) {
      if (claimedNewLockIds.length) await releaseBookingSlotsByIds(claimedNewLockIds);
      throw error;
    }
    if (status === 'cancelled') {
      await releaseBookingSlotsByIds(oldLockIds);
    } else if (stayChanged) {
      await releaseBookingSlotsByIds(oldLockIds.filter((id) => !newLockIds.includes(id)));
    }
    const full = await HotelReservation.findByPk(reservation.id, { include: includeAll });
    let emailSent = false;
    if (status === 'confirmed' && !wasConfirmed) {
      const [customer, pet] = await Promise.all([
        Customer.findByPk(full.customerId),
        Pet.findByPk(full.petId),
      ]);
      try {
        emailSent = await sendBookingConfirmation({
          to: customer && customer.email,
          customerName: customer && customer.name,
          type: 'hotel',
          service: full.roomType,
          date: full.checkIn,
          time: `${full.checkOut} ${full.checkOutTime || ''}`.trim(),
          petName: pet && pet.name,
        });
      } catch (mailError) {
        console.error('Booking confirmation email failed:', mailError);
      }
    }
    res.json({ ...(await addRelatedRecords(full)), emailSent });
  } catch (error) {
    next(error);
  }
};

const deleteReservation = async (req, res, next) => {
  try {
    const reservation = await HotelReservation.findByPk(req.params.id);
    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    await reservation.destroy();
    await releaseBookingSlotsByIds(hotelLockIds(reservation.roomType, reservation.checkIn, reservation.checkOut));
    res.json({ message: 'Reservation deleted' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  ROOM_PRICES,
  ROOM_DETAILS,
  HOTEL_POLICIES,
  listReservations,
  getReservation,
  createReservation,
  updateReservation,
  deleteReservation,
};
