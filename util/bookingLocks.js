const { firestore } = require('../config/firebase');

class BookingConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BookingConflictError';
    this.status = 409;
  }
}

const lockCollection = firestore.collection('bookingSlots');

const groomingLockIds = (date, time) => [`grooming_${date}_${time}`];

const hotelLockIds = (roomType, checkIn, checkOut) => {
  const locks = [];
  for (let day = new Date(`${checkIn}T00:00:00.000Z`); day < new Date(`${checkOut}T00:00:00.000Z`); day.setUTCDate(day.getUTCDate() + 1)) {
    locks.push(`hotel_${roomType}_${day.toISOString().slice(0, 10)}`);
  }
  return locks;
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
const claimReplacementBookingSlots = async (oldLockIds, newLockIds, details) => {
  const oldIds = new Set(oldLockIds);
  const newRefs = newLockIds.map((id) => lockCollection.doc(id));
  await firestore.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(newRefs.map((ref) => transaction.get(ref)));
    if (snapshots.some((snapshot, index) => snapshot.exists && !oldIds.has(newLockIds[index]))) {
      throw new BookingConflictError('That schedule is already booked. Please choose another time or date.');
    }
    newRefs.forEach((ref, index) => {
      if (!oldIds.has(newLockIds[index])) transaction.create(ref, { ...details, createdAt: new Date() });
    });
  });
  return newLockIds.filter((id) => !oldIds.has(id));
};

module.exports = { BookingConflictError, groomingLockIds, hotelLockIds, claimBookingSlots, claimReplacementBookingSlots, releaseBookingSlots, releaseBookingSlotsByIds };
