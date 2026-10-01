const { createToken, parseToken } = require('./util/customerAuth');

const EMAIL = '8261006@gmail.com';

// Create a token the way the server does
const token = createToken(EMAIL);
console.log('Created token:', token);

// Parse it back the way the server does
const parsed = parseToken(token);
console.log('Parsed email:', parsed);
console.log('Match:', parsed === EMAIL);

// Now simulate what happens when the cookie is sent through HTTP
// The server's getCookie does: part.split('=').slice(1).join('=')
const cookieHeader = 'customer_token=' + token;
const extracted = cookieHeader.split(';').map(c => c.trim()).find(c => c.startsWith('customer_token='));
console.log('\nExtracted cookie part:', extracted);
const extractedToken = extracted ? decodeURIComponent(extracted.split('=').slice(1).join('=')) : null;
console.log('Extracted token:', extractedToken);
console.log('Token preserved:', extractedToken === token);

// Now parse the extracted token
const reparsed = parseToken(extractedToken);
console.log('Reparsed email:', reparsed);
console.log('Reparse match:', reparsed === EMAIL);