const { firestore } = require('../config/firebase');

class BookingConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BookingConflictError';
    this.status = 409;
  }
}

const lockCollection = firestore.collection('bookingSlots');
const HOTEL_PET_CAPACITY = 35;

const groomingLockIds = (date, time, durationMinutes = 60) => {
  const [hour, minute] = String(time || '').split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return [];
  const startMinute = hour * 60 + minute;
  const endMinute = startMinute + Math.max(1, Number(durationMinutes) || 60);
  const firstHour = Math.floor(startMinute / 60);
  const lastHour = Math.ceil(endMinute / 60);
  return Array.from({ length: Math.max(1, lastHour - firstHour) }, (_, index) =>
    `grooming_${date}_${String(firstHour + index).padStart(2, '0')}:00`);
};

const releaseGroomingLockIds = async (lockIds, date, time) => {
  if (!lockIds.length) return;
  const refs = lockIds.map((id) => lockCollection.doc(id));
  const snapshots = await firestore.getAll(...refs);
  const ownedRefs = refs.filter((ref, index) => {
    if (!snapshots[index].exists) return false;
    const details = snapshots[index].data() || {};
    return details.type === 'grooming' && details.date === date && details.time === time;
  });
  if (ownedRefs.length) await releaseBookingSlots(ownedRefs);
};

const releaseGroomingBookingSlots = (date, time, durationMinutes = 60) =>
  releaseGroomingLockIds(groomingLockIds(date, time, durationMinutes), date, time);

const hotelLockIds = (roomType, checkIn, checkOut) => {
  const locks = [];
  for (let day = new Date(`${checkIn}T00:00:00.000Z`); day < new Date(`${checkOut}T00:00:00.000Z`); day.setUTCDate(day.getUTCDate() + 1)) {
    locks.push(`hotel_${roomType}_${day.toISOString().slice(0, 10)}`);
  }
  return locks;
};

const hotelLockIdsForTypes = (roomTypes, checkIn, checkOut) => [...new Set(roomTypes.filter(Boolean))]
  .flatMap((roomType) => hotelLockIds(roomType, checkIn, checkOut));

const hotelCapacityDates = (checkIn, checkOut) => {
  const dates = [];
  for (let day = new Date(`${checkIn}T00:00:00.000Z`); day < new Date(`${checkOut}T00:00:00.000Z`); day.setUTCDate(day.getUTCDate() + 1)) {
    dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
};

const hotelCapacitySlotIds = (date) => Array.from({ length: HOTEL_PET_CAPACITY }, (_, index) =>
  `hotel_capacity_${date}_${String(index + 1).padStart(2, '0')}`);

const getHotelCapacityAvailability = async (checkIn, checkOut, legacyPetCounts = {}) => {
  const dates = hotelCapacityDates(checkIn, checkOut);
  const lockIds = dates.flatMap(hotelCapacitySlotIds);
  const refs = lockIds.map((id) => lockCollection.doc(id));
  const snapshots = refs.length ? await firestore.getAll(...refs) : [];
  const snapshotById = new Map(refs.map((ref, index) => [ref.id, snapshots[index]]));
  const daily = dates.map((date) => {
    const occupiedByLocks = hotelCapacitySlotIds(date).filter((id) => snapshotById.get(id)?.exists).length;
    const legacyOccupied = Math.max(0, Number(legacyPetCounts[date]) || 0);
    return {
      date,
      availablePets: Math.max(0, HOTEL_PET_CAPACITY - occupiedByLocks - legacyOccupied),
    };
  });
  return {
    capacity: HOTEL_PET_CAPACITY,
    availablePets: daily.length ? Math.min(...daily.map((item) => item.availablePets)) : HOTEL_PET_CAPACITY,
    daily,
  };
};

const claimHotelCapacity = async (petCount, checkIn, checkOut, legacyPetCounts = {}) => {
  const dates = hotelCapacityDates(checkIn, checkOut);
  const count = Number(petCount);
  if (!Number.isInteger(count) || count < 1 || count > HOTEL_PET_CAPACITY || !dates.length) {
    throw new BookingConflictError('A valid pet count and stay date range are required.');
  }
  const idsByDate = dates.map((date) => hotelCapacitySlotIds(date));
  const allIds = idsByDate.flat();
  const refs = allIds.map((id) => lockCollection.doc(id));
  const claimedIds = await firestore.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
    const snapshotById = new Map(refs.map((ref, index) => [ref.id, snapshots[index]]));
    const selectedByDate = [];

    for (let index = 0; index < dates.length; index += 1) {
      const date = dates[index];
      const occupiedByLocks = idsByDate[index].filter((id) => snapshotById.get(id)?.exists).length;
      const legacyOccupied = Math.max(0, Number(legacyPetCounts[date]) || 0);
      const availableIds = idsByDate[index].filter((id) => !snapshotById.get(id)?.exists);
      if (occupiedByLocks + legacyOccupied + count > HOTEL_PET_CAPACITY || availableIds.length < count) {
        throw new BookingConflictError('There are not enough hotel spaces for those dates. Please choose another stay.');
      }
      selectedByDate.push(availableIds.slice(0, count));
    }

    selectedByDate.forEach((ids, index) => {
      ids.forEach((id) => transaction.create(lockCollection.doc(id), {
        type: 'hotel-capacity',
        date: dates[index],
        createdAt: new Date(),
      }));
    });
    return selectedByDate.flat();
  });
  return claimedIds;
};

