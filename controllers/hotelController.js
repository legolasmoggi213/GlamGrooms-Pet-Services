const { HotelReservation, Customer, Pet } = require('../models');
const { getRequestRole } = require('../util/adminAuth');
const { randomUUID } = require('crypto');
const { sendReservationTicket, sendBookingCancellation } = require('../util/mailer');
const { requestGcashBookingRefund } = require('../util/paymentRefund');
const {
  hotelDateKeys,
  hotelLockIdsForTypes,
  hotelLockIdsForSlots,
  hotelLockIdsForAssignments,
  claimHotelSlots,
  releaseBookingSlotsByIds,
} = require('../util/bookingLocks');
const { validateTime } = require('../util/businessHours');
const catalog = require('../util/serviceCatalog');
const { quoteHotelStay, validateFutureDate, validateFutureBookingTime, getStayNights } = require('../util/bookingCalculations');

// Exact hotel menus from the Glam Grooms flyers.
const { HOTEL, HOTEL_POLICIES } = catalog;

const ROOM_PRICES = {};

Object.entries(HOTEL).forEach(([stayType, rooms]) => {
  Object.entries(rooms).forEach(([roomType, rates]) => {
    ROOM_PRICES[`${stayType.toLowerCase().replace(/\s+/g, '-')}-${roomType.toLowerCase()}`] = rates.weekday;
  });
});

const ROOM_DETAILS = {
  'staycation-standard': { category: 'Staycation', size: 'Medium', occupancy: 2, amenities: ['WiFi', 'Air Conditioning', 'TV', 'Bathroom'], description: 'Temporary testing rate — ₱1 per night' },
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
  const petIds = reservation.petIds || (reservation.petId ? [reservation.petId] : []);
  const [customer, pets] = await Promise.all([
    Customer.findByPk(reservation.customerId),
    Promise.all([...new Set(petIds.map(String))].map((id) => Pet.findByPk(id))),
  ]);
  reservation.Customer = customer;
  reservation.Pets = pets.filter(Boolean);
  reservation.Pet = reservation.Pets[0] || null;
  return reservation;
};

const nightsBetween = (checkIn, checkOut) => {
  return getStayNights(checkIn, checkOut);
};

const getReservationQuote = async (req, res, next) => {
  try {
    const checkInDate = validateFutureDate(req.query.checkIn, 'Check-in');
    if (!checkInDate.ok) return res.status(400).json({ error: checkInDate.error });
    const checkOutDate = validateFutureDate(req.query.checkOut, 'Check-out');
    if (!checkOutDate.ok) return res.status(400).json({ error: checkOutDate.error });
    const roomTypes = Array.isArray(req.query.roomType) ? req.query.roomType : [req.query.roomType].filter(Boolean);
    const quote = quoteHotelStay({ petRoomTypes: roomTypes, checkIn: req.query.checkIn, checkOut: req.query.checkOut });
    if (!quote.ok) return res.status(400).json({ error: quote.error });
    res.json(quote);
  } catch (error) {
    next(error);
  }
};

const reservationRoomTypes = (reservation) => [...new Set(
  (Array.isArray(reservation.roomTypes) && reservation.roomTypes.length
    ? reservation.roomTypes
    : Array.isArray(reservation.petRooms) && reservation.petRooms.length
      ? reservation.petRooms.map((petRoom) => petRoom.roomType)
      : [reservation.roomType])
    .filter(Boolean)
)];

const reservationPetCount = (reservation) => Math.max(
  1,
  (Array.isArray(reservation.petRooms) && reservation.petRooms.length)
    || (Array.isArray(reservation.petIds) && reservation.petIds.length)
    || (reservation.petId ? 1 : 0),
);

