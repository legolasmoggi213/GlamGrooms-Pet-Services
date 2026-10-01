require('dotenv').config({ path: require('path').resolve('.env') });
const db = require('./models');
const { createToken } = require('./util/customerAuth');

const EMAIL = '8261006@gmail.com';

async function main() {
  // Find or create customer
  let customer = await db.Customer.findOne({ where: { email: EMAIL } });
  if (!customer) {
    customer = await db.Customer.create({
      name: 'Test Customer',
      email: EMAIL,
      uid: 'test-uid',
    });
    console.log('Created customer:', customer.id);
  } else {
    console.log('Found customer:', customer.id, 'name:', customer.name);
  }

  // Create the cookie token
  const token = createToken(EMAIL);
  console.log('\nCookie token:');
  console.log(token);
  console.log('\nUse this in curl:');
  console.log(`curl -X POST http://localhost:3000/api/v1/bookings/grooming \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -H "Cookie: customer_token=${token}" \\`);
  console.log(`  -d '{"customer":{"name":"Test Customer","email":"'"$EMAIL"'","phone":"0917-000-0000","address":"Test Address"},"pets":[{"name":"Mochi","species":"dog","breed":"Shih Tzu","age":3}],"service":"bath","date":"2026-09-22","time":"09:00","pickupTime":"","notes":"","paymentMethod":"cash"}'`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });