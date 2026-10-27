const { firestore } = require('../config/firebase');

class BookingConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BookingConflictError';
    this.status = 409;
  }
}

const lockCollection = firestore.collection('bookingSlots');
const HOTEL_DAILY_CAPACITY = 35;

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

const hotelDateKeys = (checkIn, checkOut) => {
  const dates = [];
  for (let day = new Date(`${checkIn}T00:00:00.000Z`); day < new Date(`${checkOut}T00:00:00.000Z`); day.setUTCDate(day.getUTCDate() + 1)) {
    dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
};

const hotelSlotLockId = (date, slotNumber) => `hotel_capacity_${date}_${slotNumber}`;

const hotelLockIdsForSlots = (slotNumbers, checkIn, checkOut) => hotelDateKeys(checkIn, checkOut)
  .flatMap((date) => slotNumbers.map((slotNumber) => hotelSlotLockId(date, slotNumber)));

const hotelLockIdsForAssignments = (assignments) => Object.entries(assignments || {})
  .flatMap(([date, slotNumbers]) => slotNumbers.map((slotNumber) => hotelSlotLockId(date, slotNumber)));

const withFirestoreFallback = async (operation, fallbackValue, label) => {
  try {
    return await operation();
  } catch (error) {
    console.warn(`[bookingLocks] ${label} failed; continuing without Firestore locks.`, error.message || error);
    return fallbackValue;
  }
};

const claimHotelSlots = async ({ checkIn, checkOut, slotCount, selectedSlotNumbers, legacyOccupancyByDate, ownerId, details }) => {
  const requestedSlots = selectedSlotNumbers == null ? null : [...new Set(selectedSlotNumbers)];
  if (requestedSlots && (requestedSlots.length !== slotCount
    || requestedSlots.some((slot) => !Number.isInteger(slot) || slot < 1 || slot > HOTEL_DAILY_CAPACITY))) {
    throw new BookingConflictError(`Choose exactly ${slotCount} different hotel slots from 1 to ${HOTEL_DAILY_CAPACITY}.`);
  }
  const dates = hotelDateKeys(checkIn, checkOut);
  const candidateIds = dates.flatMap((date) => Array.from(
    { length: HOTEL_DAILY_CAPACITY },
    (_, index) => hotelSlotLockId(date, index + 1),
  ));
  const refs = candidateIds.map((id) => lockCollection.doc(id));
  const assignments = await firestore.runTransaction(async (transaction) => {
    const snapshots = [];
    for (let offset = 0; offset < refs.length; offset += 100) {
      const batch = await Promise.all(refs.slice(offset, offset + 100).map((ref) => transaction.get(ref)));
      snapshots.push(...batch);
    }
    const snapshotsById = new Map(candidateIds.map((id, index) => [id, snapshots[index]]));

    const availableAcrossStay = Array.from({ length: HOTEL_DAILY_CAPACITY }, (_, index) => index + 1)
        .filter((slotNumber) => {
          return dates.every((date) => {
            const legacySlots = legacyOccupancyByDate.get(date);
            if (legacySlots instanceof Set ? legacySlots.has(slotNumber) : slotNumber <= (legacySlots || 0)) return false;
            const snapshot = snapshotsById.get(hotelSlotLockId(date, slotNumber));
            return !snapshot.exists || snapshot.data()?.ownerId === ownerId;
          });
        });
    const slots = requestedSlots || availableAcrossStay.slice(0, slotCount);
    if (slots.length < slotCount || slots.some((slotNumber) => !availableAcrossStay.includes(slotNumber))) {
      throw new BookingConflictError('One or more selected hotel slots are unavailable for the full stay. Choose different slots or dates.');
    }
    const assignmentMap = Object.fromEntries(dates.map((date) => [date, slots]));
    for (const date of dates) {
      for (const slotNumber of assignmentMap[date]) {
        const id = hotelSlotLockId(date, slotNumber);
        const ref = lockCollection.doc(id);
        const snapshot = snapshotsById.get(id);
        if (!snapshot.exists) {
          transaction.create(ref, { ...details, type: 'hotel-capacity', date, slotNumber, ownerId });
        }
      }
    }
    return assignmentMap;
  });
  return assignments;
};

const areBookingSlotsAvailable = async (lockIds) => {
  if (!lockIds.length) return true;
  return (await getUnavailableBookingSlotIds(lockIds)).size === 0;
};

const getUnavailableBookingSlotIds = async (lockIds) => {
  const ids = [...new Set(lockIds)];
  if (!ids.length) return new Set();
  return withFirestoreFallback(async () => {
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
  }, new Set(), 'Checking booking slot availability');
};

const claimBookingSlots = async (lockIds, details) => {
  const refs = lockIds.map((id) => lockCollection.doc(id));
  await withFirestoreFallback(async () => {
    await firestore.runTransaction(async (transaction) => {
      const snapshots = [];
      for (const ref of refs) snapshots.push(await transaction.get(ref));
      if (snapshots.some((snapshot) => snapshot.exists)) {
        throw new BookingConflictError('That schedule is already booked. The first customer to request it was prioritized. Please choose another time or date.');
      }
      refs.forEach((ref) => transaction.create(ref, { ...details, createdAt: new Date() }));
    });
    return refs;
  }, refs, 'Claiming booking slots');
  return refs;
};

const releaseBookingSlots = async (refs) => {
  if (!refs || !refs.length) return;
  await withFirestoreFallback(async () => {
    await Promise.all(refs.map((ref) => ref.delete()));
  }, undefined, 'Releasing booking slots');
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
  const createdIds = await withFirestoreFallback(async () => {
    const created = await firestore.runTransaction(async (transaction) => {
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
      const createdNow = [];
      newRefs.forEach((ref, index) => {
        if (!snapshots[index].exists) {
          transaction.create(ref, { ...details, createdAt: new Date() });
          createdNow.push(newLockIds[index]);
        }
      });
      return createdNow;
    });
    return created;
  }, [...newLockIds], 'Claiming replacement booking slots');
  return createdIds;
};

module.exports = {
  BookingConflictError,
  HOTEL_DAILY_CAPACITY,
  groomingLockIds,
  hotelLockIds,
  hotelLockIdsForTypes,
  hotelDateKeys,
  hotelSlotLockId,
  hotelLockIdsForSlots,
  hotelLockIdsForAssignments,
  claimHotelSlots,
  areBookingSlotsAvailable,
  getUnavailableBookingSlotIds,
  claimBookingSlots,
  claimReplacementBookingSlots,
  releaseBookingSlots,
  releaseBookingSlotsByIds,
  releaseGroomingBookingSlots,
};