const reservationLockIds = (reservation) => {
  if (reservation.hotelSlotAssignments) return hotelLockIdsForAssignments(reservation.hotelSlotAssignments);
  if (Array.isArray(reservation.hotelSlotNumbers)) {
    return hotelLockIdsForSlots(reservation.hotelSlotNumbers, reservation.checkIn, reservation.checkOut);
  }
  if (reservation.capacityManaged && Array.isArray(reservation.capacityLockIds)) return reservation.capacityLockIds;
  return hotelLockIdsForTypes(reservationRoomTypes(reservation), reservation.checkIn, reservation.checkOut);
};

const legacyOccupancyByDate = async (checkIn, checkOut, excludeReservationId = null) => {
  const reservations = await HotelReservation.findAll();
  const occupancy = new Map(hotelDateKeys(checkIn, checkOut).map((date) => [date, new Set()]));
  for (const reservation of reservations) {
    if (['cancelled', 'checked-out'].includes(reservation.status)
      || (excludeReservationId && String(reservation.id) === String(excludeReservationId))
      || reservation.checkIn >= checkOut
      || (reservation.status !== 'checked-in' && reservation.checkOut <= checkIn)) continue;
    const keepOccupiedUntilCheckedOut = reservation.status === 'checked-in';
    const overlapStart = reservation.checkIn > checkIn ? reservation.checkIn : checkIn;
    const overlapEnd = keepOccupiedUntilCheckedOut || reservation.checkOut >= checkOut ? checkOut : reservation.checkOut;
    for (const date of hotelDateKeys(overlapStart, overlapEnd)) {
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
      for (let slot = 1; slot <= 35 && assigned < reservationPetCount(reservation); slot += 1) {
        if (!usedSlots.has(slot)) {
          usedSlots.add(slot);
          assigned += 1;
        }
      }
    }
  }
  return occupancy;
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
    if (!checkInTime || !checkOutTime) {
      return res.status(400).json({ error: 'Check-in and check-out times are required' });
    }
    if (checkInTime) {
      const check = validateTime(checkIn, checkInTime);
      if (!check.ok) return res.status(400).json({ error: check.error });
      const futureCheck = validateFutureBookingTime(checkIn, checkInTime, 'Check-in');
      if (!futureCheck.ok) return res.status(400).json({ error: futureCheck.error });
    }
    if (checkOutTime) {
      const check = validateTime(checkOut, checkOutTime);
      if (!check.ok) return res.status(400).json({ error: check.error });
    }

    const checkInDate = validateFutureDate(checkIn, 'Check-in');
    if (!checkInDate.ok) return res.status(400).json({ error: checkInDate.error });
    const checkOutDate = validateFutureDate(checkOut, 'Check-out');
    if (!checkOutDate.ok) return res.status(400).json({ error: checkOutDate.error });
    const quote = quoteHotelStay({ petRoomTypes: [roomType], checkIn, checkOut });
    if (!quote.ok) return res.status(400).json({ error: quote.error });
    const nights = quote.nights;

    const pricePerNight = ROOM_PRICES[roomType];
    const hotelSlotOwnerId = randomUUID();
    const hotelSlotAssignments = status === 'cancelled' || status === 'checked-out'
      ? {}
      : await claimHotelSlots({
        checkIn,
        checkOut,
        slotCount: 1,
        legacyOccupancyByDate: await legacyOccupancyByDate(checkIn, checkOut),
        ownerId: hotelSlotOwnerId,
        details: { roomType, checkIn, checkOut },
      });
    const claimedLockIds = hotelLockIdsForAssignments(hotelSlotAssignments);
    let created = false;
    let reservation;
    try {
      reservation = await HotelReservation.create({
        roomType,
        checkIn,
        checkInTime,
        checkOut,
        checkOutTime,
        notes: notes || '',
        customerId,
        petId,
        capacityManaged: true,
        capacityLockIds: claimedLockIds,
        status: status || 'pending',
        hotelSlotAssignments,
        hotelSlotOwnerId,
        pricePerNight,
        totalPrice: quote.total,
        pricingBreakdown: quote,
      });
      created = true;
    } finally {
      if (!created) await releaseBookingSlotsByIds(claimedLockIds);
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
    const wasAlreadyCancelled = reservation.status === 'cancelled';
    const body = req.body || {};
    if (Object.prototype.hasOwnProperty.call(body, 'paymentStatus')) {
      if (Object.keys(body).length !== 1) {
        return res.status(400).json({ error: 'Payment status must be updated separately.' });
      }
      const paymentStatus = String(body.paymentStatus).toLowerCase();
      if (!['paid', 'unpaid'].includes(paymentStatus)) {
        return res.status(400).json({ error: 'Payment status must be paid or unpaid.' });
      }
      if (reservation.status !== 'checked-in' || !reservation.confirmedAt) {
        return res.status(409).json({ error: 'Payment can only be updated for confirmed, checked-in reservations.' });
      }
      if (reservation.paymentMethod === 'qrph') {
        return res.status(409).json({ error: 'GCash payment status is updated automatically after payment verification.' });
      }
      await reservation.update({
        paymentStatus,
        paymentPaidAt: paymentStatus === 'paid' ? new Date() : null,
      });
      return res.json({ success: true, paymentStatus });
    }
    const { roomType, checkIn, checkInTime, checkOut, checkOutTime, status, notes, customerId, petId } = body;
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

    const currentRoomTypes = reservationRoomTypes(reservation);
    const nextRoomTypes = roomType ? [roomType] : currentRoomTypes;
    const nextRoomType = nextRoomTypes.length === 1 ? nextRoomTypes[0] : 'multiple-rooms';
    const nextCheckIn = checkIn || reservation.checkIn;
    const nextCheckOut = checkOut || reservation.checkOut;
    const stayChanged = nextRoomTypes.length !== currentRoomTypes.length
      || nextRoomTypes.some((type) => !currentRoomTypes.includes(type))
      || nextCheckIn !== reservation.checkIn
      || nextCheckOut !== reservation.checkOut;

    if (roomType && !Object.prototype.hasOwnProperty.call(ROOM_PRICES, roomType)) {
      return res.status(400).json({ error: 'A valid roomType is required' });
    }

    const sourcePetRooms = Array.isArray(reservation.petRooms) && reservation.petRooms.length
      ? reservation.petRooms
      : (reservation.petIds || [reservation.petId]).filter(Boolean).map((id, index) => ({
        petId: id,
        petName: (reservation.petNames || [])[index],
        roomType: currentRoomTypes[0],
      }));
    const nextPetRoomTypes = sourcePetRooms.map((petRoom) => roomType || petRoom.roomType || currentRoomTypes[0]);
    const quote = quoteHotelStay({
      petRoomTypes: nextPetRoomTypes,
      checkIn: nextCheckIn,
      checkOut: nextCheckOut,
      minimumNights: stayChanged ? undefined : 1,
    });
    if (!quote.ok) return res.status(400).json({ error: quote.error });
    const nights = quote.nights;
    const nextStatus = status || reservation.status;
    const inactiveStatus = ['cancelled', 'checked-out'].includes(nextStatus);
    const wasInactive = ['cancelled', 'checked-out'].includes(reservation.status);
    if (stayChanged && !inactiveStatus) {
      const futureCheck = validateFutureBookingTime(nextCheckIn, checkInTime || reservation.checkInTime, 'Check-in');
      if (!futureCheck.ok) return res.status(400).json({ error: futureCheck.error });
    }
    const nextPetRooms = sourcePetRooms.map((petRoom, index) => {
      const petRoomType = nextPetRoomTypes[index];
      return { ...petRoom, roomType: petRoomType, pricePerNight: quote.petQuotes[index]?.effectiveNightlyRate || 0 };
    });
    const pricePerNight = quote.total / nights;
    const needsAdminConfirmation = status === 'confirmed' && !reservation.confirmedAt;
    const oldLockIds = reservationLockIds(reservation);
    const oldSlotAssignments = reservation.hotelSlotAssignments || {};
    const ownerId = reservation.hotelSlotOwnerId || String(reservation.id);
    const isNextStatusOccupying = !inactiveStatus;
    const wasOccupying = !wasInactive;
    const shouldClaimHotelSlots = isNextStatusOccupying && (stayChanged || wasInactive
      || !Object.keys(oldSlotAssignments).length);
    let claimedNewLockIds = [];
    let nextSlotAssignments = oldSlotAssignments;
    if (shouldClaimHotelSlots) {
      nextSlotAssignments = await claimHotelSlots({
        checkIn: nextCheckIn,
        checkOut: nextCheckOut,
        slotCount: reservationPetCount({ ...reservation, petRooms: nextPetRooms }),
        selectedSlotNumbers: Object.values(oldSlotAssignments)[0],
        legacyOccupancyByDate: await legacyOccupancyByDate(nextCheckIn, nextCheckOut, reservation.id),
        ownerId,
        details: { roomType: nextRoomType, checkIn: nextCheckIn, checkOut: nextCheckOut, bookingId: String(reservation.id) },
      });
      claimedNewLockIds = hotelLockIdsForAssignments(nextSlotAssignments)
        .filter((id) => !oldLockIds.includes(id));
    }
    try {
      const updates = {
      roomType: nextRoomType,
      roomTypes: nextRoomTypes,
      petRooms: nextPetRooms,
      checkIn: nextCheckIn,
      checkInTime: checkInTime || reservation.checkInTime || null,
      checkOut: nextCheckOut,
      checkOutTime: checkOutTime || reservation.checkOutTime || null,
      status: nextStatus,
      notes: notes === undefined ? reservation.notes : notes,
      customerId: customerId === undefined ? reservation.customerId : customerId,
      petId: petId === undefined ? reservation.petId : petId,
      pricePerNight,
      totalPrice: quote.total,
      pricingBreakdown: quote,
      roomDetails: nextRoomTypes.length === 1 ? ROOM_DETAILS[nextRoomTypes[0]] : null,
      roomDetailsByType: Object.fromEntries(nextRoomTypes.map((type) => [type, ROOM_DETAILS[type]])),
      capacityManaged: true,
      capacityLockIds: isNextStatusOccupying ? hotelLockIdsForAssignments(nextSlotAssignments) : [],
      };
      updates.hotelSlotAssignments = isNextStatusOccupying ? nextSlotAssignments : {};
      updates.hotelSlotOwnerId = ownerId;
      if (needsAdminConfirmation) updates.confirmedAt = new Date();
      await reservation.update(updates);
    } catch (error) {
      if (claimedNewLockIds.length) await releaseBookingSlotsByIds(claimedNewLockIds);
      throw error;
    }
    if (!isNextStatusOccupying && wasOccupying) {
      await releaseBookingSlotsByIds(oldLockIds);
    } else if (shouldClaimHotelSlots) {
      const newLockIds = hotelLockIdsForAssignments(nextSlotAssignments);
      await releaseBookingSlotsByIds(oldLockIds.filter((id) => !newLockIds.includes(id)));
    }
    if (status === 'cancelled' && !wasAlreadyCancelled) {
      try {
        const customer = await Customer.findByPk(reservation.customerId);
        const customerDetails = customer || reservation.customerDetails;
        if (customerDetails?.email) {
          const sent = await sendBookingCancellation({
            to: customerDetails.email,
            customerName: customerDetails.name,
            type: 'hotel',
            bookingId: reservation.id,
            date: reservation.checkIn,
            time: reservation.checkInTime,
            service: reservation.roomType,
          });
          if (!sent) console.warn(`Cancellation notice was not sent for hotel reservation ${reservation.id}.`);
        } else {
          console.warn(`No customer email is available for hotel reservation ${reservation.id} cancellation notice.`);
        }
      } catch (notificationError) {
        console.error(`Unable to send cancellation notice for hotel reservation ${reservation.id}:`, notificationError);
      }
    }
    const refund = status === 'cancelled' && !wasAlreadyCancelled
      ? await requestGcashBookingRefund(reservation)
      : null;
    res.json({ success: true, refund });
  } catch (error) {
    next(error);
  }
};

