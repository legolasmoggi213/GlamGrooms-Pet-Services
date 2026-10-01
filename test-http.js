const http = require('http');
const https = require('https');

const BASE = 'http://localhost:3000';
const EMAIL = '8261006@gmail.com';

// Generate a token the same way the server does
const { createToken } = require('./util/customerAuth');
const token = createToken(EMAIL);

function request(method, path, body, cookie) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        const setCookie = res.headers['set-cookie'];
        resolve({ status: res.status, body, setCookie });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  const cookie = `customer_token=${token}; customer_logged_in=1`;
  console.log('Using cookie:', cookie.slice(0, 60) + '...');

  // Test 1: Profile endpoint
  console.log('\n--- Test 1: GET /customer/profile ---');
  const r1 = await request('GET', '/customer/profile', null, cookie);
  console.log('Status:', r1.status);
  console.log('Body:', r1.body.slice(0, 300));

  // Test 2: Grooming booking
  console.log('\n--- Test 2: POST /api/v1/bookings/grooming ---');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toISOString().slice(0, 10);
  const r2 = await request('POST', '/api/v1/bookings/grooming', {
    customer: { name: '8261006', email: EMAIL, phone: '0917-000-0000', address: 'Test Address' },
    pets: [{ name: 'Mochi', species: 'dog', breed: 'Shih Tzu', age: 3 }],
    service: 'bath',
    date: dateStr,
    time: '09:00',
    pickupTime: '',
    notes: '',
    paymentMethod: 'cash',
  }, cookie);
  console.log('Status:', r2.status);
  console.log('Body:', r2.body);

  // Test 3: Hotel booking
  console.log('\n--- Test 3: POST /api/v1/bookings/hotel ---');
  const checkIn = new Date();
  checkIn.setDate(checkIn.getDate() + 2);
  const checkOut = new Date();
  checkOut.setDate(checkOut.getDate() + 4);
  const r3 = await request('POST', '/api/v1/bookings/hotel', {
    customer: { name: '8261006', email: EMAIL, phone: '0917-000-0000', address: 'Test Address' },
    pets: [{ name: 'Mochi', species: 'dog', breed: 'Shih Tzu', age: 3 }],
    roomType: 'standard',
    checkIn: checkIn.toISOString().slice(0, 10),
    checkInTime: '14:00',
    checkOut: checkOut.toISOString().slice(0, 10),
    checkOutTime: '12:00',
    notes: '',
    paymentMethod: 'cash',
  }, cookie);
  console.log('Status:', r3.status);
  console.log('Body:', r3.body);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });