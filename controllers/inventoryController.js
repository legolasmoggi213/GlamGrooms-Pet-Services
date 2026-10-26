const { InventoryItem, StockRequest } = require('../models');
const { firestore } = require('../config/firebase');
const { parseToken } = require('../util/adminAuth');

const MAX_STOCK = 1000000;
const publicInventoryItem = (item) => ({
  id: item.id,
  name: item.name,
  sku: item.sku || '',
  category: item.category || '',
  unit: item.unit || 'each',
  description: item.description || '',
  price: item.price == null || item.price === '' ? null : Number(item.price),
  quantity: Number(item.quantity || 0),
  lowStockThreshold: Number(item.lowStockThreshold || 0),
  active: item.active !== false,
  createdAt: item.createdAt || null,
  updatedAt: item.updatedAt || null,
});

const validateItem = (body = {}, current = {}) => {
  if (body.active !== undefined && typeof body.active !== 'boolean') {
    return { error: 'Active must be true or false.' };
  }
  const name = String(body.name === undefined ? current.name || '' : body.name).trim();
  const sku = String(body.sku === undefined ? current.sku || '' : body.sku).trim().toUpperCase();
  const category = String(body.category === undefined ? current.category || '' : body.category).trim();
  const unit = String(body.unit === undefined ? current.unit || 'each' : body.unit).trim();
  const description = String(body.description === undefined ? current.description || '' : body.description).trim();
  const rawPrice = body.price === undefined ? current.price : body.price;
  const price = rawPrice == null || rawPrice === '' ? null : Number(rawPrice);
  const quantity = Number(body.quantity === undefined ? current.quantity || 0 : body.quantity);
  const lowStockThreshold = Number(body.lowStockThreshold === undefined ? current.lowStockThreshold || 0 : body.lowStockThreshold);
  if (!name || name.length > 120) return { error: 'Product name is required and must be 120 characters or fewer.' };
  if (sku.length > 40 || (sku && !/^[A-Z0-9_-]+$/.test(sku))) return { error: 'SKU may contain only letters, numbers, hyphens, or underscores.' };
  if (category.length > 80 || !unit || unit.length > 30 || description.length > 1000) {
    return { error: 'Check the category, unit, and description lengths.' };
  }
  if (price !== null && (!Number.isFinite(price) || price <= 0 || price > 10000000)) {
    return { error: 'Sale price must be greater than 0 and no more than 10,000,000 PHP.' };
  }
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_STOCK
    || !Number.isInteger(lowStockThreshold) || lowStockThreshold < 0 || lowStockThreshold > MAX_STOCK) {
    return { error: `Stock and low-stock threshold must be whole numbers from 0 to ${MAX_STOCK}.` };
  }
  return { value: { name, sku, category, unit, description, price, quantity, lowStockThreshold, active: body.active === undefined ? current.active !== false : body.active !== false } };
};

const listInventoryItems = async (req, res, next) => {
  try {
    const items = await InventoryItem.findAll({ order: [['name', 'ASC']] });
    res.json(items.map(publicInventoryItem));
  } catch (error) {
    next(error);
  }
};

const createInventoryItem = async (req, res, next) => {
  try {
    const validated = validateItem(req.body);
    if (validated.error) return res.status(400).json({ error: validated.error });
    const item = validated.value;
    const tokenRole = parseToken(getCookie(req));
    if ((tokenRole === 'STAFF' || tokenRole.startsWith('STAFF:')) && item.quantity !== 0) {
      return res.status(403).json({ error: 'New products start at zero stock. Submit a stock request for replenishment.' });
    }
    if (item.sku && await InventoryItem.findOne({ where: { sku: item.sku } })) {
      return res.status(409).json({ error: 'That SKU is already in use.' });
    }
    const record = await InventoryItem.create({ ...item, createdBy: parseToken(getCookie(req)) || 'STAFF' });
    return res.status(201).json({ item: publicInventoryItem(record) });
  } catch (error) {
    next(error);
  }
};

const updateInventoryItem = async (req, res, next) => {
  try {
    const item = await InventoryItem.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Inventory item not found.' });
    const validated = validateItem(req.body, item);
    if (validated.error) return res.status(400).json({ error: validated.error });
    const tokenRole = parseToken(getCookie(req));
    if (tokenRole === 'STAFF' || tokenRole.startsWith('STAFF:')) {
      if (req.body.quantity !== undefined && Number(req.body.quantity) !== Number(item.quantity || 0)) {
        return res.status(403).json({ error: 'Staff must submit a stock request to change on-hand quantities.' });
      }
    }
    if (validated.value.sku && validated.value.sku !== item.sku) {
      const duplicate = await InventoryItem.findOne({ where: { sku: validated.value.sku } });
      if (duplicate && String(duplicate.id) !== String(item.id)) {
        return res.status(409).json({ error: 'That SKU is already in use.' });
      }
    }
    await item.update(validated.value);
    return res.json({ item: publicInventoryItem(item) });
  } catch (error) {
    next(error);
  }
};

