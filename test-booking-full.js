require('dotenv').config({ path: require('path').resolve('.env') });
const https = require('https');
const http = require('http');
const { auth } = require('./config/firebase');
const db = require('./models');
const { createToken } = require('./util/customerAuth');

const EMAIL = '8261006@gmail.com';
const PASSWORD = 'Alpha12!';
const apiKey = 'AIzaSyChleSmcF_CablT8KfmnF9-C8Pw7jm-DNA';
const BASE = 'http://localhost:3000';

function restRequest(hostname, path, method, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...extraHeaders,
      },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        resolve({ status: res.status, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpGet(url, cookie) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: 'GET',
      headers: cookie ? { Cookie: cookie } : {},
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        resolve({ status: res.status, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function httpPost(url, body, cookie) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const options = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        cookie: cookie || '',
      },
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        resolve({ status: res.status, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  // Step 1: Sign in with Firebase REST API to get ID token
  console.log('Step 1: Firebase REST sign-in...');
  const signInResult = await restRequest(
    'identitytoolkit.googleapis.com',
    '/v1/accounts:signIn?key=' + apiKey,
    'POST',
    { email: EMAIL, password: PASSWORD, returnSecureToken: true }
  );
  console.log('  Status:', signInResult.status);
  const signInData = JSON.parse(signInResult.body);
  if (signInData.error) {
    console.log('  ERROR:', signInData.error.message);
    return;
  }
  const idToken = signInData.idToken;
  console.log('  ID token obtained (first 30 chars):', idToken.slice(0, 30) + '...');
  console.log('  email_verified:', signInData.email_verified);

  // Step 2: Create session (sets customer_token cookie)
  console.log('\nStep 2: Create session...');
  const sessionResult = await httpPost(
    BASE + '/customer/session',
    { idToken, profile: {} }
  );
  console.log('  Status:', sessionResult.status);
  console.log('  Body:', sessionResult.body);
  const setCookie = sessionResult.headers['set-cookie'];
  console.log('  Set-Cookie:', setCookie);

  if (!setCookie) {
    console.log('  FATAL: No cookie set');
    return;
  }

  // Extract the customer_token cookie value
  const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
  const tokenMatch = cookieStr.match(/customer_token=([^;]+)/);
  if (!tokenMatch) {
    console.log('  FATAL: No customer_token in Set-Cookie');
    return;
  }
  const cookieToken = tokenMatch[1];
  console.log('  Cookie token (first 30 chars):', cookieToken.slice(0, 30) + '...');

  // Step 3: Test customer profile endpoint
  console.log('\nStep 3: GET /customer/profile...');
  const profileResult = await httpGet(BASE + '/customer/profile', cookieStr);
  console.log('  Status:', profileResult.status);
  console.log('  Body:', profileResult.body.slice(0, 200));

  // Step 4: Test booking endpoint
  console.log('\nStep 4: POST /api/v1/bookings/grooming...');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toISOString().slice(0, 10);

  const bookingPayload = {
    customer: { name: 'Test Customer', email: EMAIL, phone: '0917-000-0000', address: 'Test Address' },
    pets: [{ name: 'Mochi', species: 'dog', breed: 'Shih Tzu', age: 3 }],
    service: 'bath',
    date: dateStr,
    time: '09:00',
    pickupTime: '',
    notes: '',
    paymentMethod: 'cash',
  };
  console.log('  Payload:', JSON.stringify(bookingPayload));

  const bookingResult = await httpPost(
    BASE + '/api/v1/bookings/grooming',
    bookingPayload,
    cookieStr
  );
  console.log('  Status:', bookingResult.status);
  console.log('  Body:', bookingResult.body);

  // Step 5: Also test with the api/v1 prefix path that the frontend uses
  console.log('\nStep 5: POST /api/v1/bookings/hotel...');
  const checkIn = new Date();
  checkIn.setDate(checkIn.getDate() + 1);
  const checkOut = new Date();
  checkOut.setDate(checkOut.getDate() + 3);

  const hotelPayload = {
    customer: { name: 'Test Customer', email: EMAIL, phone: '0917-000-0000', address: 'Test Address' },
    pets: [{ name: 'Mochi', species: 'dog', breed: 'Shih Tzu', age: 3 }],
    roomType: 'standard',
    checkIn: checkIn.toISOString().slice(0, 10),
    checkInTime: '14:00',
    checkOut: checkOut.toISOString().slice(0, 10),
    checkOutTime: '12:00',
    notes: '',
    paymentMethod: 'cash',
  };

  const hotelResult = await httpPost(
    BASE + '/api/v1/bookings/hotel',
    hotelPayload,
    cookieStr
  );
  console.log('  Status:', hotelResult.status);
  console.log('  Body:', hotelResult.body);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });