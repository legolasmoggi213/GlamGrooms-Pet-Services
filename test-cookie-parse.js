// Test: does split('=').slice(1).join('=') corrupt tokens with == ?
const payload = JSON.stringify({ sub: 'audit@example.invalid', ts: 1 });
const token = `${Buffer.from(payload).toString('base64')}.${'a'.repeat(64)}`;

// Simulate getCookie parsing
const cookieLine = 'customer_token=' + token;
const parsed = cookieLine.split('=').slice(1).join('=');
console.log('Cookie token preserved:', token === parsed);

// Simulate parseToken
const parts = parsed.split('.');
console.log('Token has expected parts:', parts.length === 2);

// Decode payload
const payloadStr = Buffer.from(parts[0], 'base64').toString('utf8');

// Check if the original payload decodes to the same thing
const origParts = token.split('.');
const origPayloadStr = Buffer.from(origParts[0], 'base64').toString('utf8');
console.log('Decoded payload preserved:', payloadStr === origPayloadStr);

// But the signatures won't match because the payload b64 is different
const crypto = require('crypto');
const SECRET = 'test-secret';
const expectedSig = crypto.createHmac('sha256', SECRET).update(payloadStr).digest('hex');
console.log('Signature matches the test secret:', expectedSig === parts[1]);