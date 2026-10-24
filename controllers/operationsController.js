const bcrypt = require('bcryptjs');
const { Employee, InventoryItem, StockRequest } = require('../models');
const { isStrongPassword } = require('../util/passwordPolicy');

const employeeResponse = (employee) => ({
  id: employee.id,
  name: employee.name,
  email: employee.email,
  phone: employee.phone || '',
  status: employee.status,
  createdAt: employee.createdAt,
  updatedAt: employee.updatedAt,
});

const cleanText = (value, maxLength) => String(value || '').trim().slice(0, maxLength);
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validCount = (value) => Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 1000000;

const listEmployees = async (req, res, next) => {
  try {
    const employees = await Employee.findAll({ order: [['createdAt', 'DESC']] });
    res.json(employees.map(employeeResponse));
  } catch (error) { next(error); }
};

const createEmployee = async (req, res, next) => {
  try {
    const name = cleanText(req.body.name, 120);
    const email = cleanText(req.body.email, 254).toLowerCase();
    const phone = cleanText(req.body.phone, 40);
    const password = String(req.body.password || '');
    if (!name || !validEmail(email)) {
      return res.status(400).json({ error: 'Enter a valid name and email address.' });
    }
    if (!isStrongPassword(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters, include uppercase and lowercase letters, a number, and a symbol.' });
    }
    if (await Employee.findOne({ where: { email } })) {
      return res.status(409).json({ error: 'An employee already uses that email.' });
    }
    const employee = await Employee.create({
      name,
      email,
      phone,
      passwordHash: bcrypt.hashSync(password, 10),
      status: 'active',
    });
    return res.status(201).json(employeeResponse(employee));
  } catch (error) { return next(error); }
};

const updateEmployee = async (req, res, next) => {
  try {
    const employee = await Employee.findByPk(req.params.id);
    if (!employee) return res.status(404).json({ error: 'Employee not found.' });

    const updates = {};
    if (req.body.name !== undefined) {
      updates.name = cleanText(req.body.name, 120);
      if (!updates.name) return res.status(400).json({ error: 'Name is required.' });
    }
    if (req.body.email !== undefined) {
      updates.email = cleanText(req.body.email, 254).toLowerCase();
      if (!validEmail(updates.email)) return res.status(400).json({ error: 'Enter a valid email address.' });
      const duplicate = await Employee.findOne({ where: { email: updates.email } });
      if (duplicate && String(duplicate.id) !== String(employee.id)) {
        return res.status(409).json({ error: 'An employee already uses that email.' });
      }
    }
    if (req.body.phone !== undefined) updates.phone = cleanText(req.body.phone, 40);
    if (req.body.password) {
      if (!isStrongPassword(req.body.password)) return res.status(400).json({ error: 'Password must be at least 8 characters, include uppercase and lowercase letters, a number, and a symbol.' });
      updates.passwordHash = bcrypt.hashSync(String(req.body.password), 10);
    }
    await employee.update(updates);
    return res.json(employeeResponse(employee));
  } catch (error) { return next(error); }
};

const terminateEmployee = async (req, res, next) => {
  try {
    const employee = await Employee.findByPk(req.params.id);
    if (!employee) return res.status(404).json({ error: 'Employee not found.' });
    await employee.update({ status: 'terminated', terminatedAt: new Date() });
    return res.json({ success: true, employee: employeeResponse(employee) });
  } catch (error) { return next(error); }
};

const normalizeProduct = (body, partial = false) => {
  const product = {};
  for (const [field, maxLength] of [['name', 120], ['category', 80], ['unit', 30]]) {
    if (!partial || body[field] !== undefined) product[field] = cleanText(body[field], maxLength);
  }
  for (const field of ['quantity', 'reorderLevel']) {
    if (!partial || body[field] !== undefined) product[field] = Number(body[field]);
  }
  if ((!partial && (!product.name || !product.category || !product.unit))
    || (product.name !== undefined && !product.name)
    || (product.category !== undefined && !product.category)
    || (product.unit !== undefined && !product.unit)) {
    return { error: 'Name, category, and unit are required.' };
  }
  for (const field of ['quantity', 'reorderLevel']) {
    if (product[field] !== undefined && !validCount(product[field])) {
      return { error: 'Quantity and reorder level must be whole numbers from 0 to 1,000,000.' };
    }
  }
  return { product };
};

const listProducts = async (req, res, next) => {
  try {
    const products = await InventoryItem.findAll({ order: [['name', 'ASC']] });
    res.json(products);
  } catch (error) { next(error); }
};

const createProduct = async (req, res, next) => {
  try {
    const { product, error } = normalizeProduct(req.body || {});
    if (error) return res.status(400).json({ error });
    const created = await InventoryItem.create(product);
    return res.status(201).json(created);
  } catch (error) { return next(error); }
};

const updateProduct = async (req, res, next) => {
  try {
    const item = await InventoryItem.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Inventory item not found.' });
    const { product, error } = normalizeProduct(req.body || {}, true);
    if (error) return res.status(400).json({ error });
    await item.update(product);
    return res.json(item);
  } catch (error) { return next(error); }
};

const deleteProduct = async (req, res, next) => {
  try {
    const item = await InventoryItem.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Inventory item not found.' });
    await item.destroy();
    return res.json({ success: true });
  } catch (error) { return next(error); }
};

const listStockRequests = async (req, res, next) => {
  try {
    const requests = await StockRequest.findAll({ order: [['createdAt', 'DESC']] });
    res.json(requests);
  } catch (error) { next(error); }
};

const createStockRequest = async (req, res, next) => {
  try {
    const item = await InventoryItem.findByPk(req.body.itemId);
    const quantity = Number(req.body.quantity);
    if (!item) return res.status(404).json({ error: 'Inventory item not found.' });
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000000) {
      return res.status(400).json({ error: 'Requested quantity must be a whole number greater than zero.' });
    }
    const requester = req.authEmployee ? req.authEmployee.name : 'ADMIN';
    const request = await StockRequest.create({
      itemId: item.id,
      itemName: item.name,
      unit: item.unit,
      quantity,
      notes: cleanText(req.body.notes, 500),
      requestedBy: requester,
      status: 'pending',
    });
    return res.status(201).json(request);
  } catch (error) { return next(error); }
};

const updateStockRequest = async (req, res, next) => {
  try {
    const request = await StockRequest.findByPk(req.params.id);
    if (!request) return res.status(404).json({ error: 'Stock request not found.' });
    const status = String(req.body.status || '').toLowerCase();
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Stock request status must be approved or rejected.' });
    }
    if (request.status !== 'pending') return res.status(409).json({ error: 'This stock request has already been reviewed.' });
    await request.update({ status, reviewedAt: new Date() });
    return res.json(request);
  } catch (error) { return next(error); }
};

module.exports = {
  listEmployees,
  createEmployee,
  updateEmployee,
  terminateEmployee,
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  listStockRequests,
  createStockRequest,
  updateStockRequest,
};
