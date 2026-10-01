const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const { createToken, parseToken } = require('./util/customerAuth');

const EMAIL = '8261006@gmail.com';

// Generate a token with the stable secret
const token = createToken(EMAIL);
console.log('Generated token (first 50):', token.slice(0, 50) + '...');

// Verify it parses
const parsed = parseToken(token);
console.log('Parsed email:', parsed);

const cookie = `customer_token=${token}; customer_logged_in=1`;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie,
      },
    };
    if (body) {
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: data });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  // Test 1: Nav status
  console.log('\n--- GET /customer/nav-status ---');
  const r1 = await request('GET', '/customer/nav-status');
  console.log('Status:', r1.status);
  console.log('Body:', r1.body);

  // Test 2: Profile endpoint
  console.log('\n--- GET /customer/profile ---');
  const r2 = await request('GET', '/customer/profile');
  console.log('Status:', r2.status);
  console.log('Body:', r2.body.slice(0, 200));

  // Test 3: Grooming booking
  console.log('\n--- POST /api/v1/bookings/grooming ---');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toISOString().slice(0, 10);
  const r3 = await request('POST', '/api/v1/bookings/grooming', JSON.stringify({
    customer: { name: '8261006', email: EMAIL, phone: '0917-000-0000', address: 'Test Address' },
    pets: [{ name: 'Mochi', species: 'dog', breed: 'Shih Tzu', age: 3 }],
    service: 'bath',
    date: dateStr,
    time: '09:00',
    pickupTime: '',
    notes: '',
    paymentMethod: 'cash',
  }));
  console.log('Status:', r3.status);
  console.log('Body:', r3.body);

  // Test 4: Hotel booking
  console.log('\n--- POST /api/v1/bookings/hotel ---');
  const checkIn = new Date();
  checkIn.setDate(checkIn.getDate() + 2);
  const checkOut = new Date();
  checkOut.setDate(checkOut.getDate() + 4);
  const r4 = await request('POST', '/api/v1/bookings/hotel', JSON.stringify({
    customer: { name: '8261006', email: EMAIL, phone: '0917-000-0000', address: 'Test Address' },
    pets: [{ name: 'Mochi', species: 'dog', breed: 'Shih Tzu', age: 3 }],
    roomType: 'standard',
    checkIn: checkIn.toISOString().slice(0, 10),
    checkInTime: '14:00',
    checkOut: checkOut.toISOString().slice(0, 10),
    checkOutTime: '12:00',
    notes: '',
    paymentMethod: 'cash',
  }));
  console.log('Status:', r4.status);
  console.log('Body:', r4.body);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });