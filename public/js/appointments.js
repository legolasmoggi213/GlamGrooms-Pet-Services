(() => {
  renderSidebar('Appointments');

  const groomingRowsEl = document.getElementById('grooming-appointment-rows');
  const hotelRowsEl = document.getElementById('hotel-appointment-rows');
  const transactionHistoryRowsEl = document.getElementById('transaction-history-rows');
  const rescheduleRowsEl = document.getElementById('reschedule-request-rows');
  const messageEl = document.getElementById('appointments-message');
  const terminalStatuses = {
    grooming: new Set(['completed']),
    hotel: new Set(['checked-out']),
  };
  let isAdmin = false;
  let canDeleteCancelledBookings = false;
  let bookings = [];
  let rescheduleRequests = [];
  const recentCustomerActivity = new Map();
  const recentBookingActivity = new Map();
  const groomingServices = ['bath', 'nail-trim', 'haircut', 'deshedding', 'full-groom'];
  const groomingStatuses = ['pending', 'scheduled', 'confirmed', 'in-progress', 'completed', 'cancelled'];

  const noteCustomerActivity = (customerId) => {
    if (customerId != null) recentCustomerActivity.set(String(customerId), Date.now());
  };

  const noteBookingActivity = (type, bookingId) => {
    const item = bookings.find((entry) => entry.type === type && String(entry.booking.id) === String(bookingId));
    recentBookingActivity.set(`${type}:${bookingId}`, Date.now());
    if (item) noteCustomerActivity(item.booking.customerId || item.booking.Customer?.id);
  };

  const bookingActivityTime = (item) => {
    const key = `${item.type}:${item.booking.id}`;
    const updatedAt = Date.parse(item.booking.updatedAt || item.booking.createdAt || '') || 0;
    return Math.max(recentBookingActivity.get(key) || 0, updatedAt);
  };

  const customerActivityTime = (item) => {
    const customerId = String(item.booking.customerId || item.booking.Customer?.id || '');
    return recentCustomerActivity.get(customerId) || 0;
  };

  const petsFor = (booking) => Array.isArray(booking.petNames) && booking.petNames.length
    ? booking.petNames.join(', ')
    : (booking.Pets || (booking.Pet ? [booking.Pet] : [])).map((pet) => pet.name).filter(Boolean).join(', ') || '—';

  const serviceFor = (booking, type) => {
    if (type === 'grooming') {
      return Array.isArray(booking.petServices) && booking.petServices.length
        ? booking.petServices.map((item) => `${item.petName || 'Pet'}: ${String(item.service || '').replace(/^grooming-/, '').replace(/-/g, ' ')}`).join('; ')
        : String(booking.service || 'Grooming').replace(/^grooming-/, '').replace(/-/g, ' ');
    }
    return Array.isArray(booking.petRooms) && booking.petRooms.length
      ? booking.petRooms.map((item) => `${item.petName || 'Pet'}: ${String(item.roomType || '').replace(/^staycation-/, '').replace(/-/g, ' ')}`).join('; ')
      : String(booking.roomType || 'Hotel stay').replace(/^staycation-/, '').replace(/-/g, ' ');
  };

  const scheduleFor = (booking, type) => type === 'grooming'
    ? `${fmtDate(booking.date)} at ${booking.time || 'Time not set'}${booking.pickupTime ? ` · Pickup ${booking.pickupTime}` : ''}`
    : `${fmtDate(booking.checkIn)} ${booking.checkInTime || ''} – ${fmtDate(booking.checkOut)} ${booking.checkOutTime || ''}`;

  const canReschedule = (booking, type) => type === 'grooming'
    ? ['pending', 'scheduled', 'confirmed'].includes(booking.status)
    : ['pending', 'reserved', 'confirmed'].includes(booking.status);

  const actionButton = (booking, type, action, label, style) => (
    `<button type="button" class="btn ${style} btn-sm appointment-manage-action" data-action="${action}" data-type="${type}" data-id="${escapeHtml(booking.id)}">${label}</button>`
  );

  const manageActionsFor = (booking, type) => {
    const actions = [];
    const bookingStatus = String(booking.status || '').toLowerCase();
    const ticketReady = type === 'grooming'
      ? ['in-progress', 'completed'].includes(bookingStatus)
      : ['checked-in', 'checked-out'].includes(bookingStatus);
    const ticketSent = Boolean(booking.reservationTicketEmailSentAt);
    if (type === 'grooming') {
      if (ticketReady) {
        actions.push(ticketSent
          ? '<span class="appointment-payment-status">Ticket Sent</span>'
          : actionButton(booking, type, 'send-ticket', 'Send Ticket', 'btn-success'));
      } else if (booking.status !== 'cancelled' && booking.status !== 'completed') {
        actions.push(actionButton(booking, type, 'confirm', 'Confirm', 'btn-success'));
      }
      if (booking.status === 'confirmed') actions.push(actionButton(booking, type, 'check-in', 'Check In', 'btn-outline'));
      if (booking.status === 'in-progress' && booking.confirmedAt && booking.paymentMethod !== 'qrph') {
        const paymentStatus = booking.paymentStatus === 'paid' ? 'paid' : 'unpaid';
        actions.push(`<span class="appointment-payment-status">Payment: ${paymentStatus.toUpperCase()}</span>`);
        actions.push(actionButton(booking, type, 'payment', paymentStatus === 'paid' ? 'Mark Unpaid' : 'Mark Paid', paymentStatus === 'paid' ? 'btn-outline' : 'btn-success'));
      }
      if (booking.status === 'in-progress' && booking.paymentStatus === 'paid') {
        actions.push(actionButton(booking, type, 'check-out', 'Check Out', 'btn-success'));
      }
      if (booking.status === 'completed' && booking.paymentStatus === 'paid') {
        actions.push(booking.paymentReceiptEmailSentAt
          ? '<span class="appointment-payment-status">Receipt sent</span>'
          : actionButton(booking, type, 'send-receipt', 'Send Receipt', 'btn-outline'));
      }
      actions.push(actionButton(booking, type, 'view', 'View', 'btn-outline'));
      if (canReschedule(booking, type)) actions.push(actionButton(booking, type, 'reschedule', 'Reschedule', 'btn-outline'));
      if (booking.status !== 'cancelled' && booking.status !== 'completed') {
        actions.push(actionButton(booking, type, 'cancel', booking.status === 'pending' ? 'Reject' : 'Cancel', 'btn-danger'));
      }
    } else {
      if (ticketReady) {
        actions.push(ticketSent
          ? '<span class="appointment-payment-status">Ticket Sent</span>'
          : actionButton(booking, type, 'send-ticket', 'Send Ticket', 'btn-success'));
      } else if (booking.status !== 'cancelled' && booking.status !== 'checked-in' && booking.status !== 'checked-out') {
        actions.push(actionButton(booking, type, 'confirm', 'Confirm', 'btn-success'));
      }
      if (['reserved', 'confirmed'].includes(booking.status)) {
        actions.push(actionButton(booking, type, 'check-in', 'Check In', 'btn-outline'));
      }
      if (booking.status === 'checked-in') actions.push(actionButton(booking, type, 'check-out', 'Check Out', 'btn-success'));
      if (booking.status === 'checked-in' && booking.confirmedAt && booking.paymentMethod !== 'qrph') {
        const paymentStatus = booking.paymentStatus === 'paid' ? 'paid' : 'unpaid';
        actions.push(`<span class="appointment-payment-status">Payment: ${paymentStatus.toUpperCase()}</span>`);
        actions.push(actionButton(booking, type, 'payment', paymentStatus === 'paid' ? 'Mark Unpaid' : 'Mark Paid', paymentStatus === 'paid' ? 'btn-outline' : 'btn-success'));
      }
      actions.push(actionButton(booking, type, 'view', 'View', 'btn-outline'));
      if (booking.status !== 'cancelled' && booking.status !== 'checked-in' && booking.status !== 'checked-out') {
        actions.push(actionButton(booking, type, 'cancel', booking.status === 'pending' ? 'Reject' : 'Cancel', 'btn-danger'));
      }
      if (canReschedule(booking, type)) actions.push(actionButton(booking, type, 'reschedule', 'Reschedule', 'btn-outline'));
    }
    if (isAdmin || (canDeleteCancelledBookings && booking.status === 'cancelled')) {
      actions.push(actionButton(booking, type, 'delete', 'Delete', 'btn-danger'));
    }
    return actions;
  };

  const openManage = (booking, type) => {
    const title = type === 'grooming' ? 'Manage Grooming Appointment' : 'Manage Pet Hotel Reservation';
    const actions = manageActionsFor(booking, type).join('');
    openModal(title, `<p class="appointment-manage-status">Status: ${escapeHtml(booking.status || 'pending')}</p><div class="appointment-manage-actions">${actions}<button type="button" class="btn btn-outline btn-sm" data-close-modal>Close</button></div>`);
    document.getElementById('modal-body').querySelector('[data-close-modal]').addEventListener('click', closeModal);
  };

  const refreshManageBooking = async (type, id) => {
    const booking = await refreshBooking(type, id);
    openManage(booking, type);
    return booking;
  };

  const openNewGroomingAppointment = async () => {
    const [customers, pets] = await Promise.all([apiGet('/customers'), apiGet('/pets')]);
    if (!customers.length || !pets.length) {
      messageEl.className = 'text-error';
      messageEl.textContent = 'Add at least one customer and pet before creating an appointment.';
      return;
    }
    const customerOptions = customers.map((customer) =>
      `<option value="${escapeHtml(customer.id)}">${escapeHtml(customer.name)}</option>`).join('');
    const petOptions = pets.map((pet) =>
      `<option value="${escapeHtml(pet.id)}" data-customer="${escapeHtml(pet.customerId)}">${escapeHtml(pet.name)}</option>`).join('');
    const serviceOptions = groomingServices.map((service) =>
      `<option value="${service}">${capitalize(service.replace(/-/g, ' '))}</option>`).join('');
    const statusOptions = groomingStatuses.map((status) =>
      `<option value="${status}" ${status === 'pending' ? 'selected' : ''}>${capitalize(status.replace(/-/g, ' '))}</option>`).join('');
    openModal('New Grooming Appointment', `
      <form id="new-grooming-form" class="form-grid">
        <div class="field"><label for="new-customer">Customer *</label><select id="new-customer" name="customerId" required>${customerOptions}</select></div>
        <div class="field"><label for="new-pet">Pet *</label><select id="new-pet" name="petId" required>${petOptions}</select></div>
        <div class="field"><label for="new-service">Service *</label><select id="new-service" name="service" required>${serviceOptions}</select></div>
        <div class="field"><label for="new-status">Status</label><select id="new-status" name="status">${statusOptions}</select></div>
        <div class="field"><label for="new-date">Date *</label><input id="new-date" name="date" type="date" required /></div>
        <div class="field"><label for="new-time">Time *</label><input id="new-time" name="time" type="time" value="10:00" required /></div>
        <div class="field"><label for="new-pickup">Pickup Time</label><input id="new-pickup" name="pickupTime" type="time" /></div>
        <div class="field full"><label for="new-notes">Notes</label><textarea id="new-notes" name="notes" rows="2"></textarea></div>
        <div class="form-actions full"><button class="btn btn-primary" type="submit">Save Appointment</button><button class="btn btn-outline" type="button" data-close-modal>Cancel</button></div>
      </form>`);
    const form = document.getElementById('new-grooming-form');
    const customerSelect = form.elements.namedItem('customerId');
    const petSelect = form.elements.namedItem('petId');
    const filterPets = () => {
      let firstValid = null;
      [...petSelect.options].forEach((option) => {
        const matchesCustomer = option.dataset.customer === customerSelect.value;
        option.hidden = !matchesCustomer;
        if (matchesCustomer && !firstValid) firstValid = option;
      });
      if (petSelect.selectedOptions[0]?.hidden && firstValid) petSelect.value = firstValid.value;
    };
    customerSelect.addEventListener('change', filterPets);
    filterPets();
    document.getElementById('modal-body').querySelector('[data-close-modal]').addEventListener('click', closeModal);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        await apiPost('/grooming', {
          customerId: customerSelect.value,
          petId: petSelect.value,
          service: form.elements.namedItem('service').value,
          status: form.elements.namedItem('status').value,
          date: form.elements.namedItem('date').value,
          time: form.elements.namedItem('time').value,
          pickupTime: form.elements.namedItem('pickupTime').value || null,
          notes: form.elements.namedItem('notes').value.trim() || null,
        });
        noteCustomerActivity(customerSelect.value);
        closeModal();
        await loadAppointments();
        messageEl.className = 'text-success';
        messageEl.textContent = 'Grooming appointment created.';
      } catch (error) {
        submit.disabled = false;
        messageEl.className = 'text-error';
        messageEl.textContent = error.message;
      }
    });
  };

  const viewBooking = async (booking, type) => {
    const record = await apiGet(`/${type}/${encodeURIComponent(booking.id)}`);
    const customer = record.Customer?.name || record.customerDetails?.name || '—';
    const pets = record.Pets || (record.Pet ? [record.Pet] : []);
    const pet = record.Pet?.name || pets[0]?.name || '—';
    const petInfo = pets.map((item) =>
      `ID: ${item.id}\nName: ${item.name || '—'}\nSpecies: ${item.species || '—'}\nBreed: ${item.breed || '—'}\nAge: ${item.age != null ? item.age : '—'}\nSize: ${item.size || '—'}\nMedical history: ${item.medicalHistory || 'Not provided'}\nCare notes: ${item.notes || '—'}`
    ).join('\n\n');
    const customerInfo = record.Customer
      ? `ID: ${record.Customer.id}\nEmail: ${record.Customer.email || '—'}\nPhone: ${record.Customer.phone || '—'}\nAddress: ${record.Customer.address || '—'}`
      : '';
    const price = type === 'grooming' ? record.price : record.totalPrice;
    const scheduleFields = type === 'grooming'
      ? `
        <div class="field"><label>Date</label><input type="text" readonly value="${escapeHtml(record.date || '—')}" /></div>
        <div class="field"><label>Time</label><input type="text" readonly value="${escapeHtml(record.time || '—')}" /></div>
        <div class="field"><label>Pickup Time</label><input type="text" readonly value="${escapeHtml(record.pickupTime || '—')}" /></div>
        <div class="field"><label>Price</label><input type="text" readonly value="${escapeHtml(fmtMoney(price))}" /></div>`
      : `
        <div class="field"><label>Check-in</label><input type="text" readonly value="${escapeHtml(record.checkIn || '—')}" /></div>
        <div class="field"><label>Check-in Time</label><input type="text" readonly value="${escapeHtml(record.checkInTime || '—')}" /></div>
        <div class="field"><label>Check-out</label><input type="text" readonly value="${escapeHtml(record.checkOut || '—')}" /></div>
        <div class="field"><label>Check-out Time</label><input type="text" readonly value="${escapeHtml(record.checkOutTime || '—')}" /></div>
        <div class="field"><label>Total</label><input type="text" readonly value="${escapeHtml(fmtMoney(price))}" /></div>`;
    const assignmentLabel = type === 'grooming' ? 'Services' : 'Room Assignment(s)';
    const assignmentInfo = type === 'grooming' && Array.isArray(record.petServices) && record.petServices.length
      ? record.petServices.map((item) => `${item.petName || 'Pet'}: ${String(item.service || '').replace(/^grooming-/, '').replace(/-/g, ' ')}`).join('\n')
      : type === 'hotel' && Array.isArray(record.petRooms) && record.petRooms.length
        ? record.petRooms.map((item) => `${item.petName || 'Pet'}: ${String(item.roomType || '').replace(/^staycation-/, '').replace(/-/g, ' ')}`).join('\n')
        : serviceFor(record, type);
    const title = type === 'grooming' ? 'Grooming Appointment Details' : 'Pet Hotel Reservation Details';
    openModal(title, `
      <div class="form-grid">
        <div class="field"><label>${type === 'grooming' ? 'Appointment ID' : 'Reservation ID'}</label><input type="text" readonly value="${escapeHtml(record.id)}" /></div>
        <div class="field"><label>Customer</label><input type="text" readonly value="${escapeHtml(customer)}" /></div>
        <div class="field"><label>Pet</label><input type="text" readonly value="${escapeHtml(pet)}" /></div>
        <div class="field full"><label>${assignmentLabel}</label><textarea rows="${Math.max(2, assignmentInfo.split('\n').length)}" readonly>${escapeHtml(assignmentInfo)}</textarea></div>
        ${scheduleFields}
        <div class="field"><label>Status</label><input type="text" readonly value="${escapeHtml(record.status || '—')}" /></div>
        <div class="field"><label>Customer ID</label><input type="text" readonly value="${escapeHtml(record.customerId || '—')}" /></div>
        <div class="field"><label>Pet ID(s)</label><input type="text" readonly value="${escapeHtml((record.petIds || (record.petId ? [record.petId] : [])).join(', ') || '—')}" /></div>
        <div class="field"><label>Payment Status</label><input type="text" readonly value="${escapeHtml(record.paymentStatus || '—')}" /></div>
        <div class="field"><label>Payment Method</label><input type="text" readonly value="${escapeHtml(record.paymentMethod || '—')}" /></div>
        <div class="field"><label>Payment Reference</label><input type="text" readonly value="${escapeHtml(record.paymentReference || '—')}" /></div>
        <div class="field"><label>Confirmed At</label><input type="text" readonly value="${escapeHtml(record.confirmedAt ? fmtDateTime(record.confirmedAt) : '—')}" /></div>
        <div class="field"><label>Created At</label><input type="text" readonly value="${escapeHtml(record.createdAt ? fmtDateTime(record.createdAt) : '—')}" /></div>
        <div class="field"><label>Updated At</label><input type="text" readonly value="${escapeHtml(record.updatedAt ? fmtDateTime(record.updatedAt) : '—')}" /></div>
        <div class="field full"><label>Pet Details</label><textarea rows="5" readonly>${escapeHtml(petInfo || '—')}</textarea></div>
        <div class="field full"><label>Customer Details</label><textarea rows="4" readonly>${escapeHtml(customerInfo || '—')}</textarea></div>
        <div class="field full"><label>Customer Notes</label><textarea rows="3" readonly>${escapeHtml(record.notes || 'No notes.')}</textarea></div>
      </div>`);
  };

  const renderRows = (type, rowsEl, emptyMessage) => {
    const typeBookings = bookings.filter((item) => item.type === type
      && !terminalStatuses[type].has(String(item.booking.status || '').toLowerCase()));
    if (!typeBookings.length) {
      rowsEl.innerHTML = `<tr><td colspan="5" class="empty">${emptyMessage}</td></tr>`;
      return;
    }
    rowsEl.innerHTML = typeBookings.map(({ booking }) => {
      return `
        <tr>
          <td>${escapeHtml(booking.Customer?.name || booking.customerDetails?.name || '—')}</td>
          <td><span class="appointment-primary">${escapeHtml(petsFor(booking))}</span><span class="appointment-detail">${escapeHtml(serviceFor(booking, type))}</span></td>
          <td>${escapeHtml(scheduleFor(booking, type))}</td>
          <td>${statusBadge(booking.status)}</td>
          <td><button type="button" class="btn btn-manage btn-sm" data-manage="true" data-type="${type}" data-id="${escapeHtml(booking.id)}">Manage</button></td>
        </tr>`;
    }).join('');
  };

  const renderAppointments = () => {
    renderRows('grooming', groomingRowsEl, 'No active grooming appointments.');
    renderRows('hotel', hotelRowsEl, 'No active pet hotel reservations.');
    renderTransactionHistory();
  };

  const isTerminalBooking = (type, booking) => terminalStatuses[type].has(String(booking.status || '').toLowerCase());

  const transactionCompletionTime = (item) => {
    const booking = item.booking;
    const completionTime = item.type === 'grooming'
      ? booking.checkedOutAt || booking.updatedAt || booking.createdAt
      : booking.checkedOutAt || booking.updatedAt || booking.checkOut || booking.createdAt;
    return Date.parse(completionTime || '') || 0;
  };

  const renderTransactionHistory = () => {
    const completedBookings = bookings
      .filter((item) => isTerminalBooking(item.type, item.booking))
      .sort((left, right) => transactionCompletionTime(right) - transactionCompletionTime(left));
    if (!completedBookings.length) {
      transactionHistoryRowsEl.innerHTML = '<tr><td colspan="8" class="empty">No completed transactions yet.</td></tr>';
      return;
    }
    transactionHistoryRowsEl.innerHTML = completedBookings.map(({ type, booking }) => {
      const completionLabel = type === 'grooming' ? 'Completed' : 'Checked out';
      const completionDate = type === 'grooming'
        ? booking.checkedOutAt || booking.updatedAt || booking.date
        : booking.checkedOutAt || booking.updatedAt || booking.checkOut;
      const amount = type === 'grooming' ? booking.price : booking.totalPrice;
      return `<tr>
        <td>${type === 'grooming' ? 'Grooming' : 'Pet Hotel'}</td>
        <td>${escapeHtml(booking.Customer?.name || booking.customerDetails?.name || '—')}</td>
        <td><span class="appointment-primary">${escapeHtml(petsFor(booking))}</span><span class="appointment-detail">${escapeHtml(serviceFor(booking, type))}</span></td>
        <td>${escapeHtml(completionLabel)}: ${escapeHtml(fmtDateTime(completionDate))}</td>
        <td><span class="appointment-payment-status">${escapeHtml(String(booking.paymentStatus || 'unpaid').replace(/-/g, ' ').toUpperCase())} · ${escapeHtml(completionLabel.toUpperCase())}</span></td>
        <td>${escapeHtml(String(booking.paymentMethod || '—').toUpperCase())}</td>
        <td>${escapeHtml(fmtMoney(amount))}</td>
        <td><button type="button" class="btn btn-outline btn-sm" data-manage="true" data-type="${type}" data-id="${escapeHtml(booking.id)}">View</button></td>
      </tr>`;
    }).join('');
  };

  const sortBookings = () => bookings.sort((left, right) => {
    const bookingActivityOrder = bookingActivityTime(right) - bookingActivityTime(left);
    if (bookingActivityOrder) return bookingActivityOrder;
    const customerActivityOrder = customerActivityTime(right) - customerActivityTime(left);
    if (customerActivityOrder) return customerActivityOrder;
    const leftDate = left.type === 'grooming' ? left.booking.date : left.booking.checkIn;
    const rightDate = right.type === 'grooming' ? right.booking.date : right.booking.checkIn;
    const dateOrder = String(rightDate || '').localeCompare(String(leftDate || ''));
    if (dateOrder) return dateOrder;
    const leftTime = left.type === 'grooming' ? left.booking.time : left.booking.checkInTime;
    const rightTime = right.type === 'grooming' ? right.booking.time : right.booking.checkInTime;
    return String(rightTime || '').localeCompare(String(leftTime || ''));
  });

  const renderBookingType = (type) => renderRows(
    type,
    type === 'grooming' ? groomingRowsEl : hotelRowsEl,
    type === 'grooming' ? 'No active grooming appointments.' : 'No active pet hotel reservations.',
  );

  const storeBooking = (type, booking) => {
    bookings = bookings.filter((item) => item.type !== type || String(item.booking.id) !== String(booking.id));
    bookings.push({ type, booking });
    sortBookings();
    renderBookingType(type);
    renderTransactionHistory();
  };

  const refreshBooking = async (type, id) => {
    const booking = await apiGet(`/${type}/${encodeURIComponent(id)}`);
    storeBooking(type, booking);
    return booking;
  };

  const removeBooking = (type, id) => {
    bookings = bookings.filter((item) => item.type !== type || String(item.booking.id) !== String(id));
    renderBookingType(type);
    renderTransactionHistory();
  };

  const showLoadError = (error) => {
    const message = escapeHtml(error.message);
    groomingRowsEl.innerHTML = `<tr><td colspan="5" class="empty">${message}</td></tr>`;
    hotelRowsEl.innerHTML = `<tr><td colspan="5" class="empty">${message}</td></tr>`;
    transactionHistoryRowsEl.innerHTML = `<tr><td colspan="8" class="empty">${message}</td></tr>`;
    rescheduleRowsEl.innerHTML = `<tr><td colspan="8" class="empty">${message}</td></tr>`;
  };

  const renderRescheduleRequests = () => {
    if (!rescheduleRequests.length) {
      rescheduleRowsEl.innerHTML = '<tr><td colspan="8" class="empty">No pending customer reschedule requests.</td></tr>';
      return;
    }
    rescheduleRowsEl.innerHTML = rescheduleRequests.map((request) => {
      const typeLabel = request.bookingType === 'grooming' ? 'Grooming' : 'Pet Hotel';
      const paymentLabel = `${request.paymentMethod === 'qrph' ? 'GCash' : 'Cash'} · ${request.paymentStatus || 'unpaid'}`;
      const paymentNotice = request.paymentStatus === 'paid' || request.paymentMethod === 'qrph'
        ? `<span class="reschedule-payment-warning">${escapeHtml(paymentLabel)} · Review any price difference</span>`
        : escapeHtml(paymentLabel);
      return `
        <tr>
          <td>${escapeHtml(request.customerName || 'Customer')}</td>
          <td>${typeLabel} #${escapeHtml(request.bookingId)}</td>
          <td>${escapeHtml((request.petNames || []).join(', ') || '—')}</td>
          <td>${escapeHtml(scheduleFor(request.currentSchedule || {}, request.bookingType))}</td>
          <td>${escapeHtml(scheduleFor(request.requestedSchedule || {}, request.bookingType))}</td>
          <td>${paymentNotice}</td>
          <td>${escapeHtml(request.requestedSchedule?.notes || '—')}</td>
          <td><div class="reschedule-review-actions">
            <button type="button" class="btn btn-primary btn-sm" data-request-decision="approved" data-request-id="${escapeHtml(request.id)}">Approve</button>
            <button type="button" class="btn btn-outline btn-sm" data-request-decision="declined" data-request-id="${escapeHtml(request.id)}">Decline</button>
          </div></td>
        </tr>`;
    }).join('');
  };

  const loadPendingRescheduleRequests = async () => {
    rescheduleRequests = await apiGet('/admin/reschedule-requests');
    renderRescheduleRequests();
  };

  const sameSchedule = (booking, requested, type) => {
    const fields = type === 'grooming' ? ['date', 'time', 'pickupTime'] : ['checkIn', 'checkInTime', 'checkOut', 'checkOutTime'];
    return fields.every((field) => String(booking[field] || '') === String(requested[field] || ''));
  };

  const handleRescheduleDecision = async (button) => {
    const request = rescheduleRequests.find((item) => String(item.id) === String(button.dataset.requestId));
    if (!request) return;
    const decision = button.dataset.requestDecision;
    if (decision === 'declined') {
      if (!window.confirm(`Decline ${request.customerName || 'this customer'}'s reschedule request?`)) return;
    }
    if (decision === 'approved' && (request.paymentStatus === 'paid' || request.paymentMethod === 'qrph')
      && !window.confirm('This booking has an online or completed payment. Approving may change the total. Review and handle any payment difference with the customer. Continue?')) return;

    button.disabled = true;
    try {
      if (decision === 'approved') {
        const type = request.bookingType;
        const currentBooking = await apiGet(`/${type}/${encodeURIComponent(request.bookingId)}`);
        const alreadyApplied = sameSchedule(currentBooking, request.requestedSchedule, type);
        if (!alreadyApplied) {
          if (!sameSchedule(currentBooking, request.currentSchedule, type)) {
            throw new Error('This booking changed after the request was submitted. Refresh the request and review it again.');
          }
          await apiPut(`/${type}/${encodeURIComponent(request.bookingId)}`, request.requestedSchedule);
        }
      }
      await apiPost(`/admin/reschedule-requests/${encodeURIComponent(request.id)}/decision`, { decision });
      noteBookingActivity(request.bookingType, request.bookingId);
      rescheduleRequests = rescheduleRequests.filter((item) => String(item.id) !== String(request.id));
      renderRescheduleRequests();
      if (decision === 'approved') await refreshBooking(request.bookingType, request.bookingId);
      messageEl.className = 'text-success';
      messageEl.textContent = decision === 'approved' ? 'Reschedule request approved and applied.' : 'Reschedule request declined.';
    } catch (error) {
      button.disabled = false;
      messageEl.className = 'text-error';
      messageEl.textContent = error.message;
    }
  };

  const loadAppointments = async () => {
    const [grooming, hotel, sessionResponse, requests] = await Promise.all([
      apiGet('/grooming'),
      apiGet('/hotel'),
      fetch('/admin/nav-status', { credentials: 'include', cache: 'no-store' }),
      apiGet('/admin/reschedule-requests'),
    ]);
    if (!sessionResponse.ok) throw new Error(`Unable to verify your role (${sessionResponse.status}).`);
    const session = await sessionResponse.json();
    isAdmin = session.role === 'ADMIN';
    canDeleteCancelledBookings = isAdmin || session.role === 'STAFF' || String(session.role || '').startsWith('STAFF:');
    rescheduleRequests = requests;
    bookings = [
      ...grooming.map((booking) => ({ type: 'grooming', booking })),
      ...hotel.map((booking) => ({ type: 'hotel', booking })),
    ];
    sortBookings();
    renderAppointments();
    renderRescheduleRequests();
  };

  const rescheduleForm = (booking, type) => {
    if (type === 'grooming') {
      return `
        <form id="reschedule-form" class="form-grid">
          <div class="field"><label for="schedule-date">Appointment date</label><input id="schedule-date" name="date" type="date" value="${escapeHtml(booking.date || '')}" required /></div>
          <div class="field"><label for="schedule-time">Appointment time</label><input id="schedule-time" name="time" type="time" value="${escapeHtml(String(booking.time || '').slice(0, 5))}" required /></div>
          <div class="field"><label for="schedule-pickup">Pickup time</label><input id="schedule-pickup" name="pickupTime" type="time" value="${escapeHtml(String(booking.pickupTime || '').slice(0, 5))}" /></div>
          <div class="form-actions full"><button class="btn btn-primary" type="submit">Save new schedule</button><button class="btn btn-outline" type="button" data-close-modal>Cancel</button></div>
        </form>`;
    }
    return `
      <form id="reschedule-form" class="form-grid">
        <div class="field"><label for="schedule-checkin">Check-in date</label><input id="schedule-checkin" name="checkIn" type="date" value="${escapeHtml(booking.checkIn || '')}" required /></div>
        <div class="field"><label for="schedule-checkin-time">Check-in time</label><input id="schedule-checkin-time" name="checkInTime" type="time" value="${escapeHtml(String(booking.checkInTime || '').slice(0, 5))}" required /></div>
        <div class="field"><label for="schedule-checkout">Check-out date</label><input id="schedule-checkout" name="checkOut" type="date" value="${escapeHtml(booking.checkOut || '')}" required /></div>
        <div class="field"><label for="schedule-checkout-time">Check-out time</label><input id="schedule-checkout-time" name="checkOutTime" type="time" value="${escapeHtml(String(booking.checkOutTime || '').slice(0, 5))}" required /></div>
        <div class="form-actions full"><button class="btn btn-primary" type="submit">Save new schedule</button><button class="btn btn-outline" type="button" data-close-modal>Cancel</button></div>
      </form>`;
  };

  const beginReschedule = (booking, type) => {
    const formHtml = rescheduleForm(booking, type);
    openModal(`Reschedule ${type === 'grooming' ? 'grooming appointment' : 'hotel reservation'}`, formHtml);
    document.querySelector('[data-close-modal]').addEventListener('click', closeModal);
    document.getElementById('reschedule-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const body = type === 'grooming'
        ? {
          date: form.elements.namedItem('date').value,
          time: form.elements.namedItem('time').value,
          pickupTime: form.elements.namedItem('pickupTime').value || null,
        }
        : {
          checkIn: form.elements.namedItem('checkIn').value,
          checkInTime: form.elements.namedItem('checkInTime').value,
          checkOut: form.elements.namedItem('checkOut').value,
          checkOutTime: form.elements.namedItem('checkOutTime').value,
        };
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        await apiPut(`/${type}/${encodeURIComponent(booking.id)}`, body);
        noteBookingActivity(type, booking.id);
        await refreshManageBooking(type, booking.id);
        messageEl.className = 'text-success';
        messageEl.textContent = 'Appointment schedule updated.';
      } catch (error) {
        submit.disabled = false;
        messageEl.className = 'text-error';
        messageEl.textContent = error.message;
      }
    });
  };

  document.addEventListener('click', async (event) => {
    const requestDecisionButton = event.target.closest('[data-request-decision][data-request-id]');
    if (requestDecisionButton) {
      await handleRescheduleDecision(requestDecisionButton);
      return;
    }
    const manageButton = event.target.closest('[data-manage][data-type][data-id]');
    if (manageButton) {
      const { type, id } = manageButton.dataset;
      const record = bookings.find((item) => item.type === type && String(item.booking.id) === String(id));
      if (record) openManage(record.booking, type);
      return;
    }
    const button = event.target.closest('[data-action][data-type][data-id]');
    if (!button) return;
    const { action, type, id } = button.dataset;
    const record = bookings.find((item) => item.type === type && String(item.booking.id) === String(id));
    if (!record) return;
    if (action === 'reschedule') {
      closeModal();
      beginReschedule(record.booking, type);
      return;
    }
    if (action === 'view') {
      closeModal();
      try {
        await viewBooking(record.booking, type);
      } catch (error) {
        messageEl.className = 'text-error';
        messageEl.textContent = error.message;
      }
      return;
    }
    if (action === 'confirm' || action === 'send-ticket') {
      const sendingTicket = action === 'send-ticket';
      button.disabled = true;
      button.textContent = sendingTicket ? 'Sending ticket…' : 'Confirming…';
      try {
        const result = sendingTicket
          ? await apiPost(`/${type}/${encodeURIComponent(id)}/ticket`, {})
          : await apiPut(`/${type}/${encodeURIComponent(id)}`, { status: 'confirmed' });
        noteBookingActivity(type, id);
        await refreshBooking(type, id);
        messageEl.className = result && sendingTicket && !result.emailSent ? 'text-error' : 'text-success';
        messageEl.textContent = result && sendingTicket && !result.emailSent
          ? 'The ticket email was not sent. Check the email configuration.'
          : sendingTicket
            ? 'Ticket Sent.'
            : 'Booking confirmed.';
        if (sendingTicket) closeModal();
      } catch (error) {
        button.disabled = false;
        button.textContent = sendingTicket ? 'Send Ticket' : 'Confirm';
        messageEl.className = 'text-error';
        messageEl.textContent = error.message;
      }
      return;
    }
    if (type === 'grooming' && (action === 'check-out' || action === 'send-receipt')) {
      const checkingOut = action === 'check-out';
      button.disabled = true;
      button.textContent = checkingOut ? 'Checking Out…' : 'Sending Receipt…';
      try {
        const result = await apiPost(`/grooming/${encodeURIComponent(id)}/checkout`, {});
        noteBookingActivity(type, id);
        await refreshBooking(type, id);
        closeModal();
        messageEl.className = 'text-success';
        messageEl.textContent = checkingOut
          ? result.emailSent
            ? 'Grooming appointment checked out and moved to Transaction History. Receipt sent.'
            : 'Grooming appointment checked out and moved to Transaction History. The receipt email was not sent.'
          : result.emailSent ? 'Payment receipt sent.' : (result.message || 'The payment receipt email was not sent.');
      } catch (error) {
        button.disabled = false;
        button.textContent = checkingOut ? 'Check Out' : 'Send Receipt';
        messageEl.className = 'text-error';
        messageEl.textContent = error.message;
      }
      return;
    }
    if (action === 'check-in' || action === 'check-out') {
      const status = type === 'grooming' ? 'in-progress' : action === 'check-in' ? 'checked-in' : 'checked-out';
      button.disabled = true;
      try {
        await apiPut(`/${type}/${encodeURIComponent(id)}`, { status });
        noteBookingActivity(type, id);
        await refreshBooking(type, id);
        if (type === 'hotel' && status === 'checked-out') closeModal();
        messageEl.className = 'text-success';
        messageEl.textContent = type === 'grooming' ? 'Grooming appointment checked in.' : status === 'checked-in' ? 'Pet checked in.' : 'Pet checked out.';
      } catch (error) {
        button.disabled = false;
        messageEl.className = 'text-error';
        messageEl.textContent = error.message;
      }
      return;
    }
    if (action === 'payment') {
      const paymentStatus = record.booking.paymentStatus === 'paid' ? 'unpaid' : 'paid';
      button.disabled = true;
      try {
        await apiPut(`/${type}/${encodeURIComponent(id)}`, { paymentStatus });
        noteBookingActivity(type, id);
        await refreshManageBooking(type, id);
        messageEl.className = 'text-success';
        messageEl.textContent = `${type === 'grooming' ? 'Appointment' : 'Reservation'} marked ${paymentStatus}.`;
      } catch (error) {
        button.disabled = false;
        messageEl.className = 'text-error';
        messageEl.textContent = error.message;
      }
      return;
    }
    if (action === 'cancel') {
      const label = type === 'grooming' ? 'appointment' : 'reservation';
      const verb = record.booking.status === 'pending' ? 'Reject' : 'Cancel';
      if (!window.confirm(`${verb} this ${label}?`)) return;
      button.disabled = true;
      try {
        await apiPut(`/${type}/${encodeURIComponent(id)}`, { status: 'cancelled' });
        noteBookingActivity(type, id);
        await refreshManageBooking(type, id);
        messageEl.className = 'text-success';
        messageEl.textContent = `${type === 'grooming' ? 'Grooming appointment' : 'Hotel reservation'} ${verb === 'Reject' ? 'rejected' : 'cancelled'}.`;
      } catch (error) {
        button.disabled = false;
        messageEl.className = 'text-error';
        messageEl.textContent = error.message;
      }
      return;
    }
    if (action !== 'delete' || (!isAdmin && !(canDeleteCancelledBookings && record.booking.status === 'cancelled'))) return;
    const label = type === 'grooming' ? 'appointment' : 'reservation';
    if (!window.confirm(`Permanently delete this ${label}?`)) return;
    button.disabled = true;
    try {
      await apiDelete(`/${type}/${encodeURIComponent(id)}`);
      noteBookingActivity(type, id);
      closeModal();
      removeBooking(type, id);
      messageEl.className = 'text-success';
      messageEl.textContent = `${type === 'grooming' ? 'Grooming appointment' : 'Hotel reservation'} deleted.`;
    } catch (error) {
      button.disabled = false;
      messageEl.className = 'text-error';
      messageEl.textContent = error.message;
    }
  });

  document.getElementById('refresh-appointments').addEventListener('click', () => {
    loadAppointments().catch((error) => {
      showLoadError(error);
    });
  });

  document.getElementById('refresh-reschedule-requests').addEventListener('click', () => {
    loadPendingRescheduleRequests().catch((error) => {
      rescheduleRowsEl.innerHTML = `<tr><td colspan="8" class="empty">${escapeHtml(error.message)}</td></tr>`;
    });
  });

  window.setInterval(() => {
    if (!document.hidden) {
      loadPendingRescheduleRequests().catch((error) => console.error('Unable to refresh reschedule requests:', error));
    }
  }, 10000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      loadPendingRescheduleRequests().catch((error) => console.error('Unable to refresh reschedule requests:', error));
    }
  });

  document.getElementById('new-grooming-appointment').addEventListener('click', () => {
    openNewGroomingAppointment().catch((error) => {
      messageEl.className = 'text-error';
      messageEl.textContent = error.message;
    });
  });

  loadAppointments().catch((error) => {
    showLoadError(error);
  });
})();