const sendReservationTicketEmail = async (req, res, next) => {
  try {
    const reservation = await HotelReservation.findByPk(req.params.id);
    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });
    if (reservation.status !== 'confirmed' && !reservation.confirmedAt) {
      return res.status(409).json({ error: 'Confirm the reservation before sending its ticket.' });
    }

    const [customer, pets] = await Promise.all([
      Customer.findByPk(reservation.customerId),
      Promise.all((reservation.petIds || (reservation.petId ? [reservation.petId] : [])).map((id) => Pet.findByPk(id))),
    ]);
    if (!customer) return res.status(404).json({ error: 'The customer record for this reservation was not found.' });

    try {
      const emailSent = await sendReservationTicket({
        bookingRecord: reservation,
        type: 'hotel',
        to: customer.email,
        customer: reservation.customerDetails || customer,
        pets: pets.filter(Boolean),
      });
      if (!emailSent) return res.status(503).json({ error: 'The ticket email was not sent. Check the email configuration or whether a ticket was already sent.' });
    } catch (mailError) {
      console.error('Hotel reservation ticket email failed:', mailError);
      return res.status(502).json({ error: 'The reservation was confirmed, but the ticket email failed. Check the server email provider logs.' });
    }
    return res.json({ success: true, emailSent: true });
  } catch (error) {
    next(error);
  }
};

