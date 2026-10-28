const express = require('express');
const customerController = require('../controllers/customerController');
const petController = require('../controllers/petController');
const groomingController = require('../controllers/groomingController');
const hotelController = require('../controllers/hotelController');
const bookingController = require('../controllers/bookingController');
const adminController = require('../controllers/adminController');
const { parseToken, isStaffRole, isActiveStaffRole } = require('../util/adminAuth');
const staffController = require('../controllers/staffController');
const inventoryController = require('../controllers/inventoryController');
const operationsController = require('../controllers/operationsController');
const notificationController = require('../controllers/notificationController');
const { groomingServiceDuration } = require('../util/bookingCalculations');
const { HOTEL, HOTEL_POLICIES } = require('../util/serviceCatalog');

const router = express.Router();

const getServices = async (req, res, next) => {
  try {
    const { SERVICE_PRICES: groomingPrices, SERVICE_DETAILS: groomingDetails } = require('../controllers/groomingController');
    const { ROOM_PRICES: hotelPrices, ROOM_DETAILS: hotelDetails } = require('../controllers/hotelController');

    const getGroomingDetails = (name) => {
      if (name.startsWith('grooming-a-la-carte-')) return groomingDetails['a-la-carte'];
      if (name.startsWith('grooming-')) return groomingDetails.grooming?.[name.split('-')[1]];
      if (name.startsWith('ayurveda-herb-')) return groomingDetails.ayurveda?.[name.split('-')[2]];
      if (name.startsWith('ayurveda-pkg-')) {
        const packageName = name.split('-').slice(2, -1).join('-');
        return groomingDetails.packages?.[packageName];
      }
      return null;
    };

    const groomingServices = Object.entries(groomingPrices).map(([name, price]) => {
      const details = getGroomingDetails(name) || { category: 'Standard', includes: [], suitable: [] };
      return {
        name,
        type: 'grooming',
        price,
        details: { ...details, duration: groomingServiceDuration(name) || details.duration || 60 },
      };
    });

    const roomServices = Object.entries(hotelPrices).map(([name, price]) => {
      const roomName = name.split('-').at(-1);
      const rates = HOTEL.Staycation[roomName[0].toUpperCase() + roomName.slice(1)];
      return {
        name,
        type: 'hotel',
        price,
        unit: 'night',
        rates: { weekday: rates.weekday, weekend: rates.weekend },
        details: (hotelDetails && (hotelDetails[name] || hotelDetails[name.replace(/^(day-care|staycation)-/, '').replace(/-/g, '')])) || { category: 'Standard', size: 'Medium', occupancy: 2, amenities: [], description: 'Standard room' },
      };
    });

    res.json({
      grooming: groomingServices,
      hotel: roomServices,
      policies: HOTEL_POLICIES,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
};

const getRequestUser = (req) => {
	const cookie = (req.headers.cookie || '').split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith('admin_token='));
	const token = cookie ? decodeURIComponent(cookie.split('=').slice(1).join('=')) : null;
  return parseToken(token);
};

const adminOnly = (req, res, next) => {
	if (getRequestUser(req) === 'ADMIN') return next();
	return res.status(401).json({ error: 'Admin authentication required' });
};

const staffOrAdmin = async (req, res, next) => {
	const cookie = (req.headers.cookie || '').split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith('admin_token='));
	const token = cookie ? decodeURIComponent(cookie.split('=').slice(1).join('=')) : null;
	const role = parseToken(token);
	if (role === 'ADMIN') return next();
	if (!isStaffRole(role) || !(await isActiveStaffRole(role))) return res.status(401).json({ error: 'Staff authentication required' });
	return next();
};

const adminOrStaff = staffOrAdmin;

const staffReadOnlyOrAdmin = async (req, res, next) => {
	const cookie = (req.headers.cookie || '').split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith('admin_token='));
	const token = cookie ? decodeURIComponent(cookie.split('=').slice(1).join('=')) : null;
	const role = parseToken(token);
	if (role === 'ADMIN') return next();
	if (!isStaffRole(role) || !(await isActiveStaffRole(role))) return res.status(401).json({ error: 'Staff authentication required' });
	if (req.method !== 'GET') return res.status(403).json({ error: 'Staff access to customers and pets is read-only.' });
	return next();
};

router.use('/customers', staffReadOnlyOrAdmin);
router.use('/pets', staffReadOnlyOrAdmin);
router.use('/grooming', staffOrAdmin);
router.use('/hotel', staffOrAdmin);
router.use('/inventory', staffOrAdmin);
router.use('/notifications', staffOrAdmin);
const staffReadableAdminPaths = new Set([
  '/activity',
  '/occupancy',
  '/reports',
  '/reschedule-requests',
  '/revenue-analytics',
  '/revenue-by-service',
  '/services',
  '/stats',
]);

router.use('/admin', (req, res, next) => {
  const isRescheduleDecision = req.method === 'POST' && /^\/reschedule-requests\/[^/]+\/decision$/.test(req.path);
  if ((req.method === 'GET' && staffReadableAdminPaths.has(req.path)) || isRescheduleDecision) return staffOrAdmin(req, res, next);
	return adminOnly(req, res, next);
});

