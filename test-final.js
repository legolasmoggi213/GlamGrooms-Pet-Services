const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const { createToken } = require('./util/customerAuth');

const EMAIL = '8261006@gmail.com';

// Generate token with the stable secret (same as server)
const token = createToken(EMAIL);
const cookie = `customer_token=${token}; customer_logged_in=1`;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost', port: 3000, path, method,
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
    };
    if (body) options.headers['Content-Length'] = Buffer.byteLength(body);
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  // Test 1: Nav status
  console.log('1. GET /customer/nav-status');
  const r1 = await request('GET', '/customer/nav-status');
  console.log('   Status:', r1.status, 'Body:', r1.body);

  // Test 2: Profile
  console.log('\n2. GET /customer/profile');
  const r2 = await request('GET', '/customer/profile');
  console.log('   Status:', r2.status, 'Body:', r2.body.slice(0, 150));

  // Test 3: Grooming booking
  console.log('\n3. POST /api/v1/bookings/grooming');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const r3 = await request('POST', '/api/v1/bookings/grooming', JSON.stringify({
    customer: { name: '8261006', email: EMAIL, phone: '09615156113', address: 'Talon Una Ulo' },
    pets: [{ name: 'Mochi', species: 'dog', breed: 'Shih Tzu', age: 3 }],
    service: 'bath',
    date: tomorrow.toISOString().slice(0, 10),
    time: '11:00',
    pickupTime: '',
    notes: '',
    paymentMethod: 'cash',
  }));
  console.log('   Status:', r3.status);
  console.log('   Body:', r3.body.slice(0, 200));

  // Test 4: Hotel booking
  console.log('\n4. POST /api/v1/bookings/hotel');
  const checkIn = new Date();
  checkIn.setDate(checkIn.getDate() + 3);
  const checkOut = new Date();
  checkOut.setDate(checkOut.getDate() + 5);
  const r4 = await request('POST', '/api/v1/bookings/hotel', JSON.stringify({
    customer: { name: '8261006', email: EMAIL, phone: '09615156113', address: 'Talon Una Ulo' },
    pets: [{ name: 'Mochi', species: 'dog', breed: 'Shih Tzu', age: 3 }],
    roomType: 'deluxe',
    checkIn: checkIn.toISOString().slice(0, 10),
    checkInTime: '14:00',
    checkOut: checkOut.toISOString().slice(0, 10),
    checkOutTime: '12:00',
    notes: '',
    paymentMethod: 'cash',
  }));
  console.log('   Status:', r4.status);
  console.log('   Body:', r4.body.slice(0, 200));
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });