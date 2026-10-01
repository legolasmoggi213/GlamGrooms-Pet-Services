const express = require('express');
const customerController = require('../controllers/customerController');
const petController = require('../controllers/petController');
const groomingController = require('../controllers/groomingController');
const hotelController = require('../controllers/hotelController');
const bookingController = require('../controllers/bookingController');
const adminController = require('../controllers/adminController');
const { parseToken } = require('../util/adminAuth');

const router = express.Router();

const getServices = async (req, res, next) => {
  try {
    const { SERVICE_PRICES: groomingPrices, SERVICE_DETAILS: groomingDetails } = require('../controllers/groomingController');
    const { ROOM_PRICES: hotelPrices, ROOM_DETAILS: hotelDetails, HOTEL_POLICIES: hotelPolicies } = require('../controllers/hotelController');

    const groomingServices = Object.entries(groomingPrices).map(([name, price]) => ({
      name,
      type: 'grooming',
      price,
      details: (groomingDetails && (groomingDetails[name] || groomingDetails[name.replace(/^grooming-/, '').replace(/-/g, '')])) || { category: 'Standard', duration: 60, includes: [], suitable: [] }
    }));

    const roomServices = Object.entries(hotelPrices).map(([name, price]) => ({
      name,
      type: 'hotel',
      price,
      details: (hotelDetails && (hotelDetails[name] || hotelDetails[name.replace(/^(day-care|staycation)-/, '').replace(/-/g, '')])) || { category: 'Standard', size: 'Medium', occupancy: 2, amenities: [], description: 'Standard room' }
    }));

    res.json({
      grooming: groomingServices,
      hotel: roomServices,
      policies: hotelPolicies,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
};

const adminOnly = (req, res, next) => {
	const cookie = (req.headers.cookie || '').split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith('admin_token='));
	const token = cookie ? decodeURIComponent(cookie.split('=').slice(1).join('=')) : null;
	if (parseToken(token) !== 'ADMIN') return res.status(401).json({ error: 'Admin authentication required' });
	next();
};

router.use('/customers', adminOnly);
router.use('/pets', adminOnly);
router.use('/grooming', adminOnly);
router.use('/hotel', adminOnly);
router.use('/admin', adminOnly);

// Customers
router.get('/customers', customerController.listCustomers);
router.get('/customers/:id', customerController.getCustomer);
router.post('/customers', customerController.createCustomer);
router.put('/customers/:id', customerController.updateCustomer);
router.delete('/customers/:id', customerController.deleteCustomer);

// Pets
router.get('/pets', petController.listPets);
router.get('/pets/:id', petController.getPet);
router.post('/pets', petController.createPet);
router.put('/pets/:id', petController.updatePet);
router.delete('/pets/:id', petController.deletePet);

// Grooming appointments
router.get('/grooming', groomingController.listAppointments);
router.get('/grooming/:id', groomingController.getAppointment);
router.post('/grooming', groomingController.createAppointment);
router.put('/grooming/:id', groomingController.updateAppointment);
router.delete('/grooming/:id', groomingController.deleteAppointment);

// Hotel reservations
router.get('/hotel', hotelController.listReservations);
router.get('/hotel/:id', hotelController.getReservation);
router.post('/hotel', hotelController.createReservation);
router.put('/hotel/:id', hotelController.updateReservation);
router.delete('/hotel/:id', hotelController.deleteReservation);

// Public one-shot bookings (customer + pet + booking in a single request)
router.post('/bookings/grooming', bookingController.bookGrooming);
router.post('/bookings/hotel', bookingController.bookHotel);
router.post('/payments/verify', bookingController.verifyPayment);
router.post('/payments/cancel', bookingController.cancelPayment);
router.get('/bookings/grooming/availability', bookingController.getGroomingAvailability);
router.get('/bookings/hotel/availability', bookingController.getHotelAvailability);
router.get('/services', getServices);

// Admin monitoring
router.get('/admin/stats', adminController.getStats);
router.get('/admin/activity', adminController.getRecentActivity);
router.get('/admin/occupancy', adminController.getOccupancy);
router.get('/admin/revenue-by-service', adminController.getRevenueBreakdown);
router.get('/admin/cash-transactions', adminController.listCashTransactions);
router.post('/admin/cash-transactions', adminController.createCashTransaction);

// Keep the dashboard endpoint protected while sharing its catalog response.
router.get('/admin/services', adminOnly, getServices);

// Service reminders (admin-triggered)
const { sendReminders } = require('../util/reminders');
router.post('/reminders/run', adminOnly, async (req, res, next) => {
  try {
    const result = await sendReminders();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
