const http = require('http');
const https = require('https');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const { auth } = require('./config/firebase');
const { createToken } = require('./util/customerAuth');

const EMAIL = process.env.TEST_CUSTOMER_EMAIL;
const PASSWORD = process.env.TEST_CUSTOMER_PASSWORD;
const apiKey = process.env.FIREBASE_WEB_API_KEY;
const BASE = 'http://localhost:3000';

function httpsPost(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ status: res.status, body }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpReq(method, path, body, cookie) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost', port: 3000, path, method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (cookie) options.headers['Cookie'] = cookie;
    if (body) {
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  if (process.env.ALLOW_MUTATING_E2E !== 'true') {
    throw new Error('Refusing to create bookings. Set ALLOW_MUTATING_E2E=true only for an isolated test environment.');
  }
  if (!EMAIL || !PASSWORD || !apiKey) {
    throw new Error('Set TEST_CUSTOMER_EMAIL, TEST_CUSTOMER_PASSWORD, and FIREBASE_WEB_API_KEY for the isolated test account.');
  }

  // Step 1: Firebase sign-in to get ID token
  console.log('Step 1: Firebase REST sign-in...');
  const r1 = await httpsPost('identitytoolkit.googleapis.com',
    '/v1/accounts:signIn?key=' + apiKey,
    { email: EMAIL, password: PASSWORD, returnSecureToken: true });
  const data = JSON.parse(r1.body);
  if (data.error) { console.log('ERROR:', data.error.message); return; }
  const idToken = data.idToken;
  console.log('  Firebase sign-in succeeded; email verified:', data.email_verified);

  // Step 2: Create session (this is what customer-auth.js does)
  console.log('\nStep 2: POST /customer/session...');
  const r2 = await httpReq('POST', '/customer/session',
    JSON.stringify({ idToken, profile: {} }));
  console.log('  Status:', r2.status);
  console.log('  Body:', r2.body);
  const setCookie = r2.headers['set-cookie'];

  if (!setCookie) { console.log('FATAL: No cookie'); return; }

  // Extract customer_token
  const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
  const tokenMatch = cookieStr.match(/customer_token=([^;]+)/);
  if (!tokenMatch) { console.log('FATAL: No customer_token'); return; }
  const cookieToken = tokenMatch[1];
  console.log('  Customer session cookie obtained.');

  // Step 3: Check nav-status
  console.log('\nStep 3: GET /customer/nav-status...');
  const r3 = await httpReq('GET', '/customer/nav-status', null, cookieStr);
  console.log('  Status:', r3.status);
  console.log('  Body:', r3.body);

  // Step 4: Try the booking
  console.log('\nStep 4: POST /api/v1/bookings/grooming...');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const r4 = await httpReq('POST', '/api/v1/bookings/grooming', JSON.stringify({
    customer: { name: '8261006', email: EMAIL, phone: '09615156113', address: 'Talon Una Ulo' },
    pets: [{ name: 'TestPet', species: 'dog', breed: 'mix', age: 2 }],
    service: 'bath',
    date: tomorrow.toISOString().slice(0, 10),
    time: '10:00',
    pickupTime: '',
    notes: '',
    paymentMethod: 'cash',
  }), cookieStr);
  console.log('  Status:', r4.status);
  console.log('  Body:', r4.body.slice(0, 300));
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });