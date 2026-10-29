(() => {
  renderSidebar('Dashboard');

  const groomingRows = document.getElementById('staff-grooming-rows');
  const hotelRows = document.getElementById('staff-hotel-rows');
  const pendingGroomingRows = document.getElementById('staff-pending-grooming-rows');
  const pendingHotelRows = document.getElementById('staff-pending-hotel-rows');
  const pendingArrivalsPanel = document.getElementById('staff-pending-arrivals');
  const pendingArrivalsMessage = document.getElementById('staff-pending-arrivals-message');
  const todayActiveGroomingRows = document.getElementById('staff-today-active-grooming-rows');
  const todayActiveHotelRows = document.getElementById('staff-today-active-hotel-rows');
  const upcomingGroomingRows = document.getElementById('staff-upcoming-grooming-rows');
  const upcomingHotelRows = document.getElementById('staff-upcoming-hotel-rows');
  const groomingActivityEl = document.getElementById('staff-grooming-activity');
  const hotelActivityEl = document.getElementById('staff-hotel-activity');
  const transactionHistoryRows = document.getElementById('staff-transaction-history-rows');
  const statsEl = document.getElementById('staff-stats');
  const messageEl = document.getElementById('staff-dashboard-message');
  const businessDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const bookingStatus = (item) => String(item.status || '').toLowerCase();
  const activeGrooming = (items) => items.filter((item) => !['cancelled', 'completed'].includes(bookingStatus(item)));
  const activeHotel = (items) => items.filter((item) => !['cancelled', 'checked-out'].includes(bookingStatus(item)));
  const petNames = (booking) => Array.isArray(booking.petNames) && booking.petNames.length
    ? booking.petNames.join(', ')
    : (booking.Pets || (booking.Pet ? [booking.Pet] : [])).map((pet) => pet.name).filter(Boolean).join(', ') || '—';
  const groomingService = (booking) => Array.isArray(booking.petServices) && booking.petServices.length
    ? booking.petServices.map((service) => `${service.petName || 'Pet'}: ${String(service.service || '').replace(/^grooming-/, '').replace(/-/g, ' ')}`).join('; ')
    : String(booking.service || 'Grooming').replace(/^grooming-/, '').replace(/-/g, ' ');
  const hotelRooms = (booking) => Array.isArray(booking.petRooms) && booking.petRooms.length
    ? booking.petRooms.map((item) => `${item.petName || 'Pet'}: ${String(item.roomType || '').replace(/^staycation-/, '').replace(/-/g, ' ')}`).join('; ')
    : String(booking.roomType || 'Pet Hotel').replace(/^staycation-/, '').replace(/-/g, ' ');
  const activityTime = (booking) => booking.updatedAt || booking.createdAt || booking.date || booking.checkIn;
  const renderRecentActivity = (type, items, container) => {
    const visibleItems = items
      .filter((booking) => bookingStatus(booking) !== (type === 'grooming' ? 'completed' : 'checked-out'))
      .sort((left, right) => (Date.parse(activityTime(right)) || 0) - (Date.parse(activityTime(left)) || 0))
      .slice(0, 8);
    container.innerHTML = visibleItems.length
      ? visibleItems.map((booking) => {
        const label = type === 'grooming' ? 'Grooming' : 'Pet Hotel';
        const summary = type === 'grooming'
          ? `${groomingService(booking)} for ${petNames(booking)}`
          : `${hotelRooms(booking)} for ${petNames(booking)}`;
        const schedule = type === 'grooming'
          ? `${fmtDate(booking.date)} at ${booking.time || 'Time not set'}`
          : `${fmtDate(booking.checkIn)} to ${fmtDate(booking.checkOut)}`;
        return `<a class="activity-item activity-booking-button staff-dashboard-activity-link" href="/admin/appointments.html" aria-label="View ${escapeHtml(label)} appointment">
          <span class="dot">${label}</span>
          <span><span>${escapeHtml(summary)} ${statusBadge(booking.status)}</span><span class="meta">${escapeHtml(schedule)} · ${escapeHtml(fmtDateTime(activityTime(booking)))}</span></span>
        </a>`;
      }).join('')
      : `<div class="empty">No recent ${type === 'grooming' ? 'grooming' : 'pet hotel'} activity.</div>`;
  };
  const renderTransactionHistory = (grooming, hotel) => {
    const completed = [
      ...grooming.filter((booking) => bookingStatus(booking) === 'completed').map((booking) => ({ type: 'grooming', booking })),
      ...hotel.filter((booking) => bookingStatus(booking) === 'checked-out').map((booking) => ({ type: 'hotel', booking })),
    ].sort((left, right) => {
      const leftDate = left.booking.checkedOutAt || left.booking.updatedAt || left.booking.createdAt || left.booking.date || left.booking.checkOut;
      const rightDate = right.booking.checkedOutAt || right.booking.updatedAt || right.booking.createdAt || right.booking.date || right.booking.checkOut;
      return (Date.parse(rightDate) || 0) - (Date.parse(leftDate) || 0);
    });
    transactionHistoryRows.innerHTML = completed.length
      ? completed.map(({ type, booking }) => {
        const completionDate = booking.checkedOutAt || booking.updatedAt
          || (type === 'grooming' ? booking.date : booking.checkOut);
        const amount = type === 'grooming' ? booking.price : booking.totalPrice;
        return `<tr>
          <td>${type === 'grooming' ? 'Grooming' : 'Pet Hotel'}</td>
          <td>${escapeHtml(booking.Customer?.name || booking.customerDetails?.name || '—')}</td>
          <td><span class="appointment-primary">${escapeHtml(petNames(booking))}</span><span class="appointment-detail">${escapeHtml(type === 'grooming' ? groomingService(booking) : hotelRooms(booking))}</span></td>
          <td>${escapeHtml(fmtDateTime(completionDate))}</td>
          <td>${escapeHtml(String(booking.paymentStatus || 'unpaid').replace(/-/g, ' '))}</td>
          <td>${escapeHtml(String(booking.paymentMethod || '—').toUpperCase())}</td>
          <td>${escapeHtml(fmtMoney(amount))}</td>
        </tr>`;
      }).join('')
      : '<tr><td colspan="7" class="empty">No completed transactions yet.</td></tr>';
  };
  const appointmentViewLink = '<a class="btn btn-outline btn-sm" href="/admin/appointments.html">View</a>';
  const groomingArrivalRow = (booking) => `<tr>
    <td>${escapeHtml(booking.Customer?.name || booking.customerDetails?.name || '—')}</td>
    <td>${escapeHtml(petNames(booking))}<span class="appointment-detail">${escapeHtml(groomingService(booking))}</span></td>
    <td>${escapeHtml(fmtDate(booking.date))}<span class="appointment-detail">${escapeHtml(booking.time || 'Time not set')}${booking.pickupTime ? ` · Pickup ${escapeHtml(booking.pickupTime)}` : ''}</span></td>
    <td>${statusBadge(booking.status)}</td>
    <td>${appointmentViewLink}</td>
  </tr>`;
  const hotelArrivalRow = (booking) => `<tr>
    <td>${escapeHtml(booking.Customer?.name || booking.customerDetails?.name || '—')}</td>
    <td>${escapeHtml(petNames(booking))}<span class="appointment-detail">${escapeHtml(hotelRooms(booking))}</span></td>
    <td>${escapeHtml(fmtDate(booking.checkIn))}<span class="appointment-detail">Check-in ${escapeHtml(booking.checkInTime || 'Time not set')} · Check-out ${escapeHtml(fmtDate(booking.checkOut))}</span></td>
    <td>${statusBadge(booking.status)}</td>
    <td>${appointmentViewLink}</td>
  </tr>`;
  const statCard = (label, value, color, href = '/admin/appointments.html', valueId = '') => `
    <a class="stat-card stat-card-link" href="${href}" aria-label="View ${escapeHtml(label)} in appointments">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value ${color}"${valueId ? ` id="${valueId}"` : ''}>${value}</div>
      <span class="stat-card-hint" aria-hidden="true">View appointments →</span>
    </a>`;
  const revenuePeriods = { daily: 'Last 7 days', weekly: 'Last 8 weeks', monthly: 'Last 6 months', yearly: 'Last 5 years' };
  let revenueAnalyticsData = null;
  const scheduleIdle = (callback) => {
    if (window.requestIdleCallback) window.requestIdleCallback(callback, { timeout: 1500 });
    else window.setTimeout(callback, 300);
  };

  const loadRevenue = async () => {
    const selectedPeriod = document.querySelector('#staff-revenue .revenue-periods button[aria-pressed="true"]')?.dataset.period || 'monthly';
    const data = await apiGet(`/admin/revenue-analytics?period=${selectedPeriod}`);
    revenueAnalyticsData = data;
    document.getElementById('staff-revenue-period-label').textContent = revenuePeriods[data.period] || revenuePeriods.monthly;
    document.getElementById('staff-revenue-combined').textContent = `Total revenue (Grooming + Hotel + Walk-in): ${fmtMoney(data.totals.combined)}`;
    const groomingTotal = (data.grooming || []).reduce((total, bucket) => total + Number(bucket.revenue || 0), 0);
    const hotelTotal = (data.hotel || []).reduce((total, bucket) => total + Number(bucket.revenue || 0), 0);
    document.getElementById('staff-grooming-revenue-total').textContent = fmtMoney(groomingTotal);
    document.getElementById('staff-hotel-revenue-total').textContent = fmtMoney(hotelTotal);
    document.getElementById('staff-grooming-revenue-chart').innerHTML = window.renderRevenueLineChart(data.grooming || []);
    document.getElementById('staff-hotel-revenue-chart').innerHTML = window.renderRevenueLineChart(data.hotel || []);
    const walkInBuckets = data.walkIn || [];
    document.getElementById('staff-walk-in-revenue-total').textContent = fmtMoney(data.totals.walkIn || 0);
    document.getElementById('staff-walk-in-revenue-chart').innerHTML = window.renderRevenueLineChart(walkInBuckets, {
      countLabel: 'sales', ariaLabel: 'Walk-in sales by period',
    });
    const groomingServices = data.groomingServices || [];
    const hotelServices = data.hotelServices || [];
    document.getElementById('staff-grooming-service-total').textContent = fmtMoney(groomingServices.reduce((sum, entry) => sum + Number(entry.revenue || 0), 0));
    document.getElementById('staff-hotel-service-total').textContent = fmtMoney(hotelServices.reduce((sum, entry) => sum + Number(entry.revenue || 0), 0));
    document.getElementById('staff-grooming-service-chart').innerHTML = window.renderRevenueLineChart(groomingServices, {
      countLabel: 'services', ariaLabel: 'Sales by grooming service', wrapLabels: true,
    });
    document.getElementById('staff-hotel-service-chart').innerHTML = window.renderRevenueLineChart(hotelServices, {
      countLabel: 'room assignments', ariaLabel: 'Sales by hotel room', wrapLabels: true,
    });
    const walkInServices = data.walkInServices || [];
    document.getElementById('staff-walk-in-service-total').textContent = fmtMoney(walkInServices.reduce((sum, entry) => sum + Number(entry.revenue || 0), 0));
    document.getElementById('staff-walk-in-service-chart').innerHTML = window.renderRevenueLineChart(walkInServices, {
      countLabel: 'items', ariaLabel: 'Sales by walk-in category', wrapLabels: true,
    });
  };

  const exportRevenuePdf = () => {
    if (!revenueAnalyticsData || !window.exportRevenueSalesPdf) {
      alert('PDF export is unavailable right now. Please refresh and try again.');
      return;
    }
    try {
      window.exportRevenueSalesPdf(revenueAnalyticsData);
    } catch (error) {
      console.error('Unable to export revenue PDF:', error);
      alert('Unable to export the PDF at the moment. Please try again.');
    }
  };

  const revenuePeriodControls = document.querySelector('#staff-revenue .revenue-periods');
  revenuePeriodControls.addEventListener('click', (event) => {
    const button = event.target.closest('[data-period]');
    if (!button) return;
    revenuePeriodControls.querySelectorAll('button').forEach((option) => {
      option.setAttribute('aria-pressed', String(option === button));
    });
    loadRevenue().catch((error) => {
      messageEl.className = 'text-error';
      messageEl.textContent = `Unable to load revenue analytics: ${error.message}`;
    });
  });
  document.getElementById('staff-export-revenue').addEventListener('click', exportRevenuePdf);

  const loadDashboard = async () => {
    const [grooming, hotel] = await Promise.all([apiGet('/grooming'), apiGet('/hotel')]);
    const groomingBookings = activeGrooming(grooming);
    const hotelBookings = activeHotel(hotel);
    renderRecentActivity('grooming', grooming, groomingActivityEl);
    renderRecentActivity('hotel', hotel, hotelActivityEl);
    renderTransactionHistory(grooming, hotel);
    const pendingGroomingToday = grooming.filter((booking) => booking.date === businessDate
      && String(booking.status || '').toLowerCase() === 'pending');
    const pendingHotelToday = hotel.filter((booking) => booking.checkIn === businessDate
      && String(booking.status || '').toLowerCase() === 'pending');
    const groomingToday = grooming.filter((booking) => booking.date === businessDate
      && ['pending', 'scheduled', 'confirmed', 'in-progress'].includes(String(booking.status || '').toLowerCase()));
    const upcomingGrooming = groomingBookings
      .filter((booking) => String(booking.date || '') >= businessDate)
      .sort((left, right) => String(left.date).localeCompare(String(right.date))
        || String(left.time || '').localeCompare(String(right.time || '')));
    const nextGrooming = upcomingGrooming.slice(0, 8);
    const hotelStays = hotelBookings
      .filter((booking) => String(booking.checkOut || '') >= businessDate)
      .sort((left, right) => String(left.checkIn).localeCompare(String(right.checkIn)))
      .slice(0, 8);
    const upcomingHotelArrivals = hotelBookings
      .filter((booking) => ['pending', 'reserved', 'confirmed'].includes(booking.status)
        && String(booking.checkIn || '') >= businessDate)
      .sort((left, right) => String(left.checkIn || '').localeCompare(String(right.checkIn || ''))
        || String(left.checkInTime || '').localeCompare(String(right.checkInTime || '')));
      const todaysHotelArrivals = upcomingHotelArrivals.filter((booking) => booking.checkIn === businessDate);
    statsEl.innerHTML = [
      statCard("Today's Active Appointment Arrivals", groomingToday.length + todaysHotelArrivals.length, 'green', '#staff-today-active-arrivals'),
      statCard('Pending Appointment Arrivals', pendingGroomingToday.length + pendingHotelToday.length, 'orange', '#staff-pending-arrivals', 'staff-pending-arrivals-count'),
      statCard('Upcoming Arrivals', upcomingGrooming.length + upcomingHotelArrivals.length, 'orange', '/admin/grooming.html?filter=upcoming'),
    ].join('');

    pendingGroomingRows.innerHTML = pendingGroomingToday.length
      ? pendingGroomingToday
        .sort((left, right) => String(left.time || '').localeCompare(String(right.time || '')))
        .map((booking) => `
          <tr>
            <td>${escapeHtml(booking.Customer?.name || booking.customerDetails?.name || '—')}</td>
            <td>${escapeHtml(petNames(booking))}<span class="dashboard-booking-subtext">${escapeHtml(groomingService(booking))}</span></td>
            <td>${escapeHtml(fmtDate(booking.date))}<span class="dashboard-booking-subtext">${escapeHtml(booking.time || 'Time not set')}${booking.pickupTime ? ` · Pickup ${escapeHtml(booking.pickupTime)}` : ''}</span></td>
            <td>${statusBadge(booking.status)}</td>
            <td><button class="btn btn-success btn-sm" type="button" data-confirm-arrival data-booking-type="grooming" data-booking-id="${escapeHtml(booking.id)}">Confirm</button></td>
          </tr>`).join('')
      : '<tr><td colspan="5" class="empty">No pending grooming arrivals today.</td></tr>';

    pendingHotelRows.innerHTML = pendingHotelToday.length
      ? pendingHotelToday
        .sort((left, right) => String(left.checkInTime || '').localeCompare(String(right.checkInTime || '')))
        .map((booking) => {
          const rooms = Array.isArray(booking.petRooms) && booking.petRooms.length
            ? booking.petRooms.map((item) => `${item.petName || 'Pet'}: ${String(item.roomType || '').replace(/^staycation-/, '').replace(/-/g, ' ')}`).join('; ')
            : String(booking.roomType || 'Pet Hotel').replace(/^staycation-/, '').replace(/-/g, ' ');
          return `
            <tr>
              <td>${escapeHtml(booking.Customer?.name || booking.customerDetails?.name || '—')}</td>
              <td>${escapeHtml(petNames(booking))}<span class="dashboard-booking-subtext">${escapeHtml(rooms)}</span></td>
              <td>${escapeHtml(fmtDate(booking.checkIn))}<span class="dashboard-booking-subtext">Check-in ${escapeHtml(booking.checkInTime || 'Time not set')} · Check-out ${escapeHtml(fmtDate(booking.checkOut))}</span></td>
              <td>${statusBadge(booking.status)}</td>
              <td><button class="btn btn-success btn-sm" type="button" data-confirm-arrival data-booking-type="hotel" data-booking-id="${escapeHtml(booking.id)}">Confirm</button></td>
            </tr>`;
        }).join('')
      : '<tr><td colspan="5" class="empty">No pending pet hotel arrivals today.</td></tr>';

    todayActiveGroomingRows.innerHTML = groomingToday.length
      ? groomingToday.sort((left, right) => String(left.time || '').localeCompare(String(right.time || '')))
        .map(groomingArrivalRow).join('')
      : '<tr><td colspan="5" class="empty">No active grooming appointments today.</td></tr>';
    todayActiveHotelRows.innerHTML = todaysHotelArrivals.length
      ? todaysHotelArrivals.map(hotelArrivalRow).join('')
      : '<tr><td colspan="5" class="empty">No active pet hotel arrivals today.</td></tr>';
    upcomingGroomingRows.innerHTML = upcomingGrooming.length
      ? upcomingGrooming.map(groomingArrivalRow).join('')
      : '<tr><td colspan="5" class="empty">No upcoming grooming appointments.</td></tr>';
    upcomingHotelRows.innerHTML = upcomingHotelArrivals.length
      ? upcomingHotelArrivals.map(hotelArrivalRow).join('')
      : '<tr><td colspan="5" class="empty">No upcoming pet hotel arrivals.</td></tr>';

    groomingRows.innerHTML = nextGrooming.length
      ? nextGrooming.map((booking) => `
        <tr>
          <td>${fmtDate(booking.date)}</td>
          <td>${escapeHtml(booking.time || '—')}</td>
          <td>${escapeHtml(booking.Customer?.name || booking.customerDetails?.name || '—')}</td>
          <td>${escapeHtml(petNames(booking))}</td>
          <td>${escapeHtml(groomingService(booking))}</td>
        </tr>`).join('')
      : '<tr><td colspan="5" class="empty">No upcoming grooming appointments.</td></tr>';

    hotelRows.innerHTML = hotelStays.length
      ? hotelStays.map((booking) => `
        <tr>
          <td>${fmtDate(booking.checkIn)}</td>
          <td>${fmtDate(booking.checkOut)}</td>
          <td>${escapeHtml(booking.Customer?.name || booking.customerDetails?.name || '—')}</td>
          <td>${escapeHtml(petNames(booking))}</td>
        </tr>`).join('')
      : '<tr><td colspan="4" class="empty">No current guests or upcoming hotel stays.</td></tr>';
    messageEl.textContent = `Schedule refreshed ${new Date().toLocaleTimeString()}.`;
  };

  pendingArrivalsPanel.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-confirm-arrival]');
    if (!button) return;
    const bookingId = button.dataset.bookingId;
    button.disabled = true;
    button.textContent = 'Confirming…';
    try {
      await apiPut(`/${button.dataset.bookingType}/${encodeURIComponent(bookingId)}`, { status: 'confirmed' });
      await loadDashboard();
      pendingArrivalsMessage.className = 'text-success';
      pendingArrivalsMessage.textContent = 'Appointment confirmed and added to today’s active schedule.';
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Confirm';
      pendingArrivalsMessage.className = 'text-error';
      pendingArrivalsMessage.textContent = error.message;
    }
  });

  document.getElementById('staff-refresh-pending-arrivals').addEventListener('click', () => {
    loadDashboard().catch((error) => {
      pendingArrivalsMessage.className = 'text-error';
      pendingArrivalsMessage.textContent = `Unable to refresh pending appointment arrivals: ${error.message}`;
    });
  });

  const loadStaffRevenueWhenIdle = () => scheduleIdle(() => {
    loadRevenue().catch((error) => {
      document.getElementById('staff-revenue-combined').textContent = `Unable to load revenue analytics: ${error.message}`;
    });
  });
  const initialDashboardLoad = loadDashboard();
  initialDashboardLoad.catch((error) => {
    statsEl.innerHTML = `<div class="alert alert-error show">${escapeHtml(error.message)}</div>`;
    groomingRows.innerHTML = `<tr><td colspan="5" class="empty">${escapeHtml(error.message)}</td></tr>`;
    hotelRows.innerHTML = `<tr><td colspan="4" class="empty">${escapeHtml(error.message)}</td></tr>`;
    pendingGroomingRows.innerHTML = `<tr><td colspan="5" class="empty">${escapeHtml(error.message)}</td></tr>`;
    pendingHotelRows.innerHTML = `<tr><td colspan="5" class="empty">${escapeHtml(error.message)}</td></tr>`;
    pendingArrivalsMessage.className = 'text-error';
    pendingArrivalsMessage.textContent = 'Unable to load pending appointment arrivals.';
  });
  initialDashboardLoad.then(loadStaffRevenueWhenIdle, loadStaffRevenueWhenIdle);
  window.setInterval(() => {
    if (!document.hidden) {
      loadDashboard().catch((error) => {
        console.error('Unable to refresh staff dashboard:', error);
        messageEl.className = 'text-error';
        messageEl.textContent = `Unable to refresh dashboard: ${error.message}`;
      });
    }
  }, 30000);
})();
