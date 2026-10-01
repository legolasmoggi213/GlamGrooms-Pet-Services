const { GroomingAppointment, Customer, Pet } = require('../models');
const { sendBookingConfirmation } = require('../util/mailer');
const { groomingLockIds, claimBookingSlots, claimReplacementBookingSlots, releaseBookingSlots, releaseBookingSlotsByIds } = require('../util/bookingLocks');
const { validateTime } = require('../util/businessHours');
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
    SERVICE_PRICES[`ayurveda-pkg-${pkg.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${size.toLowerCase()}`] = price;
  });
});

const SERVICE_DETAILS = {
  grooming: Object.fromEntries(Object.keys(GROOMING).map((tier) => [tier.toLowerCase(), { category: 'Grooming & Spa', duration: 90, includes: ['Full bath', 'Premium shampoo', 'Blow dry', 'Brush-out'], suitable: SIZES }])),
  'a-la-carte': { category: 'A La Carte', duration: 30, includes: ['Individual treatment'], suitable: SIZES },
  ayurveda: Object.fromEntries(Object.keys(AYURVEDA_HERBS).map((herb) => [herb.toLowerCase().replace(/'/g, ''), { category: 'Animal Ayurveda', duration: 60, includes: ['Herbal treatment'], suitable: SIZES }])),
  packages: Object.fromEntries(Object.keys(AYURVEDA_PACKAGES).map((pkg) => [pkg.toLowerCase().replace(/[^a-z0-9]/g, '-'), { category: 'Ayurveda Packages', duration: 120, includes: ['Combined treatments'], suitable: SIZES }])),
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
    if (pickupTime) {
      const check = validateTime(date, pickupTime);
      if (!check.ok) return res.status(400).json({ error: check.error });
    }
    const existingAppointments = await GroomingAppointment.findAll({ where: { date, time } });
    if (existingAppointments.some((item) => item.status !== 'cancelled')) {
      return res.status(409).json({ error: 'That grooming time is already booked.' });
    }

    const lockRefs = status === 'cancelled' ? [] : await claimBookingSlots(groomingLockIds(date, time), { type: 'grooming', date, time });
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
    const scheduleChanged = nextDate !== appointment.date || nextTime !== appointment.time;
    if (scheduleChanged && status !== 'cancelled') {
      const conflicts = await GroomingAppointment.findAll({ where: { date: nextDate, time: nextTime } });
      if (conflicts.some((item) => String(item.id) !== String(appointment.id) && item.status !== 'cancelled')) {
        return res.status(409).json({ error: 'That grooming time is already booked.' });
      }
    }
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
      updates.service = service;
      updates.price = SERVICE_PRICES[service];
    }
    const wasConfirmed = appointment.status === 'confirmed';
    const oldDate = appointment.date;
    const oldTime = appointment.time;
    const oldLockIds = groomingLockIds(oldDate, oldTime);
    const newLockIds = groomingLockIds(nextDate, nextTime);
    let claimedNewLockIds = [];
    if (scheduleChanged && updates.status !== 'cancelled') {
      claimedNewLockIds = await claimReplacementBookingSlots(oldLockIds, newLockIds, { type: 'grooming', date: nextDate, time: nextTime });
    }
    try {
      await appointment.update(updates);
    } catch (error) {
      if (claimedNewLockIds.length) await releaseBookingSlotsByIds(claimedNewLockIds);
      throw error;
    }
    if (updates.status === 'cancelled') {
      await releaseBookingSlotsByIds(oldLockIds);
    } else if (scheduleChanged) {
      await releaseBookingSlotsByIds(oldLockIds.filter((id) => !newLockIds.includes(id)));
    }
    const full = await GroomingAppointment.findByPk(appointment.id, { include: includeAll });
    let emailSent = false;
    if (updates.status === 'confirmed' && !wasConfirmed) {
      const [customer, pet] = await Promise.all([
        Customer.findByPk(full.customerId),
        Pet.findByPk(full.petId),
      ]);
      try {
        emailSent = await sendBookingConfirmation({
          to: customer && customer.email,
          customerName: customer && customer.name,
          type: 'grooming',
          service: full.service,
          date: full.date,
          time: full.time,
          pickupTime: full.pickupTime || null,
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

const deleteAppointment = async (req, res, next) => {
  try {
    const appointment = await GroomingAppointment.findByPk(req.params.id);
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    await appointment.destroy();
    await releaseBookingSlotsByIds(groomingLockIds(appointment.date, appointment.time));
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
