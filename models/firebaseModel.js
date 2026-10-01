const { firestore } = require('../config/firebase');

const toPlain = (value) => {
  if (value && typeof value.toDate === 'function') return value.toDate();
  if (Array.isArray(value)) return value.map(toPlain);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toPlain(item)]));
  }
  return value;
};

const matches = (record, field, expected) => {
  if (Array.isArray(expected)) return expected.includes(record[field]);
  if (expected && typeof expected === 'object' && !expected.toDate) {
    return Object.entries(expected).every(([operator, value]) => {
      if (operator === 'in') return value.includes(record[field]);
      if (operator === 'ne') return record[field] !== value;
      const actual = record[field];
      return operator === 'lte' ? actual <= value : operator === 'lt' ? actual < value
        : operator === 'gte' ? actual >= value : operator === 'gt' ? actual > value : actual === value;
    });
  }
  return record[field] === expected;
};

class FirebaseRecord {
  constructor(model, data, ref) {
    Object.assign(this, data);
    this._model = model;
    this._ref = ref;
  }

  async update(values) {
    const updated = { ...values, updatedAt: new Date() };
    await this._ref.update(updated);
    Object.assign(this, updated);
    return this;
  }

  async destroy() { await this._ref.delete(); }
  get(field) { return this[field]; }
}

class FirebaseModel {
  constructor(collection) { this.collection = collection; }

  async _all(options = {}) {
    let query = firestore.collection(this.collection);
    const filters = Object.entries(options.where || {});
    const order = options.order || [];

    // Firestore automatically indexes a single field. Use that index for the
    // common one-field lookups without imposing composite-index requirements
    // on deployments that previously relied on the in-memory compatibility
    // layer. More complex predicates retain the compatibility fallback below.
    const canQueryFilter = filters.length === 1 && !order.length;
    const canQueryOrder = !filters.length && order.length === 1;
    if (canQueryFilter) {
      const [field, expected] = filters[0];
      if (Array.isArray(expected) && expected.length <= 10) query = query.where(field, 'in', expected);
      else if (!expected || typeof expected !== 'object' || expected.toDate) query = query.where(field, '==', expected);
      else query = null;
    } else if (canQueryOrder) {
      const [field, direction] = order[0];
      query = query.orderBy(field, String(direction).toLowerCase() === 'desc' ? 'desc' : 'asc');
    } else {
      query = null;
    }

    if (query && options.limit) query = query.limit(options.limit);
    const snapshot = query ? await query.get() : await firestore.collection(this.collection).get();
    return snapshot.docs.map((doc) => new FirebaseRecord(this, toPlain({ id: doc.id, ...doc.data() }), doc.ref));
  }

  async findAll(options = {}) {
    let records = await this._all(options);
    if (options.where) records = records.filter((record) => Object.entries(options.where).every(([field, expected]) => matches(record, field, expected)));
    if (options.order) {
      for (const [field, direction] of [...options.order].reverse()) {
        records.sort((a, b) => ((a[field] || 0) > (b[field] || 0) ? 1 : (a[field] || 0) < (b[field] || 0) ? -1 : 0) * (direction === 'DESC' ? -1 : 1));
      }
    }
    return options.limit ? records.slice(0, options.limit) : records;
  }

  async findByPk(id) {
    const ref = firestore.collection(this.collection).doc(String(id));
    const snapshot = await ref.get();
    return snapshot.exists ? new FirebaseRecord(this, toPlain({ id: snapshot.id, ...snapshot.data() }), ref) : null;
  }

  async findOne(options = {}) { return (await this.findAll(options))[0] || null; }

  async create(values) {
    const ref = firestore.collection(this.collection).doc();
    const now = new Date();
    const record = { ...values, createdAt: values.createdAt || now, updatedAt: now };
    await ref.set(record);
    return new FirebaseRecord(this, { id: ref.id, ...toPlain(record) }, ref);
  }

  async count(options = {}) { return (await this.findAll(options)).length; }
  async sum(field, options = {}) { return (await this.findAll(options)).reduce((total, record) => total + Number(record[field] || 0), 0); }
  async destroy(options = {}) { const records = await this.findAll(options); await Promise.all(records.map((record) => record.destroy())); return records.length; }
}

module.exports = { FirebaseModel };
