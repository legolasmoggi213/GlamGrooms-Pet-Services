const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const apiRouter = require('./routes');
const db = require('./models');
const { auth } = require('./config/firebase');
const { notFoundHandler, errorHandler } = require('./util/errorHandler');

const app = express();
const port = process.env.PORT || 3000;
let databaseConnected = false;

app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({
  verify: (req, res, buffer) => {
    if (req.originalUrl.split('?')[0] === '/webhooks/paymongo') req.rawBody = Buffer.from(buffer);
  },
}));
app.use(express.urlencoded({ extended: true }));

const bcrypt = require('bcryptjs');
const { createToken, parseToken } = require('./util/adminAuth');
const { createToken: createCustomerToken, parseToken: parseCustomerToken } = require('./util/customerAuth');
const { isStrongPassword } = require('./util/passwordPolicy');
const { releaseGroomingBookingSlots, hotelLockIdsForTypes, releaseBookingSlotsByIds } = require('./util/bookingLocks');
const { groomingRecordDuration } = require('./util/bookingCalculations');
const ADMIN_USERNAME = 'ADMIN';
const safeReturnPath = (value, fallback) => {
  const target = String(value || '');
  return target.startsWith('/') && !target.startsWith('//') ? target : fallback;
};

app.post('/customer/session', async (req, res) => {
  try {
    const { idToken, profile = {} } = req.body || {};
    
    if (!idToken) {
      return res.status(400).json({ error: 'Missing ID token' });
    }
    
    console.log('Attempting to verify Firebase ID token...');
    const decoded = await auth.verifyIdToken(idToken);
    console.log('Token verified successfully for:', decoded.email);
    
    const email = decoded.email;
    if (!email) return res.status(400).json({ error: 'Firebase account has no email address' });
    if (!decoded.email_verified) {
      return res.status(403).json({ error: 'Please verify your email before signing in' });
    }

    let customer = await db.Customer.findOne({ where: { email } });
    if (!customer) {
      customer = await db.Customer.create({
        name: String(profile.name || email.split('@')[0]).trim(),
        email,
        phone: profile.phone || null,
        address: profile.address || null,
        uid: decoded.uid,
      });
    } else if (!customer.uid) {
      await customer.update({ uid: decoded.uid });
    }

    res.cookie('customer_token', createCustomerToken(email), { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    res.cookie('customer_logged_in', '1', { path: '/', httpOnly: false, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    return res.json({ success: true });
  } catch (error) {
    console.error('Session creation error:', error);
    return res.status(401).json({ error: 'Invalid Firebase authentication token' });
  }
});

app.post('/customer/register-profile', async (req, res) => {
  try {
    const { idToken, profile = {} } = req.body || {};
    if (!idToken) return res.status(400).json({ error: 'Missing ID token' });

    const decoded = await auth.verifyIdToken(idToken);
    const email = String(decoded.email || '').trim().toLowerCase();
    const profileEmail = String(profile.email || '').trim().toLowerCase();
    const name = String(profile.name || '').trim();
    const phone = String(profile.phone || '').trim();
    const address = String(profile.address || '').trim();
    if (!email || email !== profileEmail) return res.status(403).json({ error: 'Registration email does not match the Firebase account' });
    if (!name || !phone || !address) return res.status(400).json({ error: 'Name, phone, and address are required' });

    let customer = await db.Customer.findOne({ where: { email } });
    const customerProfile = { name, email, phone, address, uid: decoded.uid };
    if (customer) await customer.update(customerProfile);
    else customer = await db.Customer.create(customerProfile);

    return res.status(201).json({ success: true, customer: { id: customer.id, name, email, phone, address } });
  } catch (error) {
    console.error('Registration profile save error:', error);
    return res.status(401).json({ error: 'Unable to verify registration account' });
  }
});

// Customer registration and login are handled by Firebase in customer-auth.js.
// These endpoints remain only to give non-JavaScript clients a deterministic
// response instead of silently creating a second local identity system.
app.post('/customer/register', async (req, res) => {
  return res.status(410).json({ error: 'Customer registration is handled by Firebase Authentication.' });
});

app.post('/customer/login', async (req, res) => {
  return res.status(410).json({ error: 'Customer sign-in is handled by Firebase Authentication.' });
});

app.get('/customer/logout', (req, res) => {
  res.clearCookie('customer_token', { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  res.clearCookie('customer_logged_in', { path: '/', httpOnly: false, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  res.redirect('/');
});

app.post('/customer/delete-account', async (req, res) => {
  try {
    const raw = req.headers.cookie || '';
    const getCookie = (name) => {
      const m = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
      if (!m) return null;
      return decodeURIComponent(m.split('=').slice(1).join('='));
    };
    const token = getCookie('customer_token');
    const email = parseCustomerToken(token);
    if (!email) return res.status(401).json({ error: 'Not authenticated' });

    const customer = await db.Customer.findOne({ where: { email } });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const [groomingBookings, hotelBookings] = await Promise.all([
      db.GroomingAppointment.findAll({ where: { customerId: customer.id } }),
      db.HotelReservation.findAll({ where: { customerId: customer.id } }),
    ]);
    let firebaseUser = null;
    try {
      firebaseUser = customer.uid
        ? { uid: customer.uid }
        : await auth.getUserByEmail(customer.email);
    } catch (authError) {
      if (authError.code !== 'auth/user-not-found') throw authError;
    }
    if (firebaseUser) {
      try {
        await auth.deleteUser(firebaseUser.uid);
      } catch (authError) {
        if (authError.code !== 'auth/user-not-found') throw authError;
      }
    }

    const bookingIds = [...groomingBookings, ...hotelBookings].map((booking) => booking.id);
    await Promise.all(bookingIds.map((bookingId) => db.CashTransaction.destroy({ where: { bookingId } })));
    await db.GroomingAppointment.destroy({ where: { customerId: customer.id } });
    await db.HotelReservation.destroy({ where: { customerId: customer.id } });
    await db.Pet.destroy({ where: { customerId: customer.id } });
    await customer.destroy();

    // Keep capacity locked until the associated records have been removed.
    await Promise.all([
      ...groomingBookings.map((booking) => releaseGroomingBookingSlots(booking.date, booking.time, groomingRecordDuration(booking))),
      ...hotelBookings.map((booking) => releaseBookingSlotsByIds(hotelLockIdsForTypes(
        booking.roomTypes || booking.petRooms?.map((petRoom) => petRoom.roomType) || [booking.roomType],
        booking.checkIn,
        booking.checkOut,
      ))),
    ]);

    res.clearCookie('customer_token', { path: '/' });
    res.clearCookie('customer_logged_in', { path: '/' });
    return res.json({ success: true, message: 'Account deleted successfully' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Failed to delete account' });
  }
});

// Protect customer pages that require login.
  app.use('/customer', (req, res, next) => {
    const allowed = ['/login', '/login.html', '/register', '/register.html', '/logout', '/nav-status'];
    if (allowed.includes(req.path)) return next();

  const raw = req.headers.cookie || '';
  const getCookie = (name) => {
    const m = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
    if (!m) return null;
    return decodeURIComponent(m.split('=').slice(1).join('='));
  };
  const token = getCookie('customer_token');
  const email = parseCustomerToken(token);
  if (!email) {
    const returnTo = encodeURIComponent(req.originalUrl || '/customer/account.html');
    return res.redirect(`/customer/login.html?return=${returnTo}`);
  }
  next();
}, express.static(path.join(__dirname, 'public', 'customer')));

// Lightweight nav-status check: is the customer authenticated?
  app.get('/customer/nav-status', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    const raw = req.headers.cookie || '';
    const getCookie = (name) => {
      const m = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
      if (!m) return null;
      return decodeURIComponent(m.split('=').slice(1).join('='));
    };
    const token = getCookie('customer_token');
    const email = parseCustomerToken(token);
    return res.json({ authenticated: !!email });
  });

  // Customer profile endpoint: reads cookie and returns customer + pets + bookings
  app.get('/customer/profile', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    try {
    const raw = req.headers.cookie || '';
    const getCookie = (name) => {
      const m = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
      if (!m) return null;
      return decodeURIComponent(m.split('=').slice(1).join('='));
    };
    const token = getCookie('customer_token');
    const email = parseCustomerToken(token);
    if (!email) return res.status(401).json({ error: 'Not authenticated' });
    const customer = await db.Customer.findOne({ where: { email } });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    const [pets, grooming, hotel] = await Promise.all([
      db.Pet.findAll({ where: { customerId: customer.id } }),
      db.GroomingAppointment.findAll({ where: { customerId: customer.id }, order: [['date', 'DESC']] }),
      db.HotelReservation.findAll({ where: { customerId: customer.id }, order: [['checkIn', 'DESC']] }),
    ]);
    const attachPet = async (booking) => {
      if (booking.petId) booking.Pet = await db.Pet.findByPk(booking.petId);
      return booking;
    };
    const isCompletedOrCash = (b) => !(b.paymentMethod === 'qrph' && b.paymentStatus === 'pending');
    const validGrooming = grooming.filter(isCompletedOrCash);
    const validHotel = hotel.filter(isCompletedOrCash);
    res.json({ customer, pets, grooming: await Promise.all(validGrooming.map(attachPet)), hotel: await Promise.all(validHotel.map(attachPet)) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/customer/profile', async (req, res) => {
  try {
    const raw = req.headers.cookie || '';
    const getCookie = (name) => {
      const m = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
      if (!m) return null;
      return decodeURIComponent(m.split('=').slice(1).join('='));
    };
    const email = parseCustomerToken(getCookie('customer_token'));
    if (!email) return res.status(401).json({ error: 'Not authenticated' });

    const customer = await db.Customer.findOne({ where: { email } });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const { name, phone, address } = req.body || {};
    const cleanName = String(name || '').trim();
    if (!cleanName) return res.status(400).json({ error: 'Name is required' });

    await customer.update({
      name: cleanName,
      phone: phone && String(phone).trim() ? String(phone).trim() : null,
      address: address && String(address).trim() ? String(address).trim() : null,
    });
    return res.json({ customer });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

const findAdminAccount = async () => {
  if (!db.Admin) return null;
  try {
    let admin = await db.Admin.findOne({ where: { username: ADMIN_USERNAME } });
    if (!admin) {
      const admins = await db.Admin.findAll();
      if (admins.length === 1) {
        admin = admins[0];
        await admin.update({ username: ADMIN_USERNAME });
      }
    }
    return admin;
  } catch (error) {
    console.warn('Admin account lookup unavailable; using environment-based admin credentials only.', error.message || error);
    return null;
  }
};

const getAdminFromRequest = async (req) => {
  const raw = req.headers.cookie || '';
  const tokenCookie = raw.split(';').map((part) => part.trim()).find((part) => part.startsWith('admin_token='));
  const username = parseToken(tokenCookie ? decodeURIComponent(tokenCookie.split('=').slice(1).join('=')) : null);
  if (username !== ADMIN_USERNAME) return null;
  return findAdminAccount();
};

// Admin login handler (placed before admin protection)
app.post('/admin/login', (req, res) => {
  (async () => {
    const rawPassword = String(req.body && req.body.password || '');
    const normalizedPassword = rawPassword.replace(/\s+/g, '');
    const username = String(req.body && req.body.username || '').trim().toUpperCase();
    if (username !== ADMIN_USERNAME || !normalizedPassword) return res.redirect('/admin/login.html?error=1');
    try {
      const admin = await findAdminAccount();
      const envPass = process.env.ADMIN_PASS ? String(process.env.ADMIN_PASS).replace(/\s+/g, '') : '';
      const dbMatch = admin && admin.passwordHash && bcrypt.compareSync(normalizedPassword, admin.passwordHash);
      const envMatch = Boolean(envPass && normalizedPassword === envPass);

      if (dbMatch || envMatch) {
        const token = createToken(ADMIN_USERNAME);
        res.cookie('admin_token', token, { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
        return res.redirect('/admin/index.html');
      }
    } catch (e) {
      console.error(e);
    }
    return res.redirect('/admin/login.html?error=1');
  })();
});

app.get('/admin/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.redirect('/');
});

app.get('/admin/nav-status', (req, res) => {
  const raw = req.headers.cookie || '';
  const cookie = raw.split(';').map((part) => part.trim()).find((part) => part.startsWith('admin_token='));
  const token = cookie ? decodeURIComponent(cookie.split('=').slice(1).join('=')) : null;
  res.json({ authenticated: parseToken(token) === ADMIN_USERNAME });
});

app.post('/admin/change-password', (req, res) => {
  (async () => {
    const admin = await getAdminFromRequest(req);
    if (!admin) return res.redirect('/admin/login.html');

    const { currentPassword, newPassword, confirmPassword } = req.body || {};
    if (!currentPassword || !bcrypt.compareSync(currentPassword, admin.passwordHash)) {
      return res.redirect('/admin/change-password.html?passwordError=current');
    }
    if (!isStrongPassword(newPassword) || newPassword !== confirmPassword) {
      return res.redirect('/admin/change-password.html?passwordError=invalid');
    }

    await admin.update({ passwordHash: bcrypt.hashSync(newPassword, 10) });
    return res.redirect('/admin/change-password.html?passwordChanged=1');
  })().catch((error) => {
    console.error(error);
    return res.redirect('/admin/change-password.html?passwordError=server');
  });
});

// Admin registration is disabled. The admin password is configured via the
// ADMIN_PASS environment variable or changed on first login.
// Require visitors to accept the privacy terms before serving site pages.
app.use((req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method)) return next();
  if (req.path.startsWith('/api/')) return next();
  if (req.path.startsWith('/admin/')) return next();
  if (req.path === '/privacy.html' || req.path === '/favicon.ico'
    || req.path.startsWith('/css/') || req.path.startsWith('/js/') || req.path.startsWith('/assets/')) {
    return next();
  }

  const consent = (req.headers.cookie || '').split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('site_privacy_consent='));
  if (consent && decodeURIComponent(consent.split('=').slice(1).join('=')) === 'accepted') return next();

  const returnTo = encodeURIComponent(req.originalUrl || '/');
  return res.redirect(`/privacy.html?return=${returnTo}`);
});

// Protect admin static files. Allow login and registration pages to pass through.
app.use('/admin', (req, res, next) => {
  if (req.path === '/login' || req.path === '/login.html' || req.path === '/register' || req.path === '/register.html') {
    return next();
  }
  const raw = req.headers.cookie || '';
  const getCookie = (name) => {
    const m = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
    if (!m) return null;
    return decodeURIComponent(m.split('=').slice(1).join('='));
  };
  const token = getCookie('admin_token');
  const user = parseToken(token);
  if (user !== ADMIN_USERNAME) return res.redirect('/admin/login.html');
  next();
}, express.static(path.join(__dirname, 'public', 'admin')));

// Serve the frontend (public site) as static files.
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/v1', apiRouter);

app.all('/api/cron/reminders', async (req, res) => {
  try {
    const { sendReminders } = require('./util/reminders');
    const result = await sendReminders();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Manual reminder cron failed:', error);
    res.status(500).json({ success: false, error: 'Reminder cron failed' });
  }
});

// PayMongo webhook — no auth, PayMongo signs the request
const { handlePayMongoWebhook } = require('./util/paymongoWebhook');
app.post('/webhooks/paymongo', handlePayMongoWebhook);

app.get('/api/health', (req, res) => {
  res.status(databaseConnected ? 200 : 503).json({
    status: databaseConnected ? 'ok' : 'degraded',
    database: databaseConnected ? 'connected' : 'unavailable',
    message: databaseConnected ? 'PawStay backend is running' : 'Website is running, but Firestore is unavailable',
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

const startServer = async () => {
  app.listen(port, () => {
    console.log(`App connected to port ${port}`);
  });

  try {
    await db.Customer.count();
    databaseConnected = true;
    console.log('Firebase Firestore connected successfully.');
    require('./util/reminders').startReminderScheduler();
  } catch (error) {
    console.error('Firestore unavailable; starting website in degraded mode:', error.message);
  }
};

if (require.main === module) {
  startServer();
}

module.exports = app;

