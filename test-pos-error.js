const assert = require('node:assert/strict');
const models = require('./models');
const adminController = require('./controllers/adminController');

(async () => {
  models.Customer.findOne = async () => ({ id: 'cust-1', name: 'Alice', phone: '09123456789' });
  models.Pet.findAll = async () => [];
  models.Pet.create = async (data) => ({ id: 'pet-1', ...data });

  const req = {
    body: {
      type: 'walk-in',
      customerName: 'Alice',
      contact: '09123456789',
      paymentMethod: 'cash',
      tenderedAmount: 1000,
      petName: 'Milo',
      petSpecies: 'dog',
      items: [{
        name: 'Full Grooming',
        quantity: 1,
        unitPrice: 1000,
        category: 'Grooming',
        kind: 'grooming',
        catalogId: 'grooming-basic-s',
      }],
    },
  };

  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return payload;
    },
  };

  let nextErr = null;
  const next = (err) => {
    nextErr = err;
  };

  await adminController.createCashTransaction(req, res, next);

  assert.equal(res.statusCode, 400, `Expected a 400 status, got ${res.statusCode}`);
  assert.ok(res.payload && res.payload.error, 'Expected an error payload');
  assert.match(String(res.payload.error), /appointment or hotel dates|service is no longer available/i, 'Expected the validation error to be returned to the client');
  assert.equal(nextErr, null, 'Expected validation errors to be answered directly instead of forwarded to the generic error handler');
  console.log('POS validation error regression test passed');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
