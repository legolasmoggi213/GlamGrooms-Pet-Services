const { Customer, Pet, GroomingAppointment, HotelReservation } = require('../models');

const attachPet = async (booking) => {
  if (!booking || !booking.petId) return booking;
  booking.Pet = await Pet.findByPk(booking.petId);
  return booking;
};

const attachCustomerPets = async (customer) => {
  customer.Pets = await Pet.findAll({ where: { customerId: customer.id } });
  return customer;
};

const listCustomers = async (req, res, next) => {
  try {
    const customers = await Customer.findAll({
      include: [{ model: Pet }],
      order: [['createdAt', 'DESC']],
    });
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
      GroomingAppointment.findAll({ where: { customerId: customer.id }, order: [['date', 'DESC']] }),
      HotelReservation.findAll({ where: { customerId: customer.id }, order: [['checkIn', 'DESC']] }),
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
