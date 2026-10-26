const { Customer, Pet, GroomingAppointment, HotelReservation } = require('../models');
const { isValidMobileNumber } = require('../util/mobileNumber');

const attachPet = async (booking) => {
  if (!booking || !booking.petId) return booking;
  booking.Pet = await Pet.findByPk(booking.petId);
  return booking;
};

const attachCustomerPets = async (customer) => {
  customer.Pets = await Pet.findAll({ where: { customerId: customer.id } });
  return customer;
};

const customerCreatedAt = (customer) => {
  const value = customer.createdAt;
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
};

const listCustomers = async (req, res, next) => {
  try {
    const customers = await Customer.findAll({
      include: [{ model: Pet }],
    });
    customers.sort((left, right) => customerCreatedAt(right) - customerCreatedAt(left));
    res.json(await Promise.all(customers.map(attachCustomerPets)));
  } catch (error) {
    next(error);
  }
};

const getCustomer = async (req, res, next) => {
  try {
    const customer = await Customer.findByPk(req.params.id, {
      include: [
        { model: Pet },
        { model: GroomingAppointment, include: [Pet] },
        { model: HotelReservation, include: [Pet] },
      ],
    });
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    await attachCustomerPets(customer);
    const [grooming, hotel] = await Promise.all([
      GroomingAppointment.findAll({ where: { customerId: customer.id }, order: [['createdAt', 'DESC']] }),
      HotelReservation.findAll({ where: { customerId: customer.id }, order: [['createdAt', 'DESC']] }),
    ]);
    customer.GroomingAppointments = await Promise.all(grooming.map(attachPet));
    customer.HotelReservations = await Promise.all(hotel.map(attachPet));
    res.json(customer);
  } catch (error) {
    next(error);
  }
};

const createCustomer = async (req, res, next) => {
  try {
    const { name, email, phone, address } = req.body;
    if (!isValidMobileNumber(phone)) {
      return res.status(400).json({ error: 'Phone number must contain exactly 11 digits.' });
    }
    const customer = await Customer.create({ name, email, phone, address });
    res.status(201).json(customer);
  } catch (error) {
    next(error);
  }
};

const updateCustomer = async (req, res, next) => {
  try {
    const customer = await Customer.findByPk(req.params.id);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    const { name, email, phone, address } = req.body;
    if (!isValidMobileNumber(phone)) {
      return res.status(400).json({ error: 'Phone number must contain exactly 11 digits.' });
    }
    await customer.update({ name, email, phone, address });
    res.json(customer);
  } catch (error) {
    next(error);
  }
};

const deleteCustomer = async (req, res, next) => {
  try {
    const customer = await Customer.findByPk(req.params.id);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    await customer.destroy();
    res.json({ message: 'Customer deleted' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,
};