const resendReservationTicket = async (req, res, next) => {
  try {
    const reservation = await HotelReservation.findByPk(req.params.id);
    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });
    if (!['confirmed', 'checked-in', 'checked-out'].includes(reservation.status)) {
      return res.status(409).json({ error: 'Only confirmed reservations can receive a ticket.' });
    }

    const customer = await Customer.findByPk(reservation.customerId);
    if (!customer || !customer.email) {
      return res.status(400).json({ error: 'The customer record has no email address.' });
    }
    const petIds = reservation.petIds || (reservation.petId ? [reservation.petId] : []);
    const pets = await Promise.all(petIds.map((id) => Pet.findByPk(id)));
    const emailSent = await sendReservationTicket({
      bookingRecord: reservation,
      type: 'hotel',
      to: customer.email,
      customer: reservation.customerDetails || customer,
      pets: pets.filter(Boolean),
      force: true,
    });
    if (!emailSent) {
      return res.status(502).json({ error: getEmailDeliveryConfig().configured
        ? 'The email provider did not send the ticket. Check Render logs and verify your sender settings.'
        : 'Email delivery is not configured.' });
    }
    return res.json({ emailSent: true });
  } catch (error) {
    console.error('Hotel reservation ticket resend failed:', error);
    return next(error);
  }
};

const deleteReservation = async (req, res, next) => {
  try {
    const reservation = await HotelReservation.findByPk(req.params.id);
    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    if (getRequestRole(req) !== 'ADMIN' && reservation.status !== 'cancelled') {
      return res.status(403).json({ error: 'Staff can only delete cancelled pet hotel reservations.' });
    }
    await reservation.destroy();
    await releaseBookingSlotsByIds(reservationLockIds(reservation));
    res.json({ message: 'Reservation deleted' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  ROOM_PRICES,
  ROOM_DETAILS,
  HOTEL_POLICIES,
  getReservationQuote,
  listReservations,
  getReservation,
  createReservation,
  updateReservation,
  sendReservationTicketEmail,
  resendReservationTicket,
  deleteReservation,
};
