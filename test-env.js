const path = require('path');
require('dotenv').config({ path: path.resolve('.env') });
const { getPayMongoKey } = require('./util/paymongo.js');
console.log('PAYMONGO_SECRET_KEY from process.env:', process.env.PAYMONGO_SECRET_KEY ? 'SET (' + process.env.PAYMONGO_SECRET_KEY.substring(0,12) + '...)' : 'NOT SET');
console.log('getPayMongoKey() returns:', getPayMongoKey() ? 'CONFIGURED' : 'EMPTY');