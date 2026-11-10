const assert = require('node:assert/strict');
const models = require('./models');
const adminController = require('./controllers/adminController');

const now = new Date();
const grooming = [
  { id: 'g-pos', status: 'completed', paymentStatus: 'paid', paymentMethod: 'cash', price: 50, service: 'grooming-basic-m', checkedOutAt: now, updatedAt: now },
  { id: 'g-counter', status: 'completed', paymentStatus: 'paid', paymentMethod: 'cash', price: 125, service: 'grooming-full-m', checkedOutAt: now, updatedAt: now },
  { id: 'g-online', status: 'completed', paymentStatus: 'paid', paymentMethod: 'qrph', price: 300, service: 'grooming-basic-s', checkedOutAt: now, updatedAt: now },
  { id: 'g-unpaid', status: 'completed', paymentStatus: 'unpaid', paymentMethod: 'cash', price: 700, service: 'grooming-basic-s', checkedOutAt: now, updatedAt: now },
];
const hotel = [
  { id: 'h-pos', status: 'checked-out', paymentStatus: 'paid', paymentMethod: 'cash', totalPrice: 75, roomType: 'staycation-standard', checkedOutAt: now, updatedAt: now },
  { id: 'h-counter', status: 'checked-out', paymentStatus: 'paid', paymentMethod: 'cash', totalPrice: 200, roomType: 'staycation-deluxe', checkedOutAt: now, updatedAt: now },
  { id: 'h-online', status: 'checked-out', paymentStatus: 'paid', paymentMethod: 'qrph', totalPrice: 500, roomType: 'staycation-standard', checkedOutAt: now, updatedAt: now },
];
const cashTransactions = [
  {
    id: 'pos-sale', type: 'walk-in', paymentStatus: 'paid', paymentMethod: 'cash', amount: 125, paidAt: now,
    bookingReferences: [{ type: 'grooming', id: 'g-pos' }, { type: 'hotel', id: 'h-pos' }],
  },
  { id: 'product-sale', type: 'walk-in', paymentStatus: 'paid', paymentMethod: 'cash', amount: 35, paidAt: now, items: [] },
];

const matches = (records, where = {}) => records.filter((record) => Object.entries(where).every(([field, expected]) => (
  Array.isArray(expected) ? expected.includes(record[field]) : record[field] === expected
)));
models.Customer.count = async () => 1;
models.Customer.findAll = async () => [];
models.Pet.count = async () => 1;
models.Pet.findAll = async () => [];
models.GroomingAppointment.count = async () => 0;
models.GroomingAppointment.findAll = async ({ where } = {}) => matches(grooming, where);
models.HotelReservation.count = async () => 0;
models.HotelReservation.findAll = async ({ where } = {}) => matches(hotel, where);
models.CashTransaction.findAll = async ({ where } = {}) => matches(cashTransactions, where);

const invoke = async (handler, query = {}) => {
  let body;
  let status = 200;
  await handler(
    { query },
    {
      status(code) { status = code; return this; },
      json(value) { body = value; return this; },
    },
    (error) => { throw error; },
  );
  assert.equal(status, 200);
  return body;
};

(async () => {
  const stats = await invoke(adminController.getStats);
  assert.equal(stats.walkInRevenue, 485);

  const revenue = await invoke(adminController.getRevenueAnalytics, { period: 'daily' });
  assert.equal(revenue.totals.walkIn, 485);
  assert.equal(revenue.totals.combined, stats.totalRevenue);

  const sales = await invoke(adminController.getWalkInSalesAnalytics, { period: 'daily' });
  assert.equal(sales.allTimeSales, 485);

  const breakdown = await invoke(adminController.getRevenueBreakdown);
  assert.equal(breakdown.overTheCounter.reduce((sum, item) => sum + item.revenue, 0), 485);

  const report = await invoke(adminController.getOperationalReport, { type: 'walkin' });
  assert.equal(report.rows.length, 4);
  assert.equal(report.rows.reduce((sum, row) => sum + Number(row[6]), 0), 485);
  console.log('Walk-in revenue checks passed across admin/staff dashboards, analytics, breakdown, and report.');
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
