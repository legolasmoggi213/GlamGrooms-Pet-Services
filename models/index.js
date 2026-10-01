const { FirebaseModel } = require('./firebaseModel');

module.exports = {
  Customer: new FirebaseModel('customers'),
  Pet: new FirebaseModel('pets'),
  GroomingAppointment: new FirebaseModel('groomingAppointments'),
  HotelReservation: new FirebaseModel('hotelReservations'),
  CashTransaction: new FirebaseModel('cashTransactions'),
  Admin: new FirebaseModel('admins'),
};
