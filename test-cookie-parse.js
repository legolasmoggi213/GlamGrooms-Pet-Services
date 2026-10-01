// Test: does split('=').slice(1).join('=') corrupt tokens with == ?
const token = 'eyJzdWIiOiI4MjYxMDA2QGdtYWlsLmNvbSIsInRzIjoxNzg5OTI0NjA5OTY3fQ==.ca7752792b48aea13763d6d19d49466b66a90a5cc0e1b3af9aec9cdc3cc2c849';

// Simulate getCookie parsing
const cookieLine = 'customer_token=' + token;
const parsed = cookieLine.split('=').slice(1).join('=');
console.log('Original token:', token);
console.log('Parsed token: ', parsed);
console.log('Match:', token === parsed);

// Simulate parseToken
const parts = parsed.split('.');
console.log('\nParts count:', parts.length);
console.log('Part 0 (payload b64):', parts[0]);
console.log('Part 1 (sig):', parts[1]);

// Decode payload
const payloadStr = Buffer.from(parts[0], 'base64').toString('utf8');
console.log('Decoded payload:', payloadStr);

// Check if the original payload decodes to the same thing
const origParts = token.split('.');
const origPayloadStr = Buffer.from(origParts[0], 'base64').toString('utf8');
console.log('Original decoded payload:', origPayloadStr);
console.log('Payloads match:', payloadStr === origPayloadStr);

// But the signatures won't match because the payload b64 is different
const crypto = require('crypto');
const SECRET = 'test-secret';
const expectedSig = crypto.createHmac('sha256', SECRET).update(payloadStr).digest('hex');
console.log('\nExpected sig (from corrupted payload):', expectedSig);
console.log('Actual sig (from token):', parts[1]);
console.log('Sigs match:', expectedSig === parts[1]);