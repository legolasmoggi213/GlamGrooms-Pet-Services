const { createToken, parseToken } = require('./util/customerAuth');

const EMAIL = 'audit@example.invalid';

// Create a token the way the server does
const token = createToken(EMAIL);
console.log('Created token successfully:', Boolean(token));

// Parse it back the way the server does
const parsed = parseToken(token);
console.log('Token parsed successfully:', parsed === EMAIL);

// Now simulate what happens when the cookie is sent through HTTP
// The server's getCookie does: part.split('=').slice(1).join('=')
const cookieHeader = 'customer_token=' + token;
const extracted = cookieHeader.split(';').map(c => c.trim()).find(c => c.startsWith('customer_token='));
const extractedToken = extracted ? decodeURIComponent(extracted.split('=').slice(1).join('=')) : null;
console.log('Cookie token preserved:', extractedToken === token);

// Now parse the extracted token
const reparsed = parseToken(extractedToken);
console.log('Cookie token parsed successfully:', reparsed === EMAIL);