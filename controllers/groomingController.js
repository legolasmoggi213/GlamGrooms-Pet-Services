const { GroomingAppointment, Customer, Pet } = require('../models');
const { sendReservationTicket } = require('../util/mailer');
const { groomingLockIds, releaseGroomingBookingSlots, releaseGroomingLockIds, claimBookingSlots, claimReplacementBookingSlots, releaseBookingSlots, releaseBookingSlotsByIds } = require('../util/bookingLocks');
const { validateTime, validatePickupTime, validateAppointmentDuration } = require('../util/businessHours');
const { groomingBookingDuration, groomingRecordDuration, timeToMinutes, validateFutureBookingTime } = require('../util/bookingCalculations');
const catalog = require('../util/serviceCatalog');

// Exact service menus from the Glam Grooms flyers.
const { SIZES, GROOMING, A_LA_CARTE, AYURVEDA_HERBS, AYURVEDA_PACKAGES } = catalog;

const SERVICE_PRICES = {};

Object.entries(GROOMING).forEach(([tier, sizes]) => {
  Object.entries(sizes).forEach(([size, price]) => {
    SERVICE_PRICES[`grooming-${tier.toLowerCase()}-${size.toLowerCase()}`] = price;
  });
});
Object.entries(A_LA_CARTE).forEach(([name, price]) => {
  const key = `grooming-a-la-carte-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
  SERVICE_PRICES[key] = typeof price === 'object' ? price.max : price;
});

Object.entries(AYURVEDA_HERBS).forEach(([herb, sizes]) => {
  Object.entries(sizes).forEach(([size, price]) => {
    SERVICE_PRICES[`ayurveda-herb-${herb.toLowerCase().replace(/'/g, '')}-${size.toLowerCase()}`] = price;
  });
});

Object.entries(AYURVEDA_PACKAGES).forEach(([pkg, sizes]) => {
  Object.entries(sizes).forEach(([size, price]) => {
    SERVICE_PRICES[`ayurveda-pkg-${pkg.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]/g, '-')}-${size.toLowerCase()}`] = price;
  });
});

