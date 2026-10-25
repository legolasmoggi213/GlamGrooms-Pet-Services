const express = require('express');
const customerController = require('../controllers/customerController');
const petController = require('../controllers/petController');
const groomingController = require('../controllers/groomingController');
const hotelController = require('../controllers/hotelController');
const bookingController = require('../controllers/bookingController');
const adminController = require('../controllers/adminController');
const operationsController = require('../controllers/operationsController');
const { Customer, Employee, Pet } = require('../models');
const { parseToken } = require('../util/adminAuth');
const { groomingServiceDuration } = require('../util/bookingCalculations');

const router = express.Router();

const getServices = async (req, res, next) => {
  try {
    const { SERVICE_PRICES: groomingPrices, SERVICE_DETAILS: groomingDetails } = require('../controllers/groomingController');
    const { ROOM_PRICES: hotelPrices, ROOM_DETAILS: hotelDetails, HOTEL_POLICIES: hotelPolicies } = require('../controllers/hotelController');

    const groomingServices = Object.entries(groomingPrices).map(([name, price]) => {
      const details = (groomingDetails && (groomingDetails[name] || groomingDetails[name.replace(/^grooming-/, '').replace(/-/g, '')])) || { category: 'Standard', includes: [], suitable: [] };
      return {
        name,
        type: 'grooming',
        price,
        details: { ...details, duration: groomingServiceDuration(name) || details.duration || 60 },
      };
    });

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

const getRequestUser = (req) => {
	const cookie = (req.headers.cookie || '').split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith('admin_token='));
	const token = cookie ? decodeURIComponent(cookie.split('=').slice(1).join('=')) : null;
  return parseToken(token);
};

const adminOnly = (req, res, next) => {
  if (getRequestUser(req) !== 'ADMIN') return res.status(401).json({ error: 'Admin authentication required' });
  next();
};

const adminOrStaff = async (req, res, next) => {
  try {
    const user = getRequestUser(req);
    if (user === 'ADMIN') return next();
    if (typeof user === 'string' && user.startsWith('STAFF:')) {
      const employee = await Employee.findByPk(user.slice('STAFF:'.length));
      if (employee && employee.status === 'active') {
        req.authEmployee = employee;
        return next();
      }
    }
    return res.status(401).json({ error: 'Staff or admin authentication required' });
  } catch (error) {
    return next(error);
  }
};

router.use('/grooming', adminOrStaff);
router.use('/hotel', adminOrStaff);
router.use('/admin', adminOrStaff);
router.use('/inventory', adminOrStaff);

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
router.put('/grooming/:id', groomingController.updateAppointment);
router.delete('/grooming/:id', groomingController.deleteAppointment);

// Hotel reservations
router.get('/hotel', hotelController.listReservations);
router.get('/hotel/:id', hotelController.getReservation);
router.post('/hotel', hotelController.createReservation);
router.put('/hotel/:id', hotelController.updateReservation);
router.delete('/hotel/:id', hotelController.deleteReservation);

// Inventory and stock requests
router.get('/inventory/products', operationsController.listProducts);
router.post('/inventory/products', operationsController.createProduct);
router.put('/inventory/products/:id', operationsController.updateProduct);
router.delete('/inventory/products/:id', operationsController.deleteProduct);
router.get('/inventory/requests', operationsController.listStockRequests);
router.post('/inventory/requests', operationsController.createStockRequest);
router.patch('/inventory/requests/:id', adminOrStaff, operationsController.updateStockRequest);

// Public one-shot bookings (customer + pet + booking in a single request)
router.post('/bookings/grooming', bookingController.bookGrooming);
router.post('/bookings/hotel', bookingController.bookHotel);
router.get('/bookings/hotel/quote', hotelController.getReservationQuote);
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
router.get('/admin/revenue-analytics', adminController.getRevenueAnalytics);
router.get('/admin/cash-transactions', adminOrStaff, adminController.listCashTransactions);
router.post('/admin/cash-transactions', adminOrStaff, adminController.createCashTransaction);
router.get('/admin/employees', adminOnly, operationsController.listEmployees);
router.post('/admin/employees', adminOnly, operationsController.createEmployee);
router.put('/admin/employees/:id', adminOnly, operationsController.updateEmployee);
router.delete('/admin/employees/:id', adminOnly, operationsController.terminateEmployee);

// Keep the dashboard endpoint protected while sharing its catalog response.
router.get('/admin/services', adminOrStaff, getServices);

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
