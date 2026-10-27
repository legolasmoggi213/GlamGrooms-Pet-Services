const { StaffNotification } = require('../models');

const listNotifications = async (req, res, next) => {
  try {
    const notifications = await StaffNotification.findAll({ order: [['createdAt', 'DESC']], limit: 50 });
    res.json(notifications.map((notification) => ({
      id: notification.id,
      type: notification.type,
      bookingType: notification.bookingType,
      bookingId: notification.bookingId,
      customerName: notification.customerName,
      petNames: Array.isArray(notification.petNames) ? notification.petNames : [],
      schedule: notification.schedule || '',
      previousSchedule: notification.previousSchedule || '',
      status: notification.status || 'pending',
      read: notification.read === true,
      createdAt: notification.createdAt || null,
    })));
  } catch (error) {
    next(error);
  }
};

const markNotificationRead = async (req, res, next) => {
  try {
    const notification = await StaffNotification.findByPk(req.params.id);
    if (!notification) return res.status(404).json({ error: 'Notification not found.' });
    await notification.update({ read: true });
    return res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

module.exports = { listNotifications, markNotificationRead };
