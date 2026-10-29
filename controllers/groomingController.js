const { GroomingAppointment, Customer, Pet } = require('../models');
const { getRequestRole } = require('../util/adminAuth');
const { sendReservationTicket, sendPaymentReceipt, sendBookingCancellation } = require('../util/mailer');
const { requestGcashBookingRefund } = require('../util/paymentRefund');
const {
  GROOMING_HOURLY_CAPACITY,
  groomingLockIds,
  groomingCapacityLockIds,
  getGroomingAvailableSlotNumbers,
  claimGroomingBookingSlot,
  releaseBookingSlotsByIds,
  releaseGroomingBookingSlots,
  releaseGroomingLockIds,
} = require('../util/bookingLocks');
const { validateTime, validatePickupTime, validateAppointmentDuration } = require('../util/businessHours');
const {
  validateFutureBookingTime,
  timeToMinutes,
  groomingBookingDuration,
  groomingRecordDuration,
} = require('../util/bookingCalculations');
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
  const petIds = appointment.petIds || (appointment.petId ? [appointment.petId] : []);
  const [customer, pets] = await Promise.all([
    Customer.findByPk(appointment.customerId),
    Promise.all([...new Set(petIds.map(String))].map((id) => Pet.findByPk(id))),
  ]);
  appointment.Customer = customer;
  appointment.Pets = pets.filter(Boolean);
  appointment.Pet = appointment.Pets[0] || null;
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
    const { service, services: submittedServices, date, time, pickupTime, notes, customerId, petId, status } = req.body;
    const services = Array.isArray(submittedServices) && submittedServices.length
      ? submittedServices.map((item) => String(item || '').trim())
      : [String(service || '').trim()];
    const distinctServices = [...new Set(services)];

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
    if (!distinctServices.length || distinctServices.some((item) => !Object.prototype.hasOwnProperty.call(SERVICE_PRICES, item))) {
      return res.status(400).json({ error: 'A valid service is required' });
    }
    if (req.body.status && !VALID_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ error: 'A valid status is required' });
    }
    if (time) {
      const check = validateTime(date, time);
      if (!check.ok) return res.status(400).json({ error: check.error });
    }
    const durationMinutes = groomingBookingDuration(distinctServices);
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
    const existingAppointments = await GroomingAppointment.findAll({ where: { date } });
    let slotClaim = null;
    if (status !== 'cancelled') {
      const availableSlotNumbers = await getGroomingAvailableSlotNumbers({
        date,
        time,
        durationMinutes,
        bookings: existingAppointments.filter((item) => item.status !== 'cancelled')
          .map((item) => ({ ...item, durationMinutes: groomingRecordDuration(item) })),
      });
      if (!availableSlotNumbers.length) return res.status(409).json({ error: 'That grooming time is fully booked.' });
      slotClaim = await claimGroomingBookingSlot({
        date,
        time,
        durationMinutes,
        details: { type: 'grooming', date, time },
        blockedSlotNumbers: Array.from({ length: GROOMING_HOURLY_CAPACITY }, (_, index) => index + 1)
          .filter((slotNumber) => !availableSlotNumbers.includes(slotNumber)),
      });
    }
    let created = false;
    let appointment;
    try {
      appointment = await GroomingAppointment.create({
        service: distinctServices.length === 1 ? distinctServices[0] : 'multiple-services',
        ...(distinctServices.length > 1 ? {
          petServices: distinctServices.map((item) => ({
            petId: pet.id,
            petName: pet.name,
            service: item,
            price: SERVICE_PRICES[item],
          })),
          petIds: [pet.id],
          petNames: [pet.name],
        } : {}),
        date,
        time,
        ...(slotClaim ? { groomingSlotNumber: slotClaim.slotNumber } : {}),
        pickupTime: pickupTime || null,
        notes: notes || '',
        customerId,
        petId,
        status: status || 'pending',
        price: distinctServices.reduce((total, item) => total + SERVICE_PRICES[item], 0),
      });
      created = true;
    } finally {
      if (!created && slotClaim) await releaseBookingSlotsByIds(slotClaim.createdLockIds);
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
    const wasAlreadyCancelled = appointment.status === 'cancelled';
    const body = req.body || {};
    if (Object.prototype.hasOwnProperty.call(body, 'paymentStatus')) {
      if (Object.keys(body).length !== 1) {
        return res.status(400).json({ error: 'Payment status must be updated separately.' });
      }
      const paymentStatus = String(body.paymentStatus).toLowerCase();
      if (!['paid', 'unpaid'].includes(paymentStatus)) {
        return res.status(400).json({ error: 'Payment status must be paid or unpaid.' });
      }
      if (appointment.status !== 'in-progress' || !appointment.confirmedAt) {
        return res.status(409).json({ error: 'Payment can only be updated for confirmed, in-progress appointments.' });
      }
      if (appointment.paymentMethod === 'qrph') {
        return res.status(409).json({ error: 'GCash payment status is updated automatically after payment verification.' });
      }
      await appointment.update({
        paymentStatus,
        paymentPaidAt: paymentStatus === 'paid' ? new Date() : null,
      });
      return res.json({ success: true, paymentStatus });
    }
    const { service, date, time, pickupTime, status, notes, customerId, petId } = body;
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
    const oldDate = appointment.date;
    const oldTime = appointment.time;
    const oldLockIds = appointment.groomingSlotNumber
      ? groomingCapacityLockIds(oldDate, oldTime, oldDuration, appointment.groomingSlotNumber)
      : groomingLockIds(oldDate, oldTime, oldDuration);
    let newLockIds = oldLockIds;
    let slotClaim = null;
    if (scheduleChanged && status !== 'cancelled') {
      const futureTimeCheck = validateFutureBookingTime(nextDate, nextTime, 'Appointment');
      if (!futureTimeCheck.ok) return res.status(400).json({ error: futureTimeCheck.error });
      const durationCheck = validateAppointmentDuration(nextDate, nextTime, nextDuration);
      if (!durationCheck.ok) return res.status(400).json({ error: durationCheck.error });
      if (updates.pickupTime && timeToMinutes(updates.pickupTime) < timeToMinutes(durationCheck.pickupEarliest)) {
        return res.status(400).json({ error: `Pickup must be at or after ${durationCheck.pickupEarliest}.` });
      }
      const conflicts = await GroomingAppointment.findAll({ where: { date: nextDate } });
      const availableSlotNumbers = await getGroomingAvailableSlotNumbers({
        date: nextDate,
        time: nextTime,
        durationMinutes: nextDuration,
        bookings: conflicts.filter((item) => item.status !== 'cancelled')
          .map((item) => ({ ...item, durationMinutes: groomingRecordDuration(item) })),
        excludeBookingId: appointment.id,
        oldLockIds,
      });
      if (!availableSlotNumbers.length) return res.status(409).json({ error: 'That grooming time is fully booked.' });
      slotClaim = await claimGroomingBookingSlot({
        date: nextDate,
        time: nextTime,
        durationMinutes: nextDuration,
        details: { type: 'grooming', date: nextDate, time: nextTime },
        blockedSlotNumbers: Array.from({ length: GROOMING_HOURLY_CAPACITY }, (_, index) => index + 1)
          .filter((slotNumber) => !availableSlotNumbers.includes(slotNumber)),
        preferredSlotNumber: appointment.groomingSlotNumber,
        oldLockIds,
      });
      updates.groomingSlotNumber = slotClaim.slotNumber;
      newLockIds = slotClaim.lockIds;
    }
    const needsAdminConfirmation = status === 'confirmed' && !appointment.confirmedAt;
    if (needsAdminConfirmation) updates.confirmedAt = new Date();
    try {
      await appointment.update(updates);
    } catch (error) {
      if (slotClaim?.createdLockIds.length) await releaseBookingSlotsByIds(slotClaim.createdLockIds);
      throw error;
    }
    if (updates.status === 'cancelled') {
      await releaseGroomingBookingSlots(oldDate, oldTime, oldDuration, appointment.groomingSlotNumber);
    } else if (scheduleChanged) {
      await releaseGroomingLockIds(oldLockIds.filter((id) => !newLockIds.includes(id)), oldDate, oldTime);
    }
    if (updates.status === 'cancelled' && !wasAlreadyCancelled) {
      try {
        const customer = await Customer.findByPk(updates.customerId);
        const customerDetails = customer || appointment.customerDetails;
        if (customerDetails?.email) {
          const sent = await sendBookingCancellation({
            to: customerDetails.email,
            customerName: customerDetails.name,
            type: 'grooming',
            bookingId: appointment.id,
            date: updates.date,
            time: updates.time,
            service: updates.service || appointment.service,
          });
          if (!sent) console.warn(`Cancellation notice was not sent for grooming appointment ${appointment.id}.`);
        } else {
          console.warn(`No customer email is available for grooming appointment ${appointment.id} cancellation notice.`);
        }
      } catch (notificationError) {
        console.error(`Unable to send cancellation notice for grooming appointment ${appointment.id}:`, notificationError);
      }
    }
    const refund = updates.status === 'cancelled' && !wasAlreadyCancelled
      ? await requestGcashBookingRefund(appointment)
      : null;
    res.json({ success: true, refund });
  } catch (error) {
    next(error);
  }
};

