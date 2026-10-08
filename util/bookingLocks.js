const { firestore } = require('../config/firebase');

class BookingConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BookingConflictError';
    this.status = 409;
  }
}

const lockCollection = firestore.collection('bookingSlots');

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

const areBookingSlotsAvailable = async (lockIds) => {
  if (!lockIds.length) return true;
  const refs = lockIds.map((id) => lockCollection.doc(id));
  const snapshots = await firestore.getAll(...refs);
  return snapshots.every((snapshot) => !snapshot.exists);
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
  const refs = lockIds.map((id) => lockCollection.doc(id));
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

module.exports = { BookingConflictError, groomingLockIds, releaseGroomingBookingSlots, releaseGroomingLockIds, hotelLockIds, hotelLockIdsForTypes, areBookingSlotsAvailable, claimBookingSlots, claimReplacementBookingSlots, releaseBookingSlots, releaseBookingSlotsByIds };
