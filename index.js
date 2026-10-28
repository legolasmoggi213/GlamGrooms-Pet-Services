const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const apiRouter = require('./routes');
const db = require('./models');
const { auth } = require('./config/firebase');
const { notFoundHandler, errorHandler } = require('./util/errorHandler');
const { isOptionalPhoneNumber } = require('./util/numericValidation');

const app = express();
const port = process.env.PORT || 3000;
let databaseConnected = false;

app.use((req, res, next) => {
  if (String(req.hostname || '').toLowerCase() === 'glamgrooms.net') {
    return res.redirect(308, `https://www.glamgrooms.net${req.originalUrl}`);
  }
  next();
});

app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({
  verify: (req, res, buffer) => {
    if (req.originalUrl.split('?')[0] === '/webhooks/paymongo') req.rawBody = Buffer.from(buffer);
  },
}));
app.use(express.urlencoded({ extended: true }));

const bcrypt = require('bcryptjs');
const { createToken, parseToken, isStaffRole, isActiveStaffRole } = require('./util/adminAuth');
const { createToken: createCustomerToken, parseToken: parseCustomerToken } = require('./util/customerAuth');
const { isStrongPassword } = require('./util/passwordPolicy');
const { isValidMobileNumber } = require('./util/mobileNumber');
const {
  createVerificationChallenge,
  verifyChallenge,
  verifyChallengeById,
  VerificationError,
} = require('./util/emailVerification');
const {
  groomingLockIds,
  hotelLockIdsForTypes,
  hotelLockIdsForSlots,
  hotelLockIdsForAssignments,
  releaseBookingSlotsByIds,
} = require('./util/bookingLocks');
const ADMIN_USERNAME = 'ADMIN';
const safeReturnPath = (value, fallback) => {
  const target = String(value || '');
  return target.startsWith('/') && !target.startsWith('//') ? target : fallback;
};
const customerFromRequest = async (req) => {
  const raw = req.headers.cookie || '';
  const cookie = raw.split(';').map((part) => part.trim()).find((part) => part.startsWith('customer_token='));
  const token = cookie ? decodeURIComponent(cookie.split('=').slice(1).join('=')) : null;
  const email = parseCustomerToken(token);
  return email ? db.Customer.findOne({ where: { email } }) : null;
};
const validatePetProfile = (body = {}) => {
  const name = String(body.name || '').trim();
  const species = String(body.species || '').trim().toLowerCase();
  const breed = String(body.breed || '').trim();
  const age = Number(body.age);
  if (!name || name.length > 80 || !['dog', 'cat'].includes(species)
    || !breed || breed.length > 100 || !Number.isInteger(age) || age < 0 || age > 100) {
    return { error: 'Enter a pet name, dog or cat species, breed, and a whole-number age from 0 to 100.' };
  }
  return {
    value: {
      name,
      species,
      breed,
      age,
      size: String(body.size || '').trim().slice(0, 40) || null,
      notes: String(body.notes || '').trim().slice(0, 1000) || null,
    },
  };
};

app.post('/customer/login/send-code', async (req, res) => {
  try {
    const { idToken } = req.body || {};
    if (!idToken) return res.status(400).json({ error: 'Sign in with your email and password first.' });
    let decoded;
    try {
      decoded = await auth.verifyIdToken(idToken);
    } catch (error) {
      return res.status(401).json({ error: 'Your sign-in expired. Enter your email and password again.' });
    }
    const email = String(decoded.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@gmail\.com$/.test(email)) {
      return res.status(400).json({ error: 'Sign-in verification is available for Gmail accounts only.' });
    }
    const customer = await db.Customer.findOne({ where: { email } });
    if (!customer) return res.status(403).json({ error: 'No customer profile is registered for this Gmail address.' });

    const { challengeId } = await createVerificationChallenge({ email, purpose: 'customer' });
    return res.json({ success: true, challengeId, email: email.replace(/^(.).+(@.*)$/, '$1••••$2') });
  } catch (error) {
    if (error instanceof VerificationError) return res.status(error.status).json({ error: error.message });
    console.error('Customer sign-in verification email failed:', error);
    return res.status(503).json({ error: 'Could not send the verification code. Please try again later.' });
  }
});

