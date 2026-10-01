require('dotenv').config({ path: require('path').resolve('.env') });
const { admin, app, auth } = require('./config/firebase.js');
console.log('Admin initialized:', !!admin);
console.log('App:', !!app);
console.log('Auth:', !!auth);