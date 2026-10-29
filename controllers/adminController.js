const { Customer, Pet, GroomingAppointment, HotelReservation, CashTransaction } = require('../models');
const { firestore } = require('../config/firebase');
const { createQrPhCheckout, getPayMongoKey } = require('../util/paymongo');
const { isValidMobileNumber } = require('../util/mobileNumber');
const { isDigitsOnly, isDecimalNumber } = require('../util/numericValidation');
const groomingController = require('./groomingController');
const hotelController = require('./hotelController');
const { SERVICE_PRICES } = groomingController;
const { ROOM_PRICES } = hotelController;
const { quoteHotelStay, groomingRecordDuration } = require('../util/bookingCalculations');
const {
  hotelLockIdsForAssignments,
  hotelLockIdsForSlots,
  hotelLockIdsForTypes,
  releaseBookingSlotsByIds,
  releaseGroomingBookingSlots,
} = require('../util/bookingLocks');

const ACTIVE_GROOMING_STATUSES = ['pending', 'scheduled', 'confirmed', 'in-progress'];
const TODAY_GROOMING_STATUSES = ['scheduled', 'confirmed', 'in-progress'];
const ACTIVE_HOTEL_STATUSES = ['pending', 'reserved', 'confirmed', 'checked-in'];
const REVENUE_GROOMING_STATUSES = ['scheduled', 'confirmed', 'in-progress', 'completed'];
const REVENUE_HOTEL_STATUSES = ['reserved', 'confirmed', 'checked-in', 'checked-out'];
const BUSINESS_TIME_ZONE = 'Asia/Manila';
const businessDateKey = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(date);

const findRevenueRecords = async (Model, acceptedStatuses) => {
  const [acceptedRecords, paidRecords] = await Promise.all([
    Model.findAll({ where: { status: acceptedStatuses } }),
    Model.findAll({ where: { paymentStatus: 'paid' } }),
  ]);
  const records = new Map();
  for (const record of [...acceptedRecords, ...paidRecords]) {
    if (record.status !== 'cancelled') records.set(String(record.id), record);
  }
  return [...records.values()];
};

const createRevenueBuckets = (period, today) => {
  const todayDate = new Date(`${today}T00:00:00.000Z`);
  const format = (date, options) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(date);
  if (period === 'daily') {
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(todayDate.getTime() - (6 - index) * 86400000);
      const key = date.toISOString().slice(0, 10);
      return { key, label: format(date, { weekday: 'short', month: 'short', day: 'numeric' }) };
    });
  }
  if (period === 'weekly') {
    const mondayOffset = (todayDate.getUTCDay() + 6) % 7;
    const thisMonday = new Date(todayDate.getTime() - mondayOffset * 86400000);
    return Array.from({ length: 8 }, (_, index) => {
      const start = new Date(thisMonday.getTime() - (7 - index) * 7 * 86400000);
      const end = new Date(start.getTime() + 6 * 86400000);
      return {
        key: start.toISOString().slice(0, 10),
        label: `${format(start, { month: 'short', day: 'numeric' })}–${format(end, { month: 'short', day: 'numeric' })}`,
      };
    });
  }
  if (period === 'yearly') {
    const currentYear = Number(today.slice(0, 4));
    return Array.from({ length: 5 }, (_, index) => {
      const year = String(currentYear - 4 + index);
      return { key: year, label: year };
    });
  }
  const [year, month] = today.slice(0, 7).split('-').map(Number);
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 6 + index, 1));
    const key = date.toISOString().slice(0, 7);
    return { key, label: format(date, { month: 'short', year: 'numeric' }) };
  });
};

const revenueDateKey = (record) => {
  const date = record.paymentPaidAt || record.confirmedAt || record.updatedAt || record.createdAt;
  if (!date) return null;
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const parsed = date instanceof Date ? date : new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : businessDateKey(parsed);
};

const aggregateRevenue = (records, amountField, period, buckets) => {
  const values = new Map(buckets.map(({ key }) => [key, { revenue: 0, count: 0 }]));
  for (const record of records) {
    const dateKey = revenueDateKey(record);
    if (!dateKey) continue;
    const key = revenuePeriodKey(dateKey, period);
    const bucket = values.get(key);
    if (!bucket) continue;
    bucket.revenue += Number(record[amountField] || 0);
    bucket.count += 1;
  }
  return buckets.map(({ key, label }) => ({ label, ...values.get(key) }));
};

const aggregateWalkInRevenue = (transactions, period, buckets) => {
  const values = new Map(buckets.map(({ key }) => [key, { revenue: 0, count: 0 }]));
  for (const transaction of transactions) {
    const dateKey = walkInSalesDateKey(transaction);
    if (!dateKey) continue;
    const bucket = values.get(revenuePeriodKey(dateKey, period));
    if (!bucket) continue;
    bucket.revenue += Number(transaction.amount || 0);
    bucket.count += 1;
  }
  return buckets.map(({ key, label }) => ({ label, ...values.get(key) }));
};

const walkInRevenueItems = (transaction) => {
  const items = Array.isArray(transaction.items) ? transaction.items : [];
  if (!items.length) {
    return [{ category: transaction.description || 'Walk-in sale', revenue: Number(transaction.amount || 0), quantity: 1 }];
  }
  return items.map((item) => {
    const quantity = Number(item.quantity || 1);
    const lineTotal = Number(item.lineTotal);
    const unitPrice = Number(item.unitPrice);
    const revenue = Number.isFinite(lineTotal) && lineTotal > 0
      ? lineTotal
      : Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice * quantity : 0;
    return {
      category: item.category || item.name || transaction.description || 'Walk-in sale',
      revenue,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    };
  });
};

const aggregateWalkInRevenueByCategory = (transactions, period, buckets) => {
  const values = new Map();
  const validPeriodKeys = new Set(buckets.map(({ key }) => key));
  for (const transaction of transactions) {
    const dateKey = walkInSalesDateKey(transaction);
    if (!dateKey || !validPeriodKeys.has(revenuePeriodKey(dateKey, period))) continue;
    const items = walkInRevenueItems(transaction);
    const itemRevenue = items.reduce((sum, item) => sum + item.revenue, 0);
    const categoryItems = itemRevenue > 0
      ? items
      : [{ category: transaction.description || 'Walk-in sale', revenue: Number(transaction.amount || 0), quantity: 1 }];
    for (const item of categoryItems) {
      const category = item.category || 'Walk-in sale';
      const value = values.get(category) || { revenue: 0, count: 0 };
      value.revenue += item.revenue;
      value.count += item.quantity;
      values.set(category, value);
    }
  }
  return [...values.entries()]
    .map(([category, value]) => ({
      label: readableRevenueLabel(category),
      revenue: Math.round(value.revenue * 100) / 100,
      count: value.count,
    }))
    .sort((left, right) => right.revenue - left.revenue || left.label.localeCompare(right.label));
};

