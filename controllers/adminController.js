const { Customer, Pet, GroomingAppointment, HotelReservation, CashTransaction } = require('../models');
const { firestore } = require('../config/firebase');

const ACTIVE_GROOMING_STATUSES = ['scheduled', 'in-progress'];
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
    let key = dateKey;
    if (period === 'weekly') {
      const date = new Date(`${dateKey}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
      key = date.toISOString().slice(0, 10);
    } else if (period === 'monthly') {
      key = dateKey.slice(0, 7);
    }
    const bucket = values.get(key);
    if (!bucket) continue;
    bucket.revenue += Number(record[amountField] || 0);
    bucket.count += 1;
  }
  return buckets.map(({ key, label }) => ({ label, ...values.get(key) }));
};

// GET /api/v1/admin/stats — overview numbers for the admin dashboard.
const getStats = async (req, res, next) => {
  try {
    const today = businessDateKey();

    const [
      customers,
      pets,
      groomingTotal,
      groomingToday,
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
      GroomingAppointment.count({ where: { date: today } }),
      GroomingAppointment.count({ where: { status: ACTIVE_GROOMING_STATUSES } }),
      HotelReservation.count(),
      HotelReservation.count({
        where: { status: 'checked-in', checkIn: { lte: today }, checkOut: { gte: today } },
      }),
      HotelReservation.count({ where: { status: ['reserved', 'confirmed'], checkIn: { gte: today } } }),
      findRevenueRecords(GroomingAppointment, REVENUE_GROOMING_STATUSES),
      findRevenueRecords(HotelReservation, REVENUE_HOTEL_STATUSES),
      CashTransaction.findAll({ where: { type: 'walk-in' } }),
    ]);

    const groomingRevenue = groomingRecords
      .reduce((total, record) => total + Number(record.price || 0), 0);
    const hotelRevenue = hotelRecords
      .reduce((total, record) => total + Number(record.totalPrice || 0), 0);
    const overTheCounterRevenue = cashTransactions.reduce((total, transaction) => total + Number(transaction.amount || 0), 0);
    res.json({
      customers,
      pets,
      grooming: {
        total: groomingTotal,
        today: groomingToday,
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
      totalRevenue: (groomingRevenue || 0) + (hotelRevenue || 0) + overTheCounterRevenue,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/admin/activity — most recent bookings across both services.
const getRecentActivity = async (req, res, next) => {
  try {
    const [grooming, hotel, customers, pets] = await Promise.all([
      GroomingAppointment.findAll({ order: [['createdAt', 'DESC']], limit: 5 }),
      HotelReservation.findAll({ order: [['createdAt', 'DESC']], limit: 5 }),
      Customer.findAll(),
      Pet.findAll(),
    ]);

    const customerMap = Object.fromEntries(customers.map((c) => [String(c.id), c]));
    const petMap = Object.fromEntries(pets.map((p) => [String(p.id), p]));

    const activity = [
      ...grooming.map((a) => {
        const pet = petMap[String(a.petId)];
        const customer = customerMap[String(a.customerId)];
        const serviceSummary = Array.isArray(a.petServices) && a.petServices.length
          ? a.petServices.map((assignment) => `${assignment.petName || 'Pet'}: ${String(assignment.service || '').replace(/^grooming-/, '').replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())}`).join(', ')
          : `${a.service} for ${pet ? pet.name : 'pet'}`;
        return {
          type: 'grooming',
          id: a.id,
          createdAt: a.createdAt,
          status: a.status,
          summary: `${serviceSummary} (${customer ? customer.name : 'customer'})`,
        };
      }),
      ...hotel.map((r) => {
        const pet = petMap[String(r.petId)];
        const customer = customerMap[String(r.customerId)];
        const roomSummary = Array.isArray(r.petRooms) && r.petRooms.length
          ? r.petRooms.map((petRoom) => `${petRoom.petName || 'Pet'}: ${String(petRoom.roomType || '').replace(/^staycation-/, '').replace(/-/g, ' ')}`).join(', ')
          : `${r.roomType} stay for ${pet ? pet.name : 'pet'}`;
        return {
          type: 'hotel',
          id: r.id,
          createdAt: r.createdAt,
          status: r.status,
          summary: `${roomSummary} (${customer ? customer.name : 'customer'})`,
        };
      }),
    ]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10);

    res.json(activity);
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/admin/occupancy — hotel occupancy for the next 14 days.
const getOccupancy = async (req, res, next) => {
  try {
    const start = businessDateKey();
    const today = new Date(`${start}T00:00:00.000Z`);
    const endDate = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
    const end = endDate.toISOString().slice(0, 10);

    const reservations = await HotelReservation.findAll({
      where: {
        status: ACTIVE_HOTEL_STATUSES,
        checkIn: { lte: end },
        checkOut: { gt: start },
      },
      attributes: ['checkIn', 'checkOut'],
    });

    const days = [];
    for (let d = new Date(today); d <= endDate; d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
      const day = d.toISOString().slice(0, 10);
      const occupied = reservations.filter((r) => r.checkIn <= day && r.checkOut > day).length;
      days.push({ date: day, occupied });
    }

    res.json(days);
  } catch (error) {
    next(error);
  }
};

const getRevenueAnalytics = async (req, res, next) => {
  try {
    const period = ['daily', 'weekly', 'monthly'].includes(req.query.period) ? req.query.period : 'monthly';
    const [grooming, hotel] = await Promise.all([
      findRevenueRecords(GroomingAppointment, REVENUE_GROOMING_STATUSES),
      findRevenueRecords(HotelReservation, REVENUE_HOTEL_STATUSES),
    ]);
    const buckets = createRevenueBuckets(period, businessDateKey());
    const groomingBuckets = aggregateRevenue(grooming, 'price', period, buckets);
    const hotelBuckets = aggregateRevenue(hotel, 'totalPrice', period, buckets);
    const groomingRevenue = groomingBuckets.reduce((total, bucket) => total + bucket.revenue, 0);
    const hotelRevenue = hotelBuckets.reduce((total, bucket) => total + bucket.revenue, 0);

    res.json({
      period,
      grooming: groomingBuckets,
      hotel: hotelBuckets,
      totals: {
        grooming: groomingRevenue,
        hotel: hotelRevenue,
        combined: groomingRevenue + hotelRevenue,
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

    const walkInTransactions = await CashTransaction.findAll({ where: { type: 'walk-in' } });
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

const listCashTransactions = async (req, res, next) => {
  try {
    const records = await CashTransaction.findAll({ order: [['createdAt', 'DESC']], limit: 100 });
    res.json(records.map((record) => ({
      id: record.id,
      type: record.type,
      customerName: record.customerName,
      contact: record.contact || null,
      description: record.description,
      amount: Number(record.amount || 0),
      paymentMethod: record.paymentMethod,
      bookingType: record.bookingType || null,
      bookingId: record.bookingId || null,
      items: Array.isArray(record.items) ? record.items : [],
      tenderedAmount: Number(record.tenderedAmount || record.amount || 0),
      changeDue: Number(record.changeDue || 0),
      paidAt: record.paidAt || record.createdAt,
      recordedBy: record.recordedBy || 'ADMIN',
      notes: record.notes || '',
    })));
  } catch (error) {
    next(error);
  }
};

const createCashTransaction = async (req, res, next) => {
  try {
    const body = req.body || {};
    if (body.type === 'walk-in') {
      const customerName = String(body.customerName || 'Walk-in customer').trim();
      const paymentMethod = String(body.paymentMethod || 'cash').trim().toLowerCase();
      const hasItems = Array.isArray(body.items);
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
        };
      }) : [];
      if (hasItems && (!items.length || items.length > 50 || items.some((item) => !item.name || item.name.length > 160
        || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999
        || !Number.isFinite(item.unitPrice) || item.unitPrice <= 0 || item.unitPrice > 10000000))) {
        return res.status(400).json({ error: 'Add valid items with a name, quantity, and positive unit price.' });
      }
      const description = hasItems
        ? items.map((item) => `${item.quantity}x ${item.name}`).join(', ').slice(0, 160)
        : String(body.description || '').trim();
      const amount = hasItems
        ? Math.round(items.reduce((total, item) => total + item.lineTotal, 0) * 100) / 100
        : Number(body.amount);
      if (!customerName || !description || !Number.isFinite(amount) || amount <= 0 || amount > 10000000) {
        return res.status(400).json({ error: 'Customer name, item or service, and a valid positive amount are required.' });
      }
      if (!['cash', 'gcash', 'card'].includes(paymentMethod)) {
        return res.status(400).json({ error: 'Choose cash, GCash, or card as the payment method.' });
      }
      const tenderedAmount = paymentMethod === 'cash'
        ? Number(body.tenderedAmount == null ? amount : body.tenderedAmount)
        : amount;
      if (!Number.isFinite(tenderedAmount) || tenderedAmount < amount || tenderedAmount > 10000000) {
        return res.status(400).json({ error: 'Cash received must cover the sale total.' });
      }
      const changeDue = Math.round((tenderedAmount - amount) * 100) / 100;
      const transaction = await CashTransaction.create({
        type: 'walk-in',
        customerName,
        contact: String(body.contact || '').trim() || null,
        description,
        amount,
        items: hasItems ? items : [],
        paymentMethod,
        tenderedAmount,
        changeDue,
        paidAt: new Date(),
        recordedBy: 'ADMIN',
        notes: String(body.notes || '').trim(),
      });
      return res.status(201).json({ success: true, transaction: { id: transaction.id, amount, tenderedAmount, changeDue, paidAt: transaction.paidAt } });
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
    next(error);
  }
};

module.exports = {
  getStats,
  getRecentActivity,
  getOccupancy,
  getRevenueBreakdown,
  getRevenueAnalytics,
  listCashTransactions,
  createCashTransaction,
};