const SERVICE_DETAILS = {
  grooming: Object.fromEntries(Object.keys(GROOMING).map((tier) => [tier.toLowerCase(), { category: 'Grooming & Spa', duration: 90, includes: ['Full bath', 'Premium shampoo', 'Blow dry', 'Brush-out'], suitable: SIZES }])),
  'a-la-carte': { category: 'A La Carte', duration: 30, includes: ['Individual treatment'], suitable: SIZES },
  ayurveda: Object.fromEntries(Object.keys(AYURVEDA_HERBS).map((herb) => [herb.toLowerCase().replace(/'/g, ''), { category: 'Animal Ayurveda', duration: 60, includes: ['Herbal treatment'], suitable: SIZES }])),
  packages: Object.fromEntries(Object.keys(AYURVEDA_PACKAGES).map((pkg) => [pkg.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]/g, '-'), { category: 'Ayurveda Packages', duration: 120, includes: ['Combined treatments'], suitable: SIZES }])),
};
const VALID_STATUSES = ['pending', 'scheduled', 'confirmed', 'in-progress', 'completed', 'cancelled'];

const includeAll = [
  { model: Customer, attributes: ['id', 'name', 'email', 'phone'] },
  { model: Pet, attributes: ['id', 'name', 'species', 'breed'] },
];

const addRelatedRecords = async (appointment) => {
  if (!appointment) return appointment;
  const [customer, pet] = await Promise.all([
    Customer.findByPk(appointment.customerId),
    Pet.findByPk(appointment.petId),
  ]);
  appointment.Customer = customer;
  appointment.Pet = pet;
  return appointment;
};

const listAppointments = async (req, res, next) => {
  try {
    const appointments = await GroomingAppointment.findAll({
      include: includeAll,
      order: [['date', 'DESC'], ['time', 'ASC']],
    });
    const valid = appointments.filter((a) => !(a.paymentMethod === 'qrph' && a.paymentStatus === 'pending'));
    res.json(await Promise.all(valid.map(addRelatedRecords)));
  } catch (error) {
    next(error);
  }
};

const getAppointment = async (req, res, next) => {
  try {
    const appointment = await GroomingAppointment.findByPk(req.params.id, { include: includeAll });
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    res.json(await addRelatedRecords(appointment));
  } catch (error) {
    next(error);
  }
};

const createAppointment = async (req, res, next) => {
  try {
    const { service, date, time, pickupTime, notes, customerId, petId, status } = req.body;

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
    if (!Object.prototype.hasOwnProperty.call(SERVICE_PRICES, service)) {
      return res.status(400).json({ error: 'A valid service is required' });
    }
    if (req.body.status && !VALID_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ error: 'A valid status is required' });
    }
    if (time) {
      const check = validateTime(date, time);
      if (!check.ok) return res.status(400).json({ error: check.error });
    }
    const durationMinutes = groomingBookingDuration([service]);
    if (!durationMinutes) return res.status(400).json({ error: 'A valid service duration is required.' });
    const futureTimeCheck = validateFutureBookingTime(date, time, 'Appointment');
    if (!futureTimeCheck.ok) return res.status(400).json({ error: futureTimeCheck.error });
    const durationCheck = validateAppointmentDuration(date, time, durationMinutes);
    if (!durationCheck.ok) return res.status(400).json({ error: durationCheck.error });
    if (pickupTime) {
      const check = validatePickupTime(date, pickupTime);
      if (!check.ok) return res.status(400).json({ error: check.error });
      if (timeToMinutes(pickupTime) < timeToMinutes(durationCheck.pickupEarliest)) {
        return res.status(400).json({ error: `Pickup must be at or after ${durationCheck.pickupEarliest}.` });
      }
    }
    const requestedStart = timeToMinutes(time);
    const requestedEnd = requestedStart + durationMinutes;
    const existingAppointments = await GroomingAppointment.findAll({ where: { date } });
    if (status !== 'cancelled' && existingAppointments.some((item) => {
      const existingStart = timeToMinutes(item.time);
      return item.status !== 'cancelled' && existingStart !== null
        && existingStart < requestedEnd
        && existingStart + groomingRecordDuration(item) > requestedStart;
    })) {
      return res.status(409).json({ error: 'That grooming time is already booked.' });
    }

    const lockRefs = status === 'cancelled' ? [] : await claimBookingSlots(groomingLockIds(date, time, durationMinutes), { type: 'grooming', date, time, durationMinutes });
    let created = false;
    let appointment;
    try {
      appointment = await GroomingAppointment.create({
        service,
        date,
        time,
        pickupTime: pickupTime || null,
        notes,
        customerId,
        petId,
        status: status || 'pending',
        price: SERVICE_PRICES[service],
      });
      created = true;
    } finally {
      if (!created) await releaseBookingSlots(lockRefs);
    }
    const full = await GroomingAppointment.findByPk(appointment.id, { include: includeAll });
    res.status(201).json(await addRelatedRecords(full));
  } catch (error) {
    next(error);
  }
};

