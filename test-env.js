const path = require('path');
require('dotenv').config({ path: path.resolve('.env') });
const { getPayMongoKey } = require('./util/paymongo.js');
console.log('PAYMONGO_SECRET_KEY configured:', Boolean(process.env.PAYMONGO_SECRET_KEY));
console.log('getPayMongoKey() returns:', getPayMongoKey() ? 'CONFIGURED' : 'EMPTY');