const deleteInventoryItem = async (req, res, next) => {
  try {
    const item = await InventoryItem.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Inventory item not found.' });
    const requests = await StockRequest.findAll({ where: { itemId: item.id } });
    if (requests.some((request) => request.status === 'requested')) {
      return res.status(409).json({ error: 'Resolve pending stock requests before deleting this item.' });
    }
    await item.destroy();
    return res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

const listStockRequests = async (req, res, next) => {
  try {
    const [requests, items] = await Promise.all([
      StockRequest.findAll({ order: [['createdAt', 'DESC']] }),
      InventoryItem.findAll(),
    ]);
    const itemMap = new Map(items.map((item) => [String(item.id), item]));
    res.json(requests.map((request) => ({
      id: request.id,
      itemId: request.itemId,
      itemName: itemMap.get(String(request.itemId))?.name || 'Removed product',
      itemSku: itemMap.get(String(request.itemId))?.sku || '',
      quantity: Number(request.quantity || 0),
      reason: request.reason || '',
      status: request.status || 'requested',
      requestedBy: request.requestedBy || '',
      createdAt: request.createdAt || null,
      reviewedAt: request.reviewedAt || null,
      reviewedBy: request.reviewedBy || null,
    })));
  } catch (error) {
    next(error);
  }
};

const createStockRequest = async (req, res, next) => {
  try {
    const itemId = String(req.body?.itemId || '').trim();
    const quantity = Number(req.body?.quantity);
    const reason = String(req.body?.reason || '').trim();
    if (!itemId || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_STOCK) {
      return res.status(400).json({ error: 'Choose a product and request a whole-number quantity greater than zero.' });
    }
    if (!reason || reason.length > 500) return res.status(400).json({ error: 'Enter a reason up to 500 characters.' });
    const item = await InventoryItem.findByPk(itemId);
    if (!item || item.active === false) return res.status(404).json({ error: 'Active inventory item not found.' });
    const role = parseToken(getCookie(req));
    const staffId = role.startsWith('STAFF:') ? role.slice('STAFF:'.length) : null;
    const request = await StockRequest.create({
      itemId,
      quantity,
      reason,
      status: 'requested',
      requestedBy: staffId || role || 'STAFF',
    });
    return res.status(201).json({
      request: {
        id: request.id,
        itemId: request.itemId,
        itemName: item.name,
        itemSku: item.sku || '',
        quantity: request.quantity,
        reason: request.reason,
        status: request.status,
        requestedBy: request.requestedBy,
        createdAt: request.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

const reviewStockRequest = async (req, res, next) => {
  try {
    const status = String(req.body?.status || '');
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Choose approved or rejected.' });
    }
    const request = await StockRequest.findByPk(req.params.id);
    if (!request) return res.status(404).json({ error: 'Stock request not found.' });
    const item = await InventoryItem.findByPk(request.itemId);
    if (!item) return res.status(404).json({ error: 'The requested inventory item no longer exists.' });
    const now = new Date();
    await firestore.runTransaction(async (transaction) => {
      const [requestSnapshot, itemSnapshot] = await Promise.all([
        transaction.get(request._ref),
        transaction.get(item._ref),
      ]);
      if (!requestSnapshot.exists || !itemSnapshot.exists) {
        const error = new Error('The stock request or product no longer exists.');
        error.status = 404;
        throw error;
      }
      const requestData = requestSnapshot.data();
      const itemData = itemSnapshot.data();
      if (requestData.status !== 'requested') {
        const error = new Error('This stock request has already been reviewed.');
        error.status = 409;
        throw error;
      }
      const currentQuantity = Number(itemData.quantity || 0);
      if (status === 'approved' && currentQuantity + Number(requestData.quantity) > MAX_STOCK) {
        const error = new Error('Approving this request would exceed the supported stock limit.');
        error.status = 400;
        throw error;
      }
      if (status === 'approved') {
        transaction.update(item._ref, { quantity: currentQuantity + Number(requestData.quantity), updatedAt: now });
      }
      transaction.update(request._ref, {
        status,
        reviewedAt: now,
        reviewedBy: 'ADMIN',
        updatedAt: now,
      });
    });
    return res.json({ success: true, status });
  } catch (error) {
    next(error);
  }
};

const getCookie = (req) => {
  const part = (req.headers.cookie || '').split(';').map((value) => value.trim())
    .find((value) => value.startsWith('admin_token='));
  return part ? decodeURIComponent(part.split('=').slice(1).join('=')) : null;
};

module.exports = {
  listInventoryItems,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  listStockRequests,
  createStockRequest,
  reviewStockRequest,
};