const updateAppointment = async (req, res, next) => {
  try {
    const appointment = await GroomingAppointment.findByPk(req.params.id);
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    const { service, date, time, pickupTime, status, notes, customerId, petId } = req.body;
    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'A valid status is required' });
    }
    if (customerId !== undefined && !(await Customer.findByPk(customerId))) {
      return res.status(400).json({ error: 'A valid customerId is required' });
    }
    if (petId !== undefined && !(await Pet.findByPk(petId))) {
      return res.status(400).json({ error: 'A valid petId is required' });
    }
    const nextDate = date || appointment.date;
    const nextTime = time || appointment.time;
    let scheduleChanged = nextDate !== appointment.date || nextTime !== appointment.time;
    const updates = {
      date: nextDate,
      time: nextTime,
      status: status || appointment.status,
      notes: notes === undefined ? appointment.notes : notes,
      pickupTime: pickupTime === undefined ? (appointment.pickupTime || null) : (pickupTime || null),
      customerId: customerId === undefined ? appointment.customerId : customerId,
      petId: petId === undefined ? appointment.petId : petId,
    };
    if (service && Object.prototype.hasOwnProperty.call(SERVICE_PRICES, service)) {
      if (Array.isArray(appointment.petServices) && appointment.petServices.length) {
        let updatedAssignment = false;
        updates.petServices = appointment.petServices.map((assignment, index) => {
          if (!updatedAssignment && String(assignment.petId) === String(updates.petId)) {
            updatedAssignment = true;
            return { ...assignment, service, price: SERVICE_PRICES[service] };
          }
          if (!updatedAssignment && index === 0) {
            updatedAssignment = true;
            return { ...assignment, service, price: SERVICE_PRICES[service] };
          }
          return assignment;
        });
        const distinctServices = [...new Set(updates.petServices.map((assignment) => assignment.service))];
        updates.service = distinctServices.length === 1 ? distinctServices[0] : 'multiple-services';
        updates.price = updates.petServices.reduce((sum, assignment) => sum + Number(assignment.price || 0), 0);
      } else {
        updates.service = service;
        updates.price = SERVICE_PRICES[service];
      }
    }
    const oldDuration = groomingRecordDuration(appointment);
    const nextDuration = groomingRecordDuration({
      service: updates.service || appointment.service,
      petServices: updates.petServices || appointment.petServices,
    });
    scheduleChanged = scheduleChanged || oldDuration !== nextDuration;
    if (scheduleChanged && status !== 'cancelled') {
      const futureTimeCheck = validateFutureBookingTime(nextDate, nextTime, 'Appointment');
      if (!futureTimeCheck.ok) return res.status(400).json({ error: futureTimeCheck.error });
      const durationCheck = validateAppointmentDuration(nextDate, nextTime, nextDuration);
      if (!durationCheck.ok) return res.status(400).json({ error: durationCheck.error });
      if (updates.pickupTime && timeToMinutes(updates.pickupTime) < timeToMinutes(durationCheck.pickupEarliest)) {
        return res.status(400).json({ error: `Pickup must be at or after ${durationCheck.pickupEarliest}.` });
      }
      const start = timeToMinutes(nextTime);
      const end = start + nextDuration;
      const conflicts = await GroomingAppointment.findAll({ where: { date: nextDate } });
      if (conflicts.some((item) => {
        if (String(item.id) === String(appointment.id) || item.status === 'cancelled') return false;
        const otherStart = timeToMinutes(item.time);
        return otherStart !== null && otherStart < end && otherStart + groomingRecordDuration(item) > start;
      })) return res.status(409).json({ error: 'That grooming time is already booked.' });
    }
    const needsAdminConfirmation = status === 'confirmed' && !appointment.confirmedAt;
    const shouldSendTicket = status === 'confirmed' && !appointment.reservationTicketEmailSentAt;
    if (needsAdminConfirmation) updates.confirmedAt = new Date();
    const oldDate = appointment.date;
    const oldTime = appointment.time;
    const oldLockIds = groomingLockIds(oldDate, oldTime, oldDuration);
    const newLockIds = groomingLockIds(nextDate, nextTime, nextDuration);
    let claimedNewLockIds = [];
    if (scheduleChanged && updates.status !== 'cancelled') {
      claimedNewLockIds = await claimReplacementBookingSlots(
        oldLockIds,
        newLockIds,
        { type: 'grooming', date: nextDate, time: nextTime, durationMinutes: nextDuration },
        { type: 'grooming', date: oldDate, time: oldTime },
      );
    }
    try {
      await appointment.update(updates);
    } catch (error) {
      if (claimedNewLockIds.length) await releaseBookingSlotsByIds(claimedNewLockIds);
      throw error;
    }
    if (updates.status === 'cancelled') {
      await releaseGroomingBookingSlots(oldDate, oldTime, oldDuration);
    } else if (scheduleChanged) {
      await releaseGroomingLockIds(oldLockIds.filter((id) => !newLockIds.includes(id)), oldDate, oldTime);
    }
    const full = await GroomingAppointment.findByPk(appointment.id, { include: includeAll });
    let emailSent = false;
    if (shouldSendTicket) {
      const [customer, pets] = await Promise.all([
        Customer.findByPk(full.customerId),
        Promise.all((full.petIds || (full.petId ? [full.petId] : [])).map((id) => Pet.findByPk(id))),
      ]);
      try {
        if (customer) emailSent = await sendReservationTicket({
          bookingRecord: full,
          type: 'grooming',
          to: customer.email,
          customer: full.customerDetails || customer,
          pets: pets.filter(Boolean),
        });
      } catch (mailError) {
        console.error('Grooming reservation ticket email failed:', mailError);
      }
    }
    res.json({ ...(await addRelatedRecords(full)), emailSent });
  } catch (error) {
    next(error);
  }
};

const deleteAppointment = async (req, res, next) => {
  try {
    const appointment = await GroomingAppointment.findByPk(req.params.id);
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    await appointment.destroy();
    await releaseGroomingBookingSlots(appointment.date, appointment.time, groomingRecordDuration(appointment));
    res.json({ message: 'Appointment deleted' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  SERVICE_PRICES,
  SERVICE_DETAILS,
  listAppointments,
  getAppointment,
  createAppointment,
  updateAppointment,
  deleteAppointment,
};