const isPaidWalkInTransaction = (transaction) => transaction.paymentStatus
  ? transaction.paymentStatus === 'paid'
  : transaction.paymentMethod !== 'qrph';

const revenuePeriodKey = (dateKey, period) => {
  if (period === 'weekly') {
    const date = new Date(`${dateKey}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    return date.toISOString().slice(0, 10);
  }
  if (period === 'yearly') return dateKey.slice(0, 4);
  return period === 'monthly' ? dateKey.slice(0, 7) : dateKey;
};

const walkInSalesDateKey = (transaction) => {
  const value = transaction.paidAt || transaction.createdAt;
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date
    ? value
    : value && typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : businessDateKey(date);
};

const getWalkInSalesAnalytics = async (req, res, next) => {
  try {
    const period = ['daily', 'weekly', 'monthly', 'yearly'].includes(req.query.period) ? req.query.period : 'daily';
    const transactions = (await CashTransaction.findAll({ where: { type: 'walk-in' } }))
      .filter(isPaidWalkInTransaction);
    const buckets = createRevenueBuckets(period, businessDateKey());
    const values = new Map(buckets.map(({ key }) => [key, { sales: 0, count: 0 }]));
    let allTimeSales = 0;

    for (const transaction of transactions) {
      const amount = Number(transaction.amount || 0);
      allTimeSales += Number.isFinite(amount) ? amount : 0;
      const dateKey = walkInSalesDateKey(transaction);
      if (!dateKey) continue;
      const value = values.get(revenuePeriodKey(dateKey, period));
      if (!value) continue;
      value.sales += Number.isFinite(amount) ? amount : 0;
      value.count += 1;
    }

    return res.json({
      period,
      allTimeSales,
      allTimeTransactions: transactions.length,
      buckets: buckets.map(({ key, label }) => ({ key, label, ...values.get(key) })),
    });
  } catch (error) {
    return next(error);
  }
};

const readableRevenueLabel = (value) => String(value || 'Other')
  .replace(/^grooming-/, '')
  .replace(/^ayurveda-herb-/, 'Ayurveda Herb ')
  .replace(/^ayurveda-pkg-/, 'Ayurveda Package ')
  .replace(/^staycation-/, 'Staycation ')
  .replace(/^day-care-/, 'Day Care ')
  .replace(/-/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase())
  .replace(/\bXl\b/g, 'XL');

const groomingRevenueItems = (booking) => (
  Array.isArray(booking.petServices) && booking.petServices.length
    ? booking.petServices.map((assignment) => ({
      category: assignment.service || booking.service || 'Other',
      revenue: Number(assignment.price || 0),
    }))
    : [{ category: booking.service || 'Other', revenue: Number(booking.price || 0) }]
);

const hotelRevenueItems = (reservation) => {
  const rooms = Array.isArray(reservation.petRooms) && reservation.petRooms.length
    ? reservation.petRooms
    : (reservation.roomTypes || [reservation.roomType]).filter(Boolean).map((roomType) => ({ roomType }));
  if (!rooms.length) return [{ category: reservation.roomType || 'Other', revenue: Number(reservation.totalPrice || 0) }];

  const petQuotes = reservation.pricingBreakdown?.petQuotes || [];
  const fallbackRevenue = Number(reservation.totalPrice || 0) / rooms.length;
  return rooms.map((room, index) => ({
    category: room.roomType || reservation.roomType || 'Other',
    revenue: Number(petQuotes[index]?.total ?? fallbackRevenue),
  }));
};

const aggregateRevenueByCategory = (records, period, buckets, getItems, categories) => {
  const values = new Map();
  for (const category of categories) values.set(category, { revenue: 0, count: 0 });
  const validPeriodKeys = new Set(buckets.map(({ key }) => key));

  for (const record of records) {
    const dateKey = revenueDateKey(record);
    if (!dateKey || !validPeriodKeys.has(revenuePeriodKey(dateKey, period))) continue;
    for (const item of getItems(record)) {
      const category = item.category || 'Other';
      const value = values.get(category) || { revenue: 0, count: 0 };
      value.revenue += Number(item.revenue || 0);
      value.count += 1;
      values.set(category, value);
    }
  }

  return [...values.entries()]
    .map(([category, value]) => ({
      label: readableRevenueLabel(category),
      revenue: Math.round(value.revenue * 100) / 100,
      count: value.count,
    }))
    .sort((left, right) => right.revenue - left.revenue || left.label.localeCompare(right.label));
};

// GET /api/v1/admin/stats — overview numbers for the admin dashboard.
const getStats = async (req, res, next) => {
  try {
    const today = businessDateKey();

    const [
      customers,
      pets,
      groomingTotal,
      groomingTodayAppointments,
      groomingActive,
      hotelTotal,
      currentGuests,
      upcomingArrivals,
      groomingRecords,
      hotelRecords,
      cashTransactions,
    ] = await Promise.all([
      Customer.count(),
      Pet.count(),
      GroomingAppointment.count(),
      GroomingAppointment.findAll({ where: { date: today } }),
      GroomingAppointment.count({ where: { status: ACTIVE_GROOMING_STATUSES } }),
      HotelReservation.count(),
      HotelReservation.count({
        where: { status: 'checked-in', checkIn: { lte: today }, checkOut: { gte: today } },
      }),
      HotelReservation.count({ where: { status: ['pending', 'reserved', 'confirmed'], checkIn: { gte: today } } }),
      findRevenueRecords(GroomingAppointment, REVENUE_GROOMING_STATUSES),
      findRevenueRecords(HotelReservation, REVENUE_HOTEL_STATUSES),
      CashTransaction.findAll({ where: { type: 'walk-in' } }),
    ]);

    const groomingToday = groomingTodayAppointments.filter((appointment) => TODAY_GROOMING_STATUSES.includes(appointment.status)).length;
    const groomingPendingToday = groomingTodayAppointments.filter((appointment) => appointment.status === 'pending').length;

    const groomingRevenue = groomingRecords
      .reduce((total, record) => total + Number(record.price || 0), 0);
    const hotelRevenue = hotelRecords
      .reduce((total, record) => total + Number(record.totalPrice || 0), 0);
    const overTheCounterRevenue = cashTransactions
      .filter(isPaidWalkInTransaction)
      .reduce((total, transaction) => total + Number(transaction.amount || 0), 0);
    const productSalesRevenue = cashTransactions
      .filter(isPaidWalkInTransaction)
      .reduce((total, transaction) => total + (Array.isArray(transaction.items) ? transaction.items : [])
        .filter((item) => item.inventoryId)
        .reduce((subtotal, item) => subtotal + Number(item.lineTotal
          ?? Number(item.unitPrice || 0) * Number(item.quantity || 0)), 0), 0);
    res.json({
      customers,
      pets,
      grooming: {
        total: groomingTotal,
        today: groomingToday,
        pendingToday: groomingPendingToday,
        active: groomingActive,
        revenue: groomingRevenue || 0,
      },
      hotel: {
        total: hotelTotal,
        currentGuests,
        upcomingArrivals,
        revenue: hotelRevenue || 0,
      },
      overTheCounterRevenue,
      productSalesRevenue,
      totalRevenue: (groomingRevenue || 0) + (hotelRevenue || 0) + overTheCounterRevenue,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/admin/activity — most recent bookings across both services.
const getRecentActivity = async (req, res, next) => {
  try {
    const recentActivityCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const [grooming, hotel, customers, pets] = await Promise.all([
      GroomingAppointment.findAll({ order: [['createdAt', 'DESC']] }),
      HotelReservation.findAll({ order: [['createdAt', 'DESC']] }),
      Customer.findAll(),
      Pet.findAll(),
    ]);

    const customerMap = Object.fromEntries(customers.map((c) => [String(c.id), c]));
    const petMap = Object.fromEntries(pets.map((p) => [String(p.id), p]));

    const sortedActivity = [
      ...grooming.filter((a) => String(a.status || '').toLowerCase() !== 'completed').map((a) => {
        const pet = petMap[String(a.petId)];
        const customer = customerMap[String(a.customerId)];
        const serviceSummary = Array.isArray(a.petServices) && a.petServices.length
          ? a.petServices.map((assignment) => `${assignment.petName || 'Pet'}: ${String(assignment.service || '').replace(/^grooming-/, '').replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())}`).join(', ')
          : `${a.service} for ${pet ? pet.name : 'pet'}`;
        const summary = `${serviceSummary} (${customer ? customer.name : 'customer'})`;
        return {
          type: 'grooming',
          id: a.id,
          createdAt: a.updatedAt || a.paymentPaidAt || a.createdAt,
          status: a.status,
          paymentStatus: a.paymentStatus,
          summary: a.paymentStatus === 'paid'
            ? `Advance paid — automatically confirmed: ${summary}, ${a.date} at ${a.time}`
            : summary,
        };
      }),
      ...hotel.filter((r) => String(r.status || '').toLowerCase() !== 'checked-out').map((r) => {
        const pet = petMap[String(r.petId)];
        const customer = customerMap[String(r.customerId)];
        const roomSummary = Array.isArray(r.petRooms) && r.petRooms.length
          ? r.petRooms.map((petRoom) => `${petRoom.petName || 'Pet'}: ${String(petRoom.roomType || '').replace(/^staycation-/, '').replace(/-/g, ' ')}`).join(', ')
          : `${r.roomType} stay for ${pet ? pet.name : 'pet'}`;
        const summary = `${roomSummary} (${customer ? customer.name : 'customer'})`;
        return {
          type: 'hotel',
          id: r.id,
          createdAt: r.updatedAt || r.paymentPaidAt || r.createdAt,
          status: r.status,
          paymentStatus: r.paymentStatus,
          summary: r.paymentStatus === 'paid'
            ? `Advance paid — automatically confirmed: ${summary}, ${r.checkIn} to ${r.checkOut}`
            : summary,
        };
      }),
    ]
      .filter((item) => {
        const activityTime = Date.parse(item.createdAt || '');
        return Number.isFinite(activityTime) && activityTime >= recentActivityCutoff;
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const activity = [
      ...sortedActivity.filter((item) => item.type === 'grooming').slice(0, 10),
      ...sortedActivity.filter((item) => item.type === 'hotel').slice(0, 10),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(activity);
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/admin/occupancy — hotel occupancy for the current month.
const getOccupancy = async (req, res, next) => {
  try {
    const today = new Date();
    const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
    const endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const start = new Intl.DateTimeFormat('en-CA', {
      timeZone: BUSINESS_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(startDate);
    const end = new Intl.DateTimeFormat('en-CA', {
      timeZone: BUSINESS_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(endDate);

    const [reservations, customers, pets] = await Promise.all([
      HotelReservation.findAll({
        where: {
          status: ACTIVE_HOTEL_STATUSES,
          checkIn: { lte: end },
          checkOut: { gt: start },
        },
      }),
      Customer.findAll(),
      Pet.findAll(),
    ]);
    const customerMap = Object.fromEntries(customers.map((customer) => [String(customer.id), customer]));
    const petMap = Object.fromEntries(pets.map((pet) => [String(pet.id), pet]));

    const days = [];
    for (let d = new Date(startDate); d <= endDate; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      const day = new Intl.DateTimeFormat('en-CA', {
        timeZone: BUSINESS_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
      const bookings = reservations
        .filter((reservation) => reservation.checkIn <= day && reservation.checkOut > day)
        .map((reservation) => {
          const customer = customerMap[String(reservation.customerId)];
          const petNames = reservation.petNames && reservation.petNames.length
            ? reservation.petNames
            : (reservation.petIds || (reservation.petId ? [reservation.petId] : []))
              .map((petId) => petMap[String(petId)])
              .filter(Boolean)
              .map((pet) => pet.name);
          const roomAssignments = Array.isArray(reservation.petRooms) && reservation.petRooms.length
            ? reservation.petRooms.map((petRoom) => `${petRoom.petName || 'Pet'}: ${String(petRoom.roomType || '').replace(/^staycation-/, '').replace(/-/g, ' ')}`)
            : [String(reservation.roomType || 'Pet hotel').replace(/^staycation-/, '').replace(/-/g, ' ')];
          return {
            id: reservation.id,
            customerId: reservation.customerId,
            customerName: customer ? customer.name : 'Customer',
            customerPhone: customer ? customer.phone : null,
            petNames,
            roomAssignments,
            checkIn: reservation.checkIn,
            checkInTime: reservation.checkInTime || null,
            checkOut: reservation.checkOut,
            checkOutTime: reservation.checkOutTime || null,
            status: reservation.status,
          };
        });
      const customerCount = new Set(bookings.map((booking) => String(booking.customerId))).size;
      days.push({
        date: day,
        occupied: customerCount,
        customers: customerCount,
        reservationCount: bookings.length,
        arrivals: bookings.filter((booking) => booking.checkIn === day).length,
        bookings,
      });
    }

    res.json(days);
  } catch (error) {
    next(error);
  }
};

const getRevenueAnalytics = async (req, res, next) => {
  try {
    const period = ['daily', 'weekly', 'monthly', 'yearly'].includes(req.query.period) ? req.query.period : 'monthly';
    const [grooming, hotel, walkInTransactions] = await Promise.all([
      findRevenueRecords(GroomingAppointment, REVENUE_GROOMING_STATUSES),
      findRevenueRecords(HotelReservation, REVENUE_HOTEL_STATUSES),
      CashTransaction.findAll({ where: { type: 'walk-in' } }),
    ]);
    const paidWalkInTransactions = walkInTransactions.filter(isPaidWalkInTransaction);
    const buckets = createRevenueBuckets(period, businessDateKey());
    const groomingBuckets = aggregateRevenue(grooming, 'price', period, buckets);
    const hotelBuckets = aggregateRevenue(hotel, 'totalPrice', period, buckets);
    const walkInBuckets = aggregateWalkInRevenue(paidWalkInTransactions, period, buckets);
    const groomingServices = aggregateRevenueByCategory(
      grooming,
      period,
      buckets,
      groomingRevenueItems,
      Object.keys(SERVICE_PRICES),
    );
    const hotelServices = aggregateRevenueByCategory(
      hotel,
      period,
      buckets,
      hotelRevenueItems,
      Object.keys(ROOM_PRICES),
    );
    const walkInServices = aggregateWalkInRevenueByCategory(paidWalkInTransactions, period, buckets);
    const groomingRevenue = groomingBuckets.reduce((total, bucket) => total + bucket.revenue, 0);
    const hotelRevenue = hotelBuckets.reduce((total, bucket) => total + bucket.revenue, 0);
    const walkInRevenue = walkInBuckets.reduce((total, bucket) => total + bucket.revenue, 0);
    res.json({
      period,
      grooming: groomingBuckets,
      hotel: hotelBuckets,
      walkIn: walkInBuckets,
      groomingServices,
      hotelServices,
      walkInServices,
      totals: {
        grooming: groomingRevenue,
        hotel: hotelRevenue,
        walkIn: walkInRevenue,
        combined: groomingRevenue + hotelRevenue + walkInRevenue,
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/admin/revenue-by-service — revenue grouped by grooming service / room type.
const getRevenueBreakdown = async (req, res, next) => {
  try {
    const [grooming, hotel] = await Promise.all([
      findRevenueRecords(GroomingAppointment, REVENUE_GROOMING_STATUSES),
      findRevenueRecords(HotelReservation, REVENUE_HOTEL_STATUSES),
    ]);

    const groupBy = (records, labelField, amountField) => Object.values(records.reduce((groups, record) => {
      const label = record[labelField];
      const group = groups[label] || { label, count: 0, revenue: 0 };
      group.count += 1;
      group.revenue += Number(record[amountField] || 0);
      groups[label] = group;
      return groups;
    }, {}));

    const walkInTransactions = (await CashTransaction.findAll({ where: { type: 'walk-in' } }))
      .filter(isPaidWalkInTransaction);
    const overTheCounter = Object.values(walkInTransactions.reduce((groups, transaction) => {
      const label = transaction.description || 'Walk-in sale';
      const group = groups[label] || { label, count: 0, revenue: 0 };
      group.count += 1;
      group.revenue += Number(transaction.amount || 0);
      groups[label] = group;
      return groups;
    }, Object.create(null)));

    res.json({
      grooming: groupBy(grooming, 'service', 'price'),
      hotel: groupBy(hotel, 'roomType', 'totalPrice'),
      overTheCounter,
    });
  } catch (error) {
    next(error);
  }
};

const formatReportDate = (value) => {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const date = value instanceof Date
    ? value
    : value && typeof value.toDate === 'function'
      ? value.toDate()
      : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const datePart = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  const timePart = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  return `${datePart} ${timePart}`;
};

const formatReportLabel = (value) => String(value || '')
  .replace(/-/g, ' ')
  .split(' ')
  .map((word) => {
    const specialLabel = { pos: 'POS', qrph: 'QR Ph', xl: 'XL' }[word.toLowerCase()];
    return specialLabel || word.replace(/\b\w/g, (letter) => letter.toUpperCase());
  })
  .join(' ');

const getOperationalReport = async (req, res, next) => {
  try {
    const type = String(req.query.type || '');
    const paymentFilter = String(req.query.paymentMethod || 'all').toLowerCase();
    const startDate = String(req.query.startDate || '').trim();
    const endDate = String(req.query.endDate || '').trim();
    if (!['grooming', 'hotel', 'walkin'].includes(type)) {
      return res.status(400).json({ error: 'Choose grooming, hotel, or walk-in as the report type.' });
    }
    if (!['all', 'cash', 'gcash'].includes(paymentFilter)) {
      return res.status(400).json({ error: 'Choose all payment methods, cash, or GCash.' });
    }
    const isValidDate = (value) => {
      if (!value) return true;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    };
    if (!isValidDate(startDate) || !isValidDate(endDate)) {
      return res.status(400).json({ error: 'Enter valid From and To dates.' });
    }
    if (startDate && endDate && startDate > endDate) {
      return res.status(400).json({ error: 'The From date must be on or before the To date.' });
    }

    const paymentMethodLabel = (method) => String(method || 'cash').toLowerCase() === 'qrph' ? 'GCash' : 'Cash';
    const includePaymentMethod = (method) => paymentFilter === 'all'
      || (paymentFilter === 'gcash' ? paymentMethodLabel(method) === 'GCash' : paymentMethodLabel(method) === 'Cash');
    const isPaidBooking = (booking) => String(booking.paymentStatus || '').toLowerCase() === 'paid';
    const includeDateRange = (value) => {
      if (!startDate && !endDate) return true;
      const date = formatReportDate(value).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
      return (!startDate || date >= startDate) && (!endDate || date <= endDate);
    };
    const formatAmount = (value) => {
      const amount = Number(value || 0);
      return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
    };
    const bookingPetNames = (booking, petMap, assignments = []) => {
      const savedNames = Array.isArray(booking.petNames) ? booking.petNames.filter(Boolean) : [];
      if (savedNames.length) return savedNames;
      const assignedNames = assignments.map((assignment) => assignment.petName).filter(Boolean);
      if (assignedNames.length) return assignedNames;
      return (booking.petIds || (booking.petId ? [booking.petId] : []))
        .map((id) => petMap[String(id)]?.name)
        .filter(Boolean);
    };

    if (type === 'grooming') {
      const [appointments, customers, pets] = await Promise.all([
        GroomingAppointment.findAll({ order: [['createdAt', 'DESC']] }),
        Customer.findAll(),
        Pet.findAll(),
      ]);
      const customerMap = Object.fromEntries(customers.map((customer) => [String(customer.id), customer]));
      const petMap = Object.fromEntries(pets.map((pet) => [String(pet.id), pet]));
      const rows = appointments
        .filter((booking) => isPaidBooking(booking)
          && includePaymentMethod(booking.paymentMethod)
          && includeDateRange(booking.date))
        .map((booking) => {
          const petNames = bookingPetNames(booking, petMap, booking.petServices);
          const services = Array.isArray(booking.petServices) && booking.petServices.length
            ? booking.petServices.map((service) => `${service.petName || 'Pet'}: ${formatReportLabel(service.service)}`).join('; ')
            : formatReportLabel(booking.service);
          return [
            booking.id,
            (customerMap[String(booking.customerId)] || {}).name || booking.customerDetails?.name || '—',
            Array.isArray(petNames) && petNames.length ? petNames.join(', ') : '—',
            services,
            `${formatReportDate(booking.date)}${booking.time ? ` ${booking.time}` : ''}`,
            formatReportLabel(booking.status),
            paymentMethodLabel(booking.paymentMethod),
            formatReportLabel(booking.paymentStatus || 'unpaid'),
            formatAmount(booking.price),
          ];
        });
      return res.json({
        title: 'Grooming Report',
        headers: ['Appointment ID', 'CUSTOMER', 'PET', 'SERVICES APPLIED', 'CHECK IN TIME', 'STATUS', 'PAYMENT TYPE', 'PAYMENT STATUS', 'PAYMENT TOTAL'],
        rows,
      });
    }

    if (type === 'hotel') {
      const [reservations, customers, pets] = await Promise.all([
        HotelReservation.findAll({ order: [['createdAt', 'DESC']] }),
        Customer.findAll(),
        Pet.findAll(),
      ]);
      const customerMap = Object.fromEntries(customers.map((customer) => [String(customer.id), customer]));
      const petMap = Object.fromEntries(pets.map((pet) => [String(pet.id), pet]));
      const rows = reservations
        .filter((booking) => isPaidBooking(booking)
          && includePaymentMethod(booking.paymentMethod)
          && includeDateRange(booking.checkIn))
        .map((booking) => {
          const petNames = bookingPetNames(booking, petMap, booking.petRooms);
          const rooms = Array.isArray(booking.petRooms) && booking.petRooms.length
            ? booking.petRooms.map((room) => `${room.petName || 'Pet'}: ${formatReportLabel(room.roomType)}`).join('; ')
            : formatReportLabel(booking.roomType);
          return [
            booking.id,
            (customerMap[String(booking.customerId)] || {}).name || booking.customerDetails?.name || '—',
            Array.isArray(petNames) && petNames.length ? petNames.join(', ') : '—',
            rooms,
            `${formatReportDate(booking.checkIn)}${booking.checkInTime ? ` ${booking.checkInTime}` : ''}`,
            `${formatReportDate(booking.checkOut)}${booking.checkOutTime ? ` ${booking.checkOutTime}` : ''}`,
            formatReportLabel(booking.status),
            paymentMethodLabel(booking.paymentMethod),
            formatReportLabel(booking.paymentStatus || 'unpaid'),
            formatAmount(booking.totalPrice),
          ];
        });
      return res.json({
        title: 'Hotel Report',
        headers: ['Reservation ID', 'Customer', 'Pet(s)', 'Room(s)', 'Check-in', 'Check-out', 'Status', 'Payment', 'Payment status', 'Amount (PHP)'],
        rows,
      });
    }

    const transactions = await CashTransaction.findAll({
      where: { type: 'walk-in' },
      order: [['createdAt', 'DESC']],
    });
    const rows = transactions
      .filter((transaction) => isPaidWalkInTransaction(transaction)
        && includePaymentMethod(transaction.paymentMethod)
        && includeDateRange(transaction.paidAt || transaction.createdAt))
      .map((transaction) => [
        transaction.id,
        transaction.customerName || 'Walk-in customer',
        transaction.petName || '—',
        transaction.description
          || (Array.isArray(transaction.items) ? transaction.items.map((item) => `${item.quantity}x ${item.name}`).join('; ') : '')
          || '—',
        paymentMethodLabel(transaction.paymentMethod),
        formatReportLabel(transaction.paymentStatus || (transaction.paymentMethod === 'qrph' ? 'pending' : 'paid')),
        formatAmount(transaction.amount),
        transaction.paymentMethod === 'qrph' ? '—' : formatAmount(transaction.tenderedAmount ?? transaction.amount),
        transaction.paymentMethod === 'qrph' ? '—' : formatAmount(transaction.changeDue),
        formatReportDate(transaction.paidAt || transaction.createdAt),
      ]);
    return res.json({
      title: 'Walk-in Report',
      headers: ['Transaction ID', 'Customer', 'Pet', 'Sale/items', 'Payment', 'Payment status', 'Amount (PHP)', 'Cash tendered', 'Change', 'Date'],
      rows,
    });
  } catch (error) {
    next(error);
  }
};

const listCashTransactions = async (req, res, next) => {
  try {
    const records = await CashTransaction.findAll({ order: [['createdAt', 'DESC']], limit: 100 });
    res.json(records.map((record) => ({
      id: record.id,
      type: record.type,
      customerName: record.customerName,
      petName: record.petName || null,
      contact: record.contact || null,
      description: record.description,
      amount: Number(record.amount || 0),
      paymentMethod: record.paymentMethod,
      paymentStatus: record.paymentStatus || (record.paymentMethod === 'qrph' ? 'pending' : 'paid'),
      bookingType: record.bookingType || null,
      bookingId: record.bookingId || null,
      bookingReferences: Array.isArray(record.bookingReferences) ? record.bookingReferences : [],
      items: Array.isArray(record.items) ? record.items : [],
      tenderedAmount: Number(record.tenderedAmount || record.amount || 0),
      changeDue: Number(record.changeDue || 0),
      paidAt: record.paidAt || record.createdAt,
      recordedBy: record.recordedBy || 'ADMIN',
      notes: record.notes || '',
      receipt: record.receipt || {
        receiptNumber: record.id,
        customerName: record.customerName,
        petName: record.petName || null,
        contact: record.contact || null,
        paymentMethod: record.paymentMethod,
        amount: Number(record.amount || 0),
        tenderedAmount: Number(record.tenderedAmount || record.amount || 0),
        changeDue: Number(record.changeDue || 0),
        items: Array.isArray(record.items) ? record.items : [],
        paidAt: record.paidAt || record.createdAt,
      },
    })));
  } catch (error) {
    next(error);
  }
};

const invokeBookingController = (handler, req) => new Promise((resolve, reject) => {
  let statusCode = 200;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      if (statusCode >= 400) {
        const error = new Error(payload.error || 'Unable to create the service booking.');
        error.status = statusCode;
        reject(error);
      } else {
        resolve(payload);
      }
      return this;
    },
  };
  Promise.resolve(handler(req, res, reject)).catch(reject);
});

const releasePosBookings = async (bookings) => {
  for (const { type, id } of [...bookings].reverse()) {
    if (type === 'grooming') {
      const appointment = await GroomingAppointment.findByPk(id);
      if (!appointment) continue;
      await appointment.destroy();
      await releaseGroomingBookingSlots(
        appointment.date,
        appointment.time,
        groomingRecordDuration(appointment),
        appointment.groomingSlotNumber,
      );
      continue;
    }
    const reservation = await HotelReservation.findByPk(id);
    if (!reservation) continue;
    const lockIds = reservation.hotelSlotAssignments
      ? hotelLockIdsForAssignments(reservation.hotelSlotAssignments)
      : Array.isArray(reservation.hotelSlotNumbers)
        ? hotelLockIdsForSlots(reservation.hotelSlotNumbers, reservation.checkIn, reservation.checkOut)
        : reservation.capacityManaged && Array.isArray(reservation.capacityLockIds)
          ? reservation.capacityLockIds
          : hotelLockIdsForTypes(
          reservation.roomTypes?.length
            ? reservation.roomTypes
            : reservation.petRooms?.length
              ? reservation.petRooms.map((room) => room.roomType)
              : [reservation.roomType],
          reservation.checkIn,
          reservation.checkOut,
        );
    await reservation.destroy();
    await releaseBookingSlotsByIds(lockIds);
  }
};

const createPosBookings = async (req, body, items, paymentMethod) => {
  const bookingData = body.posBooking;
  const groomingItems = items.filter((item) => ['grooming', 'ayurveda'].includes(item.kind));
  const hotelItems = items.filter((item) => item.kind === 'hotel');
  if (!groomingItems.length && !hotelItems.length) {
    if (bookingData) {
      const error = new Error('No grooming or hotel service was selected for booking.');
      error.status = 400;
      throw error;
    }
    return [];
  }
  if (!bookingData || typeof bookingData !== 'object') {
    const error = new Error('Add the required appointment or hotel dates to book a service at checkout.');
    error.status = 400;
    throw error;
  }
  if (hotelItems.length > 1) {
    const error = new Error('Complete one pet hotel room reservation per checkout.');
    error.status = 400;
    throw error;
  }
  if (groomingItems.some((item) => item.quantity !== 1)) {
    const error = new Error('Grooming service quantities must be 1. Add separate pets in separate checkouts.');
    error.status = 400;
    throw error;
  }
  if (!isValidMobileNumber(body.contact)) {
    const error = new Error('Enter an 11-digit customer contact number to create a service booking.');
    error.status = 400;
    throw error;
  }
  const customerName = String(body.customerName || '').trim();
  const petName = String(body.petName || '').trim();
  const petSpecies = String(body.petSpecies || '').trim().toLowerCase();
  if (!customerName || !petName || !['dog', 'cat'].includes(petSpecies)) {
    const error = new Error('Enter the customer name, pet name, and pet type to book a service.');
    error.status = 400;
    throw error;
  }

  const services = groomingItems.map((item) => String(item.catalogId || '').trim());
  if (services.some((service) => !Object.prototype.hasOwnProperty.call(SERVICE_PRICES, service))) {
    const error = new Error('A selected grooming service is no longer available.');
    error.status = 400;
    throw error;
  }
  if (groomingItems.some((item, index) => Math.abs(item.unitPrice - SERVICE_PRICES[services[index]]) > 0.01)) {
    const error = new Error('A grooming service price changed. Refresh the service list and try again.');
    error.status = 409;
    throw error;
  }

  let hotelQuote = null;
  if (hotelItems.length) {
    const roomType = String(bookingData.hotelRoomType || '').trim();
    const itemRoomType = String(hotelItems[0].catalogId || '').replace(/-(weekday|weekend)$/, '');
    if (!Object.prototype.hasOwnProperty.call(ROOM_PRICES, roomType) || roomType !== itemRoomType) {
      const error = new Error('The selected pet hotel room is no longer available.');
      error.status = 400;
      throw error;
    }
    hotelQuote = quoteHotelStay({
      petRoomTypes: [roomType],
      checkIn: bookingData.hotelCheckIn,
      checkOut: bookingData.hotelCheckOut,
    });
    if (!hotelQuote.ok) {
      const error = new Error(hotelQuote.error);
      error.status = 400;
      throw error;
    }
    if (hotelItems[0].quantity !== 1 || Math.abs(hotelItems[0].lineTotal - hotelQuote.total) > 0.01) {
      const error = new Error('The pet hotel total does not match the selected stay dates. Review the updated checkout total and try again.');
      error.status = 409;
      throw error;
    }
  }

  const createdBookings = [];
  let createdCustomer = null;
  let createdPet = null;
  try {
    let customer = await Customer.findOne({ where: { phone: String(body.contact).trim() } });
    if (!customer) {
      customer = await Customer.create({ name: customerName, phone: String(body.contact).trim() });
      createdCustomer = customer;
    }
    const customerPets = await Pet.findAll({ where: { customerId: customer.id } });
    let pet = customerPets.find((record) => String(record.name || '').trim().toLowerCase() === petName.toLowerCase()
      && String(record.species || '').trim().toLowerCase() === petSpecies);
    if (!pet) {
      pet = await Pet.create({
        name: petName,
        species: petSpecies,
        breed: 'Not provided',
        customerId: customer.id,
      });
      createdPet = pet;
    }
    const paidAt = paymentMethod === 'cash' ? new Date() : null;
    const paymentStatus = paymentMethod === 'cash' ? 'paid' : 'pending';
    const paymentFields = {
      paymentMethod,
      paymentStatus,
      ...(paidAt ? { paymentPaidAt: paidAt } : {}),
    };

    if (groomingItems.length) {
      const result = await invokeBookingController(groomingController.createAppointment, Object.assign(Object.create(req), {
        body: {
          services: [...new Set(services)],
          date: bookingData.groomingDate,
          time: bookingData.groomingTime,
          customerId: customer.id,
          petId: pet.id,
          status: 'pending',
        },
      }));
      const appointment = result.appointment || result;
      if (!appointment) throw new Error('Grooming appointment was not created.');
      createdBookings.push({ type: 'grooming', id: appointment.id });
      const appointmentRecord = await GroomingAppointment.findByPk(appointment.id);
      if (!appointmentRecord) throw new Error('Grooming appointment could not be loaded after creation.');
      await appointmentRecord.update(paymentFields);
    }

    if (hotelItems.length) {
      const result = await invokeBookingController(hotelController.createReservation, Object.assign(Object.create(req), {
        body: {
          roomType: bookingData.hotelRoomType,
          checkIn: bookingData.hotelCheckIn,
          checkInTime: bookingData.hotelCheckInTime,
          checkOut: bookingData.hotelCheckOut,
          checkOutTime: bookingData.hotelCheckOutTime,
          customerId: customer.id,
          petId: pet.id,
          status: 'pending',
        },
      }));
      const reservation = result.reservation || result;
      if (!reservation) throw new Error('Pet hotel reservation was not created.');
      createdBookings.push({ type: 'hotel', id: reservation.id });
      const reservationRecord = await HotelReservation.findByPk(reservation.id);
      if (!reservationRecord) throw new Error('Pet hotel reservation could not be loaded after creation.');
      await reservationRecord.update(paymentFields);
    }
    return createdBookings;
  } catch (error) {
    try {
      await releasePosBookings(createdBookings);
      if (createdPet) await createdPet.destroy();
      if (createdCustomer) await createdCustomer.destroy();
    } catch (rollbackError) {
      console.error('Unable to release a partially created Counter Checkout booking:', rollbackError);
      error.message = `${error.message} A partial booking may need staff review.`;
    }
    throw error;
  }
};

const createCashTransaction = async (req, res, next) => {
  let posBookingsToRollback = [];
  try {
    const body = req.body || {};
    if (body.type === 'walk-in') {
      const customerName = String(body.customerName || 'Walk-in customer').trim();
      const petName = String(body.petName || '').trim();
      const contact = body.contact == null ? '' : body.contact;
      const paymentMethod = String(body.paymentMethod || 'cash').trim().toLowerCase();
      if (!isValidMobileNumber(contact) || !contact.startsWith('09')) {
        return res.status(400).json({ error: 'Contact number must start with 09 and contain exactly 11 digits.' });
      }
      const hasItems = Array.isArray(body.items);
      if (hasItems && body.items.some((item) => !isDigitsOnly(item && item.quantity) || !isDecimalNumber(item && item.unitPrice))) {
        return res.status(400).json({ error: 'Item quantities must be whole numbers and prices must contain numbers only.' });
      }
      const items = hasItems ? body.items.map((item) => {
        const name = String(item && item.name || '').trim();
        const quantity = Number(item && item.quantity);
        const unitPrice = Number(item && item.unitPrice);
        return {
          name,
          quantity,
          unitPrice,
          lineTotal: Math.round(unitPrice * 100) * quantity / 100,
          category: String(item && item.category || 'Custom').trim().slice(0, 80),
          kind: ['grooming', 'ayurveda', 'hotel', 'product'].includes(String(item && item.kind))
            ? String(item.kind)
            : 'product',
          ...(item && item.catalogId ? { catalogId: String(item.catalogId).trim() } : {}),
          ...(item && item.inventoryId ? { inventoryId: String(item.inventoryId).trim() } : {}),
        };
      }) : [];
      if (hasItems && (!items.length || items.length > 50 || items.some((item) => !item.name || item.name.length > 160
        || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999
        || !Number.isFinite(item.unitPrice) || item.unitPrice <= 0 || item.unitPrice > 10000000))) {
        return res.status(400).json({ error: 'Add valid items with a name, quantity, and positive unit price.' });
      }
      if (items.some((item) => item.category.toLowerCase().startsWith('hotel -')) && !petName) {
        return res.status(400).json({ error: 'Enter the pet name for a hotel service sale.' });
      }
      const description = hasItems
        ? items.map((item) => `${item.quantity}x ${item.name}`).join(', ').slice(0, 160)
        : String(body.description || '').trim();
      const amount = hasItems
        ? Math.round(items.reduce((total, item) => total + item.lineTotal, 0) * 100) / 100
        : Number(body.amount);
      if (!hasItems && !isDecimalNumber(body.amount)) {
        return res.status(400).json({ error: 'Amount must contain numbers only.' });
      }
      if (!customerName || !description || !Number.isFinite(amount) || amount <= 0 || amount > 10000000) {
        return res.status(400).json({ error: 'Customer name, item or service, and a valid positive amount are required.' });
      }
      if (!['cash', 'qrph'].includes(paymentMethod)) {
        return res.status(400).json({ error: 'Choose cash or QR (PayMongo) as the payment method.' });
      }
      if (paymentMethod === 'qrph' && !getPayMongoKey()) {
        return res.status(503).json({ error: 'PayMongo is not configured. Add PAYMONGO_SECRET_KEY to .env.' });
      }
      const expectedTender = paymentMethod === 'cash'
        ? Number(body.tenderedAmount == null ? amount : body.tenderedAmount)
        : amount;
      if (paymentMethod === 'cash' && (!Number.isFinite(expectedTender) || expectedTender < amount || expectedTender > 10000000)) {
        return res.status(400).json({ error: 'Cash received must cover the sale total.' });
      }
      posBookingsToRollback = await createPosBookings(req, body, items, paymentMethod);
      const bookingReferences = posBookingsToRollback.map(({ type, id }) => ({ type, id }));
      if (items.some((item) => item.inventoryId)) {
        const transactionRef = firestore.collection('cashTransactions').doc();
        let responseTransaction;
        await firestore.runTransaction(async (firestoreTransaction) => {
          const inventoryIds = [...new Set(items.filter((item) => item.inventoryId).map((item) => item.inventoryId))];
          const inventoryRefs = inventoryIds.map((id) => firestore.collection('inventoryItems').doc(id));
          const snapshots = await Promise.all(inventoryRefs.map((ref) => firestoreTransaction.get(ref)));
          const products = new Map();
          snapshots.forEach((snapshot, index) => {
            if (!snapshot.exists) {
              const error = new Error('A product in this sale no longer exists.');
              error.status = 409;
              throw error;
            }
            products.set(inventoryIds[index], { ref: inventoryRefs[index], ...snapshot.data() });
          });

          const saleItems = items.map((item) => {
            if (!item.inventoryId) return item;
            const product = products.get(item.inventoryId);
            const unitPrice = Number(product.price);
            if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
              const error = new Error(`${product.name || 'This product'} needs a valid price before it can be sold.`);
              error.status = 409;
              throw error;
            }
            return {
              ...item,
              name: String(product.name || ''),
              unitPrice,
              lineTotal: Math.round(unitPrice * 100) * item.quantity / 100,
              category: String(product.category || 'Product'),
            };
          });
          const quantityByProduct = new Map();
          for (const item of saleItems) {
            if (item.inventoryId) quantityByProduct.set(item.inventoryId, (quantityByProduct.get(item.inventoryId) || 0) + item.quantity);
          }
          for (const [id, quantity] of quantityByProduct) {
            if (Number(products.get(id).quantity) < quantity) {
              const error = new Error(`Not enough stock for ${products.get(id).name}. Refresh products and try again.`);
              error.status = 409;
              throw error;
            }
          }

          const saleDescription = saleItems.map((item) => `${item.quantity}x ${item.name}`).join(', ').slice(0, 160);
          const saleAmount = Math.round(saleItems.reduce((total, item) => total + item.lineTotal, 0) * 100) / 100;
          const saleTenderedAmount = paymentMethod === 'cash'
            ? Number(body.tenderedAmount == null ? saleAmount : body.tenderedAmount)
            : saleAmount;
          if (!Number.isFinite(saleTenderedAmount) || saleTenderedAmount < saleAmount || saleTenderedAmount > 10000000) {
            const error = new Error('Cash received must cover the sale total.');
            error.status = 400;
            throw error;
          }
          const saleChangeDue = Math.round((saleTenderedAmount - saleAmount) * 100) / 100;
          const paidAt = new Date();
          const receipt = {
            receiptNumber: transactionRef.id,
            customerName,
            petName: petName || null,
            contact: String(body.contact || '').trim() || null,
            paymentMethod,
            amount: saleAmount,
            tenderedAmount: saleTenderedAmount,
            changeDue: saleChangeDue,
            items: saleItems,
            paidAt,
            description: saleDescription,
          };
          for (const [id, quantity] of quantityByProduct) {
            const product = products.get(id);
            firestoreTransaction.update(product.ref, {
              quantity: Number(product.quantity) - quantity,
              updatedAt: paidAt,
            });
          }
          firestoreTransaction.set(transactionRef, {
            type: 'walk-in',
            customerName,
            petName: petName || null,
            contact: receipt.contact,
            description: saleDescription,
            amount: saleAmount,
            items: saleItems,
            paymentMethod,
            tenderedAmount: saleTenderedAmount,
            changeDue: saleChangeDue,
            paidAt,
            recordedBy: 'ADMIN',
            notes: String(body.notes || '').trim(),
            receipt,
            bookingReferences,
            createdAt: paidAt,
            updatedAt: paidAt,
          });
          responseTransaction = {
            id: transactionRef.id,
            amount: saleAmount,
            tenderedAmount: saleTenderedAmount,
            changeDue: saleChangeDue,
            paidAt,
            receipt,
            bookingReferences,
          };
        });
        posBookingsToRollback = [];
        return res.status(201).json({ success: true, transaction: responseTransaction });
      }
      const tenderedAmount = paymentMethod === 'cash'
        ? Number(body.tenderedAmount == null ? amount : body.tenderedAmount)
        : amount;
      if (paymentMethod === 'cash' && (!Number.isFinite(tenderedAmount) || tenderedAmount < amount || tenderedAmount > 10000000)) {
        return res.status(400).json({ error: 'Cash received must cover the sale total.' });
      }
      const changeDue = paymentMethod === 'cash' ? Math.round((tenderedAmount - amount) * 100) / 100 : 0;
      const paidAt = paymentMethod === 'cash' ? new Date() : null;
      const transaction = await CashTransaction.create({
        type: 'walk-in',
        customerName,
        contact: contact || null,
        description,
        amount,
        items: hasItems ? items : [],
        paymentMethod,
        paymentStatus: paymentMethod === 'cash' ? 'paid' : 'pending',
        tenderedAmount,
        changeDue,
        paidAt,
        recordedBy: 'ADMIN',
        notes: String(body.notes || '').trim(),
        bookingReferences,
        receipt: {
          receiptNumber: '',
          customerName,
          petName: petName || null,
          contact: String(body.contact || '').trim() || null,
          paymentMethod,
          amount,
          tenderedAmount,
          changeDue,
          items: hasItems ? items : [],
          paidAt,
          description,
        },
      });

      if (paymentMethod === 'qrph') {
        const appUrl = process.env.APP_URL || 'http://localhost:3000';
        let checkout;
        try {
          checkout = await createQrPhCheckout({
            amount,
            description,
            metadata: {
              type: 'walk-in',
              customerName,
              contact,
              transactionId: String(transaction.id),
            },
            successUrl: `${appUrl}/admin/pos.html?payment=success&transaction_id=${encodeURIComponent(transaction.id)}`,
            cancelUrl: `${appUrl}/admin/pos.html?payment=cancelled&transaction_id=${encodeURIComponent(transaction.id)}`,
          });
          if (!checkout.id || !checkout.checkoutUrl) {
            throw new Error('PayMongo did not return a checkout session and payment URL.');
          }
          await transaction.update({ paymentReference: checkout.id });
          await Promise.all(bookingReferences.map(async ({ type, id }) => {
            const Model = type === 'grooming' ? GroomingAppointment : HotelReservation;
            const booking = await Model.findByPk(id);
            if (booking) await booking.update({ paymentReference: checkout.id });
          }));
        } catch (error) {
          await transaction.update({ paymentStatus: 'failed' });
          throw error;
        }
        posBookingsToRollback = [];
        return res.status(201).json({
          success: true,
          transaction: { id: transaction.id, amount, tenderedAmount, changeDue, paidAt: transaction.paidAt, bookingReferences },
          checkoutUrl: checkout.checkoutUrl,
        });
      }

      posBookingsToRollback = [];
      return res.status(201).json({ success: true, transaction: { id: transaction.id, amount, tenderedAmount, changeDue, paidAt: transaction.paidAt, bookingReferences } });
    }

    if (body.type !== 'booking-payment' || !['grooming', 'hotel'].includes(body.bookingType) || !body.bookingId) {
      return res.status(400).json({ error: 'Choose a valid walk-in sale or an unpaid grooming/hotel booking.' });
    }

    const isGrooming = body.bookingType === 'grooming';
    const model = isGrooming ? GroomingAppointment : HotelReservation;
    const booking = await model.findByPk(body.bookingId);
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });

    const customer = await Customer.findByPk(booking.customerId);
    const pet = await Pet.findByPk(booking.petId);
    const transactionRef = firestore.collection('cashTransactions').doc();
    let receipt;

    await firestore.runTransaction(async (firestoreTransaction) => {
      const snapshot = await firestoreTransaction.get(booking._ref);
      if (!snapshot.exists) {
        const error = new Error('Booking not found.');
        error.status = 404;
        throw error;
      }
      const current = snapshot.data();
      const paymentMethod = current.paymentMethod || 'cash';
      if (paymentMethod !== 'cash' || current.paymentStatus === 'paid' || current.paymentStatus === 'pending' || current.status === 'cancelled') {
        const error = new Error('Only unpaid cash bookings can be recorded.');
        error.status = 409;
        throw error;
      }
      const amount = Number(isGrooming ? current.price : current.totalPrice);
      if (!Number.isFinite(amount) || amount <= 0) {
        const error = new Error('Booking has no valid amount due.');
        error.status = 400;
        throw error;
      }

      const now = new Date();
      const description = isGrooming ? current.service : current.roomType;
      receipt = {
        type: 'booking-payment',
        bookingType: body.bookingType,
        bookingId: booking.id,
        customerName: customer ? customer.name : 'Customer',
        contact: customer ? customer.phone || customer.email || null : null,
        description,
        petName: pet ? pet.name : null,
        amount,
        paymentMethod: 'cash',
        paidAt: now,
        recordedBy: 'ADMIN',
        notes: String(body.notes || '').trim(),
        createdAt: now,
        updatedAt: now,
      };
      firestoreTransaction.update(booking._ref, {
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        paymentRecordedAt: now,
        paymentRecordedBy: 'ADMIN',
        updatedAt: now,
      });
      firestoreTransaction.set(transactionRef, receipt);
    });

    return res.status(201).json({ success: true, transaction: { id: transactionRef.id } });
  } catch (error) {
    if (posBookingsToRollback.length) {
      try {
        await releasePosBookings(posBookingsToRollback);
      } catch (rollbackError) {
        console.error('Unable to release Counter Checkout bookings after sale failure:', rollbackError);
        error.message = `${error.message} A partial appointment or reservation may need staff review.`;
      }
    }
    next(error);
  }
};

module.exports = {
  getStats,
  getRecentActivity,
  getOccupancy,
  getRevenueBreakdown,
  getRevenueAnalytics,
  getOperationalReport,
  getWalkInSalesAnalytics,
  listCashTransactions,
  createCashTransaction,
};
