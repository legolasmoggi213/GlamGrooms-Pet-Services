const { Pet, Customer } = require('../models');

const toCustomerSummary = (customer) => {
  if (!customer) return null;
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
  };
};

const attachCustomer = async (pet, customersMap = null) => {
  if (!pet) return pet;
  if (!pet.customerId) {
    pet.Customer = null;
    return pet;
  }
  if (customersMap) {
    pet.Customer = customersMap[String(pet.customerId)] || null;
  } else {
    const customer = await Customer.findByPk(pet.customerId);
    pet.Customer = toCustomerSummary(customer);
  }
  return pet;
};

const listPets = async (req, res, next) => {
  try {
    const [pets, customers] = await Promise.all([
      Pet.findAll({ order: [['createdAt', 'DESC']] }),
      Customer.findAll(),
    ]);
    const customersMap = {};
    customers.forEach((c) => {
      customersMap[String(c.id)] = toCustomerSummary(c);
    });
    pets.forEach((pet) => {
      attachCustomer(pet, customersMap);
    });
    res.json(pets);
  } catch (error) {
    next(error);
  }
};

const getPet = async (req, res, next) => {
  try {
    const pet = await Pet.findByPk(req.params.id);
    if (!pet) {
      return res.status(404).json({ error: 'Pet not found' });
    }
    await attachCustomer(pet);
    res.json(pet);
  } catch (error) {
    next(error);
  }
};

const createPet = async (req, res, next) => {
  try {
    const { name, species, breed, age, notes, customerId } = req.body;
    const customer = await Customer.findByPk(customerId);
    if (!customer) {
      return res.status(400).json({ error: 'A valid customerId is required' });
    }
    const pet = await Pet.create({ name, species, breed, age, notes, customerId });
    pet.Customer = toCustomerSummary(customer);
    res.status(201).json(pet);
  } catch (error) {
    next(error);
  }
};

const updatePet = async (req, res, next) => {
  try {
    const pet = await Pet.findByPk(req.params.id);
    if (!pet) {
      return res.status(404).json({ error: 'Pet not found' });
    }
    const { name, species, breed, age, notes, customerId } = req.body;
    let customer = null;
    if (customerId) {
      customer = await Customer.findByPk(customerId);
      if (!customer) {
        return res.status(400).json({ error: 'A valid customerId is required' });
      }
    }
    await pet.update({
      name,
      species,
      breed,
      age,
      notes,
      ...(customerId ? { customerId } : {}),
    });
    if (customerId) {
      pet.Customer = toCustomerSummary(customer);
    } else {
      await attachCustomer(pet);
    }
    res.json(pet);
  } catch (error) {
    next(error);
  }
};

const deletePet = async (req, res, next) => {
  try {
    const pet = await Pet.findByPk(req.params.id);
    if (!pet) {
      return res.status(404).json({ error: 'Pet not found' });
    }
    await pet.destroy();
    res.json({ message: 'Pet deleted' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listPets,
  getPet,
  createPet,
  updatePet,
  deletePet,
};