app.post('/customer/password/change/send-code', async (req, res) => {
  try {
    const customer = await customerFromRequest(req);
    if (!customer) return res.status(401).json({ error: 'Please sign in again to change your password.' });

    const email = String(customer.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@gmail\.com$/.test(email)) {
      return res.status(400).json({ error: 'Password verification is available for Gmail accounts only.' });
    }

    const { challengeId } = await createVerificationChallenge({
      email,
      purpose: 'customer-password-change',
    });
    return res.json({
      success: true,
      challengeId,
      email: email.replace(/^(.).+(@.*)$/, '$1••••$2'),
    });
  } catch (error) {
    if (error instanceof VerificationError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Customer password-change verification email failed:', error);
    return res.status(503).json({ error: 'Could not send the verification code. Please try again later.' });
  }
});

app.post('/customer/password/change', async (req, res) => {
  try {
    const customer = await customerFromRequest(req);
    if (!customer) return res.status(401).json({ error: 'Please sign in again to change your password.' });

    const { challengeId, verificationCode, newPassword, confirmPassword } = req.body || {};
    if (!challengeId || !verificationCode) {
      return res.status(400).json({ error: 'Request and enter the email verification code first.' });
    }
    if (typeof newPassword !== 'string' || newPassword.length > 24
      || !isStrongPassword(newPassword)) {
      return res.status(400).json({
        error: 'Password must be 8–24 characters and include uppercase and lowercase letters, a number, and a special character.',
      });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'The new password and confirmation do not match.' });
    }

    const email = String(customer.email || '').trim().toLowerCase();
    await verifyChallenge({
      email,
      purpose: 'customer-password-change',
      challengeId,
      code: verificationCode,
    });

    const firebaseUser = await auth.getUserByEmail(email);
    if (customer.uid && String(customer.uid) !== String(firebaseUser.uid)) {
      console.error(`Customer password change blocked because the Firebase UID does not match the customer profile (${customer.id}).`);
      return res.status(403).json({ error: 'Unable to verify this account. Please contact support.' });
    }
    await auth.updateUser(firebaseUser.uid, { password: newPassword });
    try {
      await auth.revokeRefreshTokens(firebaseUser.uid);
      return res.json({ success: true, message: 'Your password has been changed successfully.' });
    } catch (error) {
      console.error('Customer password changed, but Firebase sessions could not be revoked:', error);
      return res.json({
        success: true,
        message: 'Your password has been changed, but we could not sign out your other Firebase sessions. Please contact support if you do not recognize a session.',
      });
    }
  } catch (error) {
    if (error instanceof VerificationError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Customer password change failed:', error);
    return res.status(500).json({ error: 'Unable to change your password right now. Please try again later.' });
  }
});