const checkOutAppointment = async (req, res, next) => {
  try {
    const appointment = await GroomingAppointment.findByPk(req.params.id);
    if (!appointment) return res.status(404).json({ error: 'Appointment not found.' });
    if (!['in-progress', 'completed'].includes(String(appointment.status || '').toLowerCase())) {
      return res.status(409).json({ error: 'Only in-progress grooming appointments can be checked out.' });
    }
    if (String(appointment.paymentStatus || '').toLowerCase() !== 'paid') {
      return res.status(409).json({ error: 'Record payment before checking out this appointment.' });
    }

    if (String(appointment.status || '').toLowerCase() !== 'completed') {
      await appointment.update({ status: 'completed', checkedOutAt: new Date() });
    }

    const [customer, pets] = await Promise.all([
      Customer.findByPk(appointment.customerId),
      Promise.all((appointment.petIds || (appointment.petId ? [appointment.petId] : [])).map((id) => Pet.findByPk(id))),
    ]);
    const recipient = customer?.email || appointment.customerDetails?.email;
    if (!recipient) {
      return res.json({
        success: true,
        status: 'completed',
        emailSent: false,
        message: 'The appointment was checked out, but the customer has no email address for the receipt.',
      });
    }

    try {
      const emailSent = await sendPaymentReceipt({
        bookingRecord: appointment,
        type: 'grooming',
        to: recipient,
        customer: appointment.customerDetails || customer || {},
        pets: pets.filter(Boolean),
      });
      if (emailSent || appointment.paymentReceiptEmailSentAt) {
        return res.json({ success: true, status: 'completed', emailSent: true });
      }
      return res.json({
        success: true,
        status: 'completed',
        emailSent: false,
        message: 'The appointment was checked out, but the receipt email was not sent. Retry from Manage.',
      });
    } catch (emailError) {
      console.error(`Grooming payment receipt email failed for appointment ${appointment.id}:`, emailError);
      return res.json({
        success: true,
        status: 'completed',
        emailSent: false,
        message: 'The appointment was checked out, but the receipt email failed. Retry from Manage.',
      });
    }
  } catch (error) {
    next(error);
  }
};

