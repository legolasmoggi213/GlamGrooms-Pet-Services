const { HotelReservation } = require('../models');
const {
  HOTEL_PET_CAPACITY,
  hotelCapacityDates,
  getHotelCapacityAvailability,
  claimHotelCapacity,
  claimReplacementHotelCapacity,
} = require('./bookingLocks');

const reservationPetCount = (reservation) => {
  if (Array.isArray(reservation.petRooms) && reservation.petRooms.length) return reservation.petRooms.length;
  if (Array.isArray(reservation.petIds) && reservation.petIds.length) return reservation.petIds.length;
  if (Array.isArray(reservation.petNames) && reservation.petNames.length) return reservation.petNames.length;
  return reservation.petId ? 1 : 0;
};

const isCapacityManaged = (reservation) => reservation.capacityManaged
  && Array.isArray(reservation.capacityLockIds)
  && reservation.capacityLockIds.length > 0;

const legacyPetCountsForStay = async (checkIn, checkOut, excludeReservationId = null) => {
  const dates = hotelCapacityDates(checkIn, checkOut);
  const reservations = await HotelReservation.findAll();
  return Object.fromEntries(dates.map((date) => [date, reservations
    .filter((reservation) => String(reservation.id) !== String(excludeReservationId)
      && reservation.status !== 'cancelled'
      && reservation.status !== 'checked-out'
      && !isCapacityManaged(reservation)
      && String(reservation.checkIn) <= date
      && String(reservation.checkOut) > date)
    .reduce((total, reservation) => total + reservationPetCount(reservation), 0)]));
};

const hotelStayAvailability = async (checkIn, checkOut, excludeReservationId = null) => {
  const legacyCounts = await legacyPetCountsForStay(checkIn, checkOut, excludeReservationId);
  return getHotelCapacityAvailability(checkIn, checkOut, legacyCounts);
};

const claimHotelStayCapacity = async ({ petCount, checkIn, checkOut, excludeReservationId = null, oldLockIds = [] }) => {
  const legacyCounts = await legacyPetCountsForStay(checkIn, checkOut, excludeReservationId);
  if (Array.isArray(oldLockIds) && oldLockIds.length) {
    return claimReplacementHotelCapacity(oldLockIds, petCount, checkIn, checkOut, legacyCounts);
  }
  const lockIds = await claimHotelCapacity(petCount, checkIn, checkOut, legacyCounts);
  return { lockIds, createdLockIds: lockIds };
};

module.exports = {
  HOTEL_PET_CAPACITY,
  reservationPetCount,
  hotelStayAvailability,
  claimHotelStayCapacity,
};