const claimReplacementHotelCapacity = async (oldLockIds, petCount, checkIn, checkOut, legacyPetCounts = {}) => {
  const dates = hotelCapacityDates(checkIn, checkOut);
  const count = Number(petCount);
  if (!Number.isInteger(count) || count < 1 || count > HOTEL_PET_CAPACITY || !dates.length) {
    throw new BookingConflictError('A valid pet count and stay date range are required.');
  }
  const oldIds = new Set(Array.isArray(oldLockIds) ? oldLockIds : []);
  const idsByDate = dates.map((date) => hotelCapacitySlotIds(date));
  const allIds = [...new Set([...oldIds, ...idsByDate.flat()])];
  const refs = allIds.map((id) => lockCollection.doc(id));
  const replacement = await firestore.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
    const snapshotById = new Map(refs.map((ref, index) => [ref.id, snapshots[index]]));
    const selectedByDate = [];

    for (let index = 0; index < dates.length; index += 1) {
      const ids = idsByDate[index];
      const occupiedByOtherLocks = ids.filter((id) => snapshotById.get(id)?.exists && !oldIds.has(id)).length;
      const legacyOccupied = Math.max(0, Number(legacyPetCounts[dates[index]]) || 0);
      const availableIds = ids.filter((id) => !snapshotById.get(id)?.exists || oldIds.has(id));
      if (occupiedByOtherLocks + legacyOccupied + count > HOTEL_PET_CAPACITY || availableIds.length < count) {
        throw new BookingConflictError('There are not enough hotel spaces for those dates. Please choose another stay.');
      }
      selectedByDate.push(availableIds.slice(0, count));
    }

    const created = [];
    selectedByDate.forEach((ids, index) => {
      ids.forEach((id) => {
        if (!snapshotById.get(id)?.exists) {
          transaction.create(lockCollection.doc(id), {
            type: 'hotel-capacity',
            date: dates[index],
            createdAt: new Date(),
          });
          created.push(id);
        }
      });
    });
    return { lockIds: selectedByDate.flat(), createdLockIds: created };
  });
  return replacement;
};

const hotelReservationLockIds = (reservation) => {
  if (reservation?.capacityManaged) return Array.isArray(reservation.capacityLockIds) ? reservation.capacityLockIds : [];
  const roomTypes = Array.isArray(reservation?.roomTypes) && reservation.roomTypes.length
    ? reservation.roomTypes
    : Array.isArray(reservation?.petRooms) && reservation.petRooms.length
      ? reservation.petRooms.map((petRoom) => petRoom.roomType)
      : [reservation?.roomType];
  return hotelLockIdsForTypes(roomTypes, reservation?.checkIn, reservation?.checkOut);
};

const areBookingSlotsAvailable = async (lockIds) => {
  if (!lockIds.length) return true;
  return (await getUnavailableBookingSlotIds(lockIds)).size === 0;
};

const getUnavailableBookingSlotIds = async (lockIds) => {
  const ids = [...new Set(lockIds)];
  const unavailable = new Set();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const refs = batch.map((id) => lockCollection.doc(id));
    const snapshots = await firestore.getAll(...refs);
    snapshots.forEach((snapshot, index) => {
      if (snapshot.exists) unavailable.add(batch[index]);
    });
  }
  return unavailable;
};

const claimBookingSlots = async (lockIds, details) => {
  const refs = lockIds.map((id) => lockCollection.doc(id));
  await firestore.runTransaction(async (transaction) => {
    const snapshots = [];
    for (const ref of refs) snapshots.push(await transaction.get(ref));
    if (snapshots.some((snapshot) => snapshot.exists)) {
      throw new BookingConflictError('That schedule is already booked. The first customer to request it was prioritized. Please choose another time or date.');
    }
    refs.forEach((ref) => transaction.create(ref, { ...details, createdAt: new Date() }));
  });
  return refs;
};

const releaseBookingSlots = async (refs) => {
  if (refs && refs.length) await Promise.all(refs.map((ref) => ref.delete()));
};

const releaseBookingSlotsByIds = async (lockIds) => {
  const refs = (Array.isArray(lockIds) ? lockIds : []).map((id) => lockCollection.doc(id));
  await releaseBookingSlots(refs);
};

// Claims a replacement schedule before the caller changes its booking record.
// Keeping the old locks until this succeeds prevents an update from exposing a
// slot that is still represented by the existing booking.
const claimReplacementBookingSlots = async (oldLockIds, newLockIds, details, oldOwner = null) => {
  const oldIds = new Set(oldLockIds);
  const newRefs = newLockIds.map((id) => lockCollection.doc(id));
  const createdIds = await firestore.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(newRefs.map((ref) => transaction.get(ref)));
    const belongsToOld = (snapshot, id) => {
      if (!oldIds.has(id) || !snapshot.exists) return false;
      if (!oldOwner) return true;
      const data = snapshot.data() || {};
      return data.type === oldOwner.type && data.date === oldOwner.date && data.time === oldOwner.time;
    };
    if (snapshots.some((snapshot, index) => snapshot.exists && !belongsToOld(snapshot, newLockIds[index]))) {
      throw new BookingConflictError('That schedule is already booked. Please choose another time or date.');
    }
    const created = [];
    newRefs.forEach((ref, index) => {
      if (!snapshots[index].exists) {
        transaction.create(ref, { ...details, createdAt: new Date() });
        created.push(newLockIds[index]);
      }
    });
    return created;
  });
  return createdIds;
};

module.exports = {
  BookingConflictError,
  groomingLockIds,
  releaseGroomingBookingSlots,
  releaseGroomingLockIds,
  hotelLockIds,
  hotelLockIdsForTypes,
  HOTEL_PET_CAPACITY,
  hotelCapacityDates,
  getHotelCapacityAvailability,
  claimHotelCapacity,
  claimReplacementHotelCapacity,
  hotelReservationLockIds,
  areBookingSlotsAvailable,
  claimBookingSlots,
  claimReplacementBookingSlots,
  releaseBookingSlots,
  releaseBookingSlotsByIds,
};