const sendAppointmentTicket = async (req, res, next) => {
  try {
    const appointment = await GroomingAppointment.findByPk(req.params.id);
    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });
    if (!['in-progress', 'completed'].includes(String(appointment.status || '').toLowerCase())) {
      return res.status(409).json({ error: 'Check in the grooming appointment before sending its ticket.' });
    }

    const [customer, pets] = await Promise.all([
      Customer.findByPk(appointment.customerId),
      Promise.all((appointment.petIds || (appointment.petId ? [appointment.petId] : [])).map((id) => Pet.findByPk(id))),
    ]);
    if (!customer) return res.status(404).json({ error: 'The customer record for this appointment was not found.' });

    let alreadySent = Boolean(appointment.reservationTicketEmailSentAt);
    if (!alreadySent) {
      try {
        const emailSent = await sendReservationTicket({
          bookingRecord: appointment,
          type: 'grooming',
          to: customer.email,
          customer: appointment.customerDetails || customer,
          pets: pets.filter(Boolean),
        });
        if (!emailSent) {
          const refreshedAppointment = await GroomingAppointment.findByPk(appointment.id);
          if (refreshedAppointment?.reservationTicketEmailSentAt) {
            alreadySent = true;
          } else {
            return res.status(409).json({ error: 'The ticket is already being sent. Please wait before trying again.' });
          }
        }
      } catch (mailError) {
        console.error('Grooming reservation ticket email failed:', mailError);
        return res.status(502).json({ error: 'The ticket email failed. Check the server email provider logs.' });
      }
    }
    if (String(appointment.status || '').toLowerCase() !== 'completed') {
      await appointment.update({ status: 'completed', checkedOutAt: new Date() });
    }
    return res.json({ success: true, emailSent: true, alreadySent });
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
    if (getRequestRole(req) !== 'ADMIN' && appointment.status !== 'cancelled') {
      return res.status(403).json({ error: 'Staff can only delete cancelled grooming appointments.' });
    }
    await appointment.destroy();
    await releaseGroomingBookingSlots(appointment.date, appointment.time, groomingRecordDuration(appointment), appointment.groomingSlotNumber);
    res.json({ message: 'Appointment deleted' });
  } catch (error) {
    next(error);
  }
};

const resendAppointmentTicket = async (req, res, next) => {
  try {
    const appointment = await GroomingAppointment.findByPk(req.params.id);
    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });
    if (!['confirmed', 'in-progress', 'completed'].includes(appointment.status)) {
      return res.status(409).json({ error: 'Only confirmed appointments can receive a ticket.' });
    }

    const customer = await Customer.findByPk(appointment.customerId);
    if (!customer || !customer.email) {
      return res.status(400).json({ error: 'The customer record has no email address.' });
    }
    const petIds = appointment.petIds || (appointment.petId ? [appointment.petId] : []);
    const pets = await Promise.all(petIds.map((id) => Pet.findByPk(id)));
    const emailSent = await sendReservationTicket({
      bookingRecord: appointment,
      type: 'grooming',
      to: customer.email,
      customer: appointment.customerDetails || customer,
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
    console.error('Grooming appointment ticket resend failed:', error);
    return next(error);
  }
};

module.exports = {
  SERVICE_PRICES,
  SERVICE_DETAILS,
  listAppointments,
  getAppointment,
  createAppointment,
  updateAppointment,
  checkOutAppointment,
  sendAppointmentTicket,
  resendAppointmentTicket,
  deleteAppointment,
};