// Customers
router.get('/customers', adminOrStaff, customerController.listCustomers);
router.get('/customers/:id', adminOrStaff, customerController.getCustomer);
router.post('/customers', adminOrStaff, customerController.createCustomer);
router.put('/customers/:id', adminOrStaff, customerController.updateCustomer);
router.delete('/customers/:id', adminOrStaff, customerController.deleteCustomer);

// Pets
router.get('/pets', adminOrStaff, petController.listPets);
router.get('/pets/:id', adminOrStaff, petController.getPet);
router.post('/pets', adminOrStaff, petController.createPet);
router.put('/pets/:id', adminOrStaff, petController.updatePet);
router.delete('/pets/:id', adminOrStaff, petController.deletePet);

// Grooming appointments
router.get('/grooming', groomingController.listAppointments);
router.get('/grooming/:id', groomingController.getAppointment);
router.post('/grooming', groomingController.createAppointment);
router.post('/grooming/:id/resend-ticket', groomingController.resendAppointmentTicket);
router.put('/grooming/:id', adminOrStaff, groomingController.updateAppointment);
router.post('/grooming/:id/ticket', groomingController.sendAppointmentTicket);
router.delete('/grooming/:id', adminOnly, groomingController.deleteAppointment);

// Hotel reservations
router.get('/hotel', hotelController.listReservations);
router.get('/hotel/:id', hotelController.getReservation);
router.post('/hotel', hotelController.createReservation);
router.post('/hotel/:id/resend-ticket', hotelController.resendReservationTicket);
router.put('/hotel/:id', adminOrStaff, hotelController.updateReservation);
router.post('/hotel/:id/ticket', hotelController.sendReservationTicketEmail);
router.delete('/hotel/:id', adminOnly, hotelController.deleteReservation);

// Staff and admin inventory workflows; only admins review or delete records.
router.get('/inventory/items', inventoryController.listInventoryItems);
router.post('/inventory/items', inventoryController.createInventoryItem);
router.put('/inventory/items/:id', inventoryController.updateInventoryItem);
router.delete('/inventory/items/:id', adminOnly, inventoryController.deleteInventoryItem);
router.get('/inventory/requests', inventoryController.listStockRequests);
router.post('/inventory/requests', inventoryController.createStockRequest);
router.put('/inventory/requests/:id/review', adminOnly, inventoryController.reviewStockRequest);
router.get('/notifications', notificationController.listNotifications);
router.put('/notifications/:id/read', notificationController.markNotificationRead);

// Admin-managed staff accounts.
router.get('/admin/staff', adminOnly, staffController.listStaffAccounts);
router.post('/admin/staff', adminOnly, staffController.createStaffAccount);
router.put('/admin/staff/:id', adminOnly, staffController.updateStaffAccount);
router.delete('/admin/staff/:id', adminOnly, staffController.deleteStaffAccount);

// Inventory and stock requests
router.get('/inventory/products', operationsController.listProducts);
router.post('/inventory/products', operationsController.createProduct);
router.put('/inventory/products/:id', operationsController.updateProduct);
router.delete('/inventory/products/:id', operationsController.deleteProduct);
router.patch('/inventory/requests/:id', adminOrStaff, operationsController.updateStockRequest);

// Public one-shot bookings (customer + pet + booking in a single request)
router.post('/bookings/grooming', bookingController.bookGrooming);
router.post('/bookings/hotel', bookingController.bookHotel);
router.get('/bookings/hotel/quote', hotelController.getReservationQuote);
router.post('/payments/verify', bookingController.verifyPayment);
router.post('/payments/cancel', bookingController.cancelPayment);
router.put('/bookings/customer/:bookingType/:id', bookingController.updateCustomerBooking);
router.post('/bookings/customer/:bookingType/:id/reschedule-request', bookingController.requestCustomerBookingReschedule);
router.get('/bookings/customer/reschedule-requests', bookingController.listCustomerRescheduleRequests);
router.post('/bookings/customer/:bookingType/:id/cancel', bookingController.cancelCustomerBooking);
router.get('/bookings/grooming/availability', bookingController.getGroomingAvailability);
router.get('/bookings/hotel/availability', bookingController.getHotelAvailability);
router.get('/services', getServices);

// Admin monitoring
router.get('/admin/stats', adminController.getStats);
router.get('/admin/activity', adminController.getRecentActivity);
router.get('/admin/occupancy', adminController.getOccupancy);
router.get('/admin/revenue-by-service', adminController.getRevenueBreakdown);
router.get('/admin/revenue-analytics', adminController.getRevenueAnalytics);
router.get('/admin/reports', adminController.getOperationalReport);
router.get('/admin/reschedule-requests', adminOrStaff, bookingController.listPendingRescheduleRequests);
router.post('/admin/reschedule-requests/:id/decision', adminOrStaff, bookingController.decideCustomerRescheduleRequest);
router.get('/admin/pos-sales', adminController.getWalkInSalesAnalytics);
router.get('/admin/cash-transactions', adminController.listCashTransactions);
router.post('/admin/cash-transactions', adminController.createCashTransaction);

// Keep the dashboard endpoint protected while sharing its catalog response.
router.get('/admin/services', adminOrStaff, getServices);

// Service reminders (admin-triggered)
const { sendReminders } = require('../util/reminders');
router.post('/reminders/run', adminOrStaff, async (req, res, next) => {
  try {
    const result = await sendReminders();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