app.post('/customer/session', async (req, res) => {
  try {
    const { idToken, profile = {}, verificationCode, challengeId } = req.body || {};
    
    if (!idToken) {
      return res.status(400).json({ error: 'Missing ID token' });
    }
    
    const decoded = await auth.verifyIdToken(idToken);
    
    const email = decoded.email;
    if (!email) return res.status(400).json({ error: 'Firebase account has no email address' });
    if (!/^[^@\s]+@gmail\.com$/i.test(email)) {
      return res.status(403).json({ error: 'Sign-in verification is available for Gmail accounts only.' });
    }
    await verifyChallenge({ email, purpose: 'customer', challengeId, code: verificationCode });
    if (!decoded.email_verified) await auth.updateUser(decoded.uid, { emailVerified: true });
    if (profile.phone && !isValidMobileNumber(profile.phone)) {
      return res.status(400).json({ error: 'Phone number must contain exactly 11 digits.' });
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
    if (error instanceof VerificationError) return res.status(error.status).json({ error: error.message });
    console.error('Session creation error:', error);
    const firebaseUnavailable = error && error.message && /Firebase|Project Id|credentials|Firestore/i.test(error.message);
    return res.status(firebaseUnavailable ? 503 : 401).json({
      error: firebaseUnavailable ? 'Customer authentication is temporarily unavailable. Please try again later.' : 'Invalid or incomplete sign-in verification.',
    });
  }
});

app.post('/customer/register-profile', async (req, res) => {
  try {
    const { idToken, profile = {} } = req.body || {};
    if (profile.termsAccepted !== true) {
      return res.status(400).json({ error: 'Please accept the terms and conditions before continuing.' });
    }
    if (!idToken) return res.status(400).json({ error: 'Missing ID token' });

    const decoded = await auth.verifyIdToken(idToken);
    const email = String(decoded.email || '').trim().toLowerCase();
    const profileEmail = String(profile.email || '').trim().toLowerCase();
    const name = String(profile.name || '').trim();
    const phone = String(profile.phone || '');
    const address = String(profile.address || '').trim();
    if (!email || email !== profileEmail) return res.status(403).json({ error: 'Registration email does not match the Firebase account' });
    if (!/^[^@\s]+@(gmail\.com|yahoo\.com|outlook\.com)$/.test(email)) {
      return res.status(400).json({ error: 'Use a Gmail, Yahoo, or Outlook email address (@gmail.com, @yahoo.com, or @outlook.com).' });
    }
    if (!name || !phone || !address) return res.status(400).json({ error: 'Name, phone, and address are required' });
    if (!/^09[0-9]{9}$/.test(phone)) return res.status(400).json({ error: 'Enter an 11-digit mobile number starting with 09.' });

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
      ...groomingBookings.map((booking) => releaseBookingSlotsByIds(groomingLockIds(booking.date, booking.time))),
      ...hotelBookings.map((booking) => releaseBookingSlotsByIds(booking.hotelSlotAssignments
        ? hotelLockIdsForAssignments(booking.hotelSlotAssignments)
        : Array.isArray(booking.hotelSlotNumbers)
          ? hotelLockIdsForSlots(booking.hotelSlotNumbers, booking.checkIn, booking.checkOut)
          : hotelLockIdsForTypes(
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
    const allowed = ['/login', '/login.html', '/register', '/register.html', '/logout', '/nav-status', '/profile'];
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
      db.GroomingAppointment.findAll({ where: { customerId: customer.id }, order: [['createdAt', 'DESC']] }),
      db.HotelReservation.findAll({ where: { customerId: customer.id }, order: [['createdAt', 'DESC']] }),
    ]);
    const attachPet = async (booking) => {
      if (booking.petId) booking.Pet = await db.Pet.findByPk(booking.petId);
      return booking;
    };
    res.json({ customer, pets, grooming: await Promise.all(grooming.map(attachPet)), hotel: await Promise.all(hotel.map(attachPet)) });
  } catch (e) {
    console.error('Customer profile lookup failed:', e);
    const message = e && e.message && /Firebase|Project Id|credentials|Firestore/i.test(e.message)
      ? 'Customer account data is temporarily unavailable. Please try again later.'
      : 'Server error';
    res.status(e && e.code === 'FIREBASE_UNAVAILABLE' ? 503 : 500).json({ error: message });
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
    const cleanPhone = String(phone || '');
    if (cleanPhone && !isValidMobileNumber(cleanPhone)) {
      return res.status(400).json({ error: 'Phone number must contain exactly 11 digits.' });
    }

    await customer.update({
      name: cleanName,
      phone: cleanPhone || null,
      address: address && String(address).trim() ? String(address).trim() : null,
    });
    return res.json({ customer });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

app.post('/customer/pets', async (req, res) => {
  try {
    const customer = await customerFromRequest(req);
    if (!customer) return res.status(401).json({ error: 'Not authenticated' });
    const validated = validatePetProfile(req.body);
    if (validated.error) return res.status(400).json({ error: validated.error });
    const pet = await db.Pet.create({ ...validated.value, customerId: customer.id });
    return res.status(201).json({ pet });
  } catch (error) {
    console.error('Customer pet creation failed:', error);
    return res.status(500).json({ error: 'Unable to save the pet profile.' });
  }
});

app.put('/customer/pets/:id', async (req, res) => {
  try {
    const customer = await customerFromRequest(req);
    if (!customer) return res.status(401).json({ error: 'Not authenticated' });
    const pet = await db.Pet.findByPk(req.params.id);
    if (!pet || String(pet.customerId) !== String(customer.id)) {
      return res.status(404).json({ error: 'Pet not found' });
    }
    const validated = validatePetProfile(req.body);
    if (validated.error) return res.status(400).json({ error: validated.error });
    await pet.update(validated.value);
    return res.json({ pet });
  } catch (error) {
    console.error('Customer pet update failed:', error);
    return res.status(500).json({ error: 'Unable to update the pet profile.' });
  }
});

app.delete('/customer/pets/:id', async (req, res) => {
  try {
    const customer = await customerFromRequest(req);
    if (!customer) return res.status(401).json({ error: 'Not authenticated' });
    const pet = await db.Pet.findByPk(req.params.id);
    if (!pet || String(pet.customerId) !== String(customer.id)) {
      return res.status(404).json({ error: 'Pet not found' });
    }
    const [grooming, hotel] = await Promise.all([
      db.GroomingAppointment.findAll({ where: { customerId: customer.id } }),
      db.HotelReservation.findAll({ where: { customerId: customer.id } }),
    ]);
    const isBooked = [...grooming, ...hotel].some((booking) =>
      (booking.petIds || [booking.petId]).filter(Boolean).some((petId) => String(petId) === String(pet.id)));
    if (isBooked) {
      return res.status(409).json({ error: 'This pet is linked to booking history and cannot be deleted. You can still update its details.' });
    }
    await pet.destroy();
    return res.json({ success: true });
  } catch (error) {
    console.error('Customer pet deletion failed:', error);
    return res.status(500).json({ error: 'Unable to delete the pet profile.' });
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
    if (Number(error.code) === 8 || error.code === 'RESOURCE_EXHAUSTED') {
      console.warn('Firestore is unavailable; falling back to the environment-based admin login.');
      return null;
    }
    throw error;
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
app.post('/admin/login', async (req, res) => {
    const password = String(req.body && req.body.password || '');
    const submittedEmail = String(req.body && req.body.email || '').trim().toLowerCase();
    const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();

    if (!password || !submittedEmail) return res.redirect('/admin/login.html?error=1');
    try {
      let role = null;
      let staffEmail = '';
      if (submittedEmail === adminEmail) {
        const envPass = String(process.env.ADMIN_PASS || '');
        const envMatch = Boolean(envPass && password === envPass);
        const admin = envPass ? null : await findAdminAccount();
        const dbMatch = !envPass && admin && admin.passwordHash && bcrypt.compareSync(password, admin.passwordHash);
        if (dbMatch || envMatch) role = ADMIN_USERNAME;
      } else {
        const staff = await db.StaffAccount.findOne({ where: { email: submittedEmail } });
        if (staff && staff.active === true && bcrypt.compareSync(password, staff.passwordHash || '')) {
          role = `STAFF:${staff.id}`;
          staffEmail = String(staff.email || '').trim().toLowerCase();
        }
      }

      if (role) {
        if (role === ADMIN_USERNAME) {
          if (!/^[^@\s]+@gmail\.com$/.test(adminEmail)) {
            console.warn('Admin sign-in blocked because ADMIN_EMAIL is not a valid Gmail address.');
            return res.redirect('/admin/login.html?error=email');
          }
          const { challengeId } = await createVerificationChallenge({
            email: adminEmail,
            purpose: 'admin',
            metadata: { role: ADMIN_USERNAME, email: adminEmail },
          });
          res.cookie('admin_login_challenge', challengeId, {
            path: '/admin/login',
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            maxAge: 10 * 60 * 1000,
          });
          return res.redirect('/admin/login.html?verify=1');
        }
        if (isStaffRole(role)) {
          if (!/^[^@\s]+@gmail\.com$/.test(staffEmail)) {
            console.warn(`Staff sign-in blocked because no valid Gmail address is configured for ${submittedEmail}.`);
            return res.redirect('/admin/login.html?error=email');
          }
          const { challengeId } = await createVerificationChallenge({
            email: staffEmail,
            purpose: 'staff',
            metadata: { role, email: staffEmail },
          });
          res.cookie('staff_login_challenge', challengeId, {
            path: '/admin/login',
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            maxAge: 10 * 60 * 1000,
          });
          return res.redirect('/admin/login.html?verify=1');
        }
        const token = createToken(role);
        res.cookie('admin_token', token, { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
        return res.redirect('/admin/index.html');
      }
    } catch (error) {
      if (error instanceof VerificationError) {
        return res.redirect(`/admin/login.html?error=${error.status === 429 ? 'wait' : 'email'}`);
      }
      console.error('Staff/admin sign-in failed:', error);
    }
    return res.redirect('/admin/login.html?error=1');
});

app.post('/admin/login/verify-code', async (req, res) => {
  const rawCookies = String(req.headers.cookie || '').split(';')
    .map((part) => part.trim())
  const adminChallengeId = rawCookies.find((part) => part.startsWith('admin_login_challenge='))
    ?.split('=').slice(1).join('=');
  const staffChallengeId = rawCookies.find((part) => part.startsWith('staff_login_challenge='))
    ?.split('=').slice(1).join('=');
  if (!adminChallengeId && !staffChallengeId) return res.redirect('/admin/login.html?error=expired');

  try {
    const metadata = await verifyChallengeById({
      purpose: adminChallengeId ? 'admin' : 'staff',
      challengeId: decodeURIComponent(adminChallengeId || staffChallengeId),
      code: req.body?.verificationCode,
    });
    const role = metadata.role;
    const email = String(metadata.email || '').toLowerCase();
    if (adminChallengeId) {
      const configuredAdminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
      if (role !== ADMIN_USERNAME || email !== configuredAdminEmail
        || !/^[^@\s]+@gmail\.com$/.test(configuredAdminEmail)) {
        return res.redirect('/admin/login.html?error=expired');
      }
      res.clearCookie('admin_login_challenge', { path: '/admin/login' });
      res.cookie('admin_token', createToken(ADMIN_USERNAME), {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      });
      return res.redirect('/admin/index.html');
    }
    if (!isStaffRole(role) || !/^[^@\s]+@gmail\.com$/.test(email)) {
      return res.redirect('/admin/login.html?error=expired');
    }
    const staff = await db.StaffAccount.findByPk(role.slice('STAFF:'.length));
    if (!staff || staff.active !== true || String(staff.email || '').trim().toLowerCase() !== email) {
      return res.redirect('/admin/login.html?error=expired');
    }
    res.clearCookie('staff_login_challenge', { path: '/admin/login' });
    res.cookie('admin_token', createToken(role), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
    return res.redirect('/admin/index.html');
  } catch (error) {
    if (error instanceof VerificationError) {
      return res.redirect(`/admin/login.html?verify=1&error=${error.status === 429 ? 'limit' : 'code'}`);
    }
    console.error('Staff verification code check failed:', error);
    return res.redirect('/admin/login.html?verify=1&error=server');
  }
});

app.get('/admin/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.redirect('/');
});

app.get('/admin/nav-status', async (req, res) => {
  const raw = req.headers.cookie || '';
  const cookie = raw.split(';').map((part) => part.trim()).find((part) => part.startsWith('admin_token='));
  const token = cookie ? decodeURIComponent(cookie.split('=').slice(1).join('=')) : null;
  const role = parseToken(token);
  const isStaff = isStaffRole(role) && await isActiveStaffRole(role);
  const isAdmin = role === ADMIN_USERNAME;
  res.json({ authenticated: isAdmin || isStaff, role: isAdmin ? 'ADMIN' : isStaff ? 'STAFF' : null });
});

app.post('/admin/change-password', (req, res) => {
  (async () => {
    const admin = await getAdminFromRequest(req);
    const raw = req.headers.cookie || '';
    const tokenCookie = raw.split(';').map((part) => part.trim()).find((part) => part.startsWith('admin_token='));
    const identity = parseToken(tokenCookie ? decodeURIComponent(tokenCookie.split('=').slice(1).join('=')) : null);
    const employee = !admin && typeof identity === 'string' && identity.startsWith('STAFF:')
      ? await db.Employee.findByPk(identity.slice('STAFF:'.length))
      : null;
    const account = admin || (employee && employee.status === 'active' ? employee : null);
    if (!account) return res.redirect('/admin/login.html');

    const { currentPassword, newPassword, confirmPassword } = req.body || {};
    if (!currentPassword || !bcrypt.compareSync(currentPassword, account.passwordHash)) {
      return res.redirect('/admin/change-password.html?passwordError=current');
    }
    if (!isStrongPassword(newPassword) || newPassword !== confirmPassword) {
      return res.redirect('/admin/change-password.html?passwordError=invalid');
    }

    await account.update({ passwordHash: bcrypt.hashSync(newPassword, 10) });
    return res.redirect('/admin/change-password.html?passwordChanged=1');
  })().catch((error) => {
    console.error(error);
    return res.redirect('/admin/change-password.html?passwordError=server');
  });
});

// Admin registration is disabled. Admin credentials and verification email are
// configured through ADMIN_PASS and ADMIN_EMAIL.
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
app.use('/admin', async (req, res, next) => {
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
  const isStaff = isStaffRole(user) && await isActiveStaffRole(user);
  if (user === ADMIN_USERNAME && req.path === '/employees.html') {
    return res.redirect('/admin/staff.html');
  }
  const staffPages = ['/index.html', '/staff-dashboard.html', '/appointments.html', '/grooming.html', '/hotel.html', '/customers.html', '/pets.html', '/reports.html', '/notifications.html'];
  const hasAccess = user === ADMIN_USERNAME || (isStaff && staffPages.includes(req.path));
  if (!hasAccess) return res.redirect('/admin/login.html');
  next();
}, (req, res, next) => {
  if (req.path === '/reports.html') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
}, express.static(path.join(__dirname, 'public', 'admin')));

// Serve the frontend (public site) as static files.
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/v1', apiRouter);

app.get('/api/cron/reminders', async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(503).json({ success: false, error: 'Reminder cron is not configured' });
  }
  if (req.get('authorization') !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

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
