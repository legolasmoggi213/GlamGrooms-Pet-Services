(() => {
  renderSidebar('Dashboard');

  const groomingRows = document.getElementById('staff-grooming-rows');
  const hotelRows = document.getElementById('staff-hotel-rows');
  const pendingGroomingRows = document.getElementById('staff-pending-grooming-rows');
  const upcomingArrivalRows = document.getElementById('staff-upcoming-arrivals-rows');
  const statsEl = document.getElementById('staff-stats');
  const messageEl = document.getElementById('staff-dashboard-message');
  const businessDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const activeGrooming = (items) => items.filter((item) => !['cancelled', 'completed'].includes(item.status));
  const activeHotel = (items) => items.filter((item) => !['cancelled', 'checked-out'].includes(item.status));
  const petNames = (booking) => Array.isArray(booking.petNames) && booking.petNames.length
    ? booking.petNames.join(', ')
    : (booking.Pets || (booking.Pet ? [booking.Pet] : [])).map((pet) => pet.name).filter(Boolean).join(', ') || '—';
  const groomingService = (booking) => Array.isArray(booking.petServices) && booking.petServices.length
    ? booking.petServices.map((service) => `${service.petName || 'Pet'}: ${String(service.service || '').replace(/^grooming-/, '').replace(/-/g, ' ')}`).join('; ')
    : String(booking.service || 'Grooming').replace(/^grooming-/, '').replace(/-/g, ' ');
  const statCard = (label, value, color, href = '/admin/appointments.html', valueId = '') => `
    <a class="stat-card stat-card-link" href="${href}" aria-label="View ${escapeHtml(label)} in appointments">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value ${color}"${valueId ? ` id="${valueId}"` : ''}>${value}</div>
      <span class="stat-card-hint" aria-hidden="true">View appointments →</span>
    </a>`;
  const revenuePeriods = { daily: 'Last 7 days', weekly: 'Last 8 weeks', monthly: 'Last 6 months', yearly: 'Last 5 years' };
  let revenueAnalyticsData = null;

  const loadRevenue = async () => {
    const selectedPeriod = document.querySelector('#staff-revenue .revenue-periods button[aria-pressed="true"]')?.dataset.period || 'monthly';
    const data = await apiGet(`/admin/revenue-analytics?period=${selectedPeriod}`);
    revenueAnalyticsData = data;
    document.getElementById('staff-revenue-period-label').textContent = revenuePeriods[data.period] || revenuePeriods.monthly;
    document.getElementById('staff-revenue-combined').textContent = `Combined revenue: ${fmtMoney(data.totals.combined)}`;
    const groomingTotal = (data.grooming || []).reduce((total, bucket) => total + Number(bucket.revenue || 0), 0);
    const hotelTotal = (data.hotel || []).reduce((total, bucket) => total + Number(bucket.revenue || 0), 0);
    document.getElementById('staff-grooming-revenue-total').textContent = fmtMoney(groomingTotal);
    document.getElementById('staff-hotel-revenue-total').textContent = fmtMoney(hotelTotal);
    document.getElementById('staff-grooming-revenue-chart').innerHTML = window.renderRevenueLineChart(data.grooming || []);
    document.getElementById('staff-hotel-revenue-chart').innerHTML = window.renderRevenueLineChart(data.hotel || []);
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
  loadRevenue().catch((error) => {
    document.getElementById('staff-revenue-combined').textContent = `Unable to load revenue analytics: ${error.message}`;
  });

  const loadDashboard = async () => {
    const [grooming, hotel] = await Promise.all([apiGet('/grooming'), apiGet('/hotel')]);
    const groomingBookings = activeGrooming(grooming);
    const hotelBookings = activeHotel(hotel);
    const pendingGroomingToday = grooming.filter((booking) => booking.date === businessDate && booking.status === 'pending');
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
      statCard("Today's Active Arrivals", groomingToday.length + todaysHotelArrivals.length, 'green', '/admin/grooming.html?filter=today'),
      statCard('Pending Grooming Arrivals', pendingGroomingToday.length, 'orange', '#staff-pending-grooming', 'staff-pending-grooming-count'),
      statCard('Upcoming Arrivals', upcomingGrooming.length + upcomingHotelArrivals.length, 'orange'),
    ].join('');

    pendingGroomingRows.innerHTML = pendingGroomingToday.length
      ? pendingGroomingToday
        .sort((left, right) => String(left.time || '').localeCompare(String(right.time || '')))
        .map((booking) => `
          <tr>
            <td>${escapeHtml(booking.time || '—')}</td>
            <td>${escapeHtml(booking.Customer?.name || booking.customerDetails?.name || '—')}</td>
            <td>${escapeHtml(petNames(booking))}</td>
            <td>${escapeHtml(groomingService(booking))}</td>
            <td>${escapeHtml(booking.pickupTime || '—')}</td>
            <td>${escapeHtml(booking.Customer?.phone || booking.customerDetails?.phone || '—')}</td>
            <td><button class="btn btn-success btn-sm" type="button" data-confirm-grooming="${escapeHtml(booking.id)}">Confirm</button></td>
          </tr>`).join('')
      : '<tr><td colspan="7" class="empty">No pending Grooming arrivals today.</td></tr>';

    const upcomingArrivals = [
      ...upcomingGrooming.map((booking) => ({
        type: 'Grooming',
        date: String(booking.date || ''),
        time: String(booking.time || ''),
        customer: booking.Customer?.name || booking.customerDetails?.name || '—',
        pets: petNames(booking),
        detail: groomingService(booking),
        schedule: `${fmtDate(booking.date)} at ${booking.time || 'Time not set'}${booking.pickupTime ? ` · Pickup ${booking.pickupTime}` : ''}`,
      })),
      ...upcomingHotelArrivals.map((booking) => ({
        type: 'Pet Hotel',
        date: String(booking.checkIn || ''),
        time: String(booking.checkInTime || ''),
        customer: booking.Customer?.name || booking.customerDetails?.name || '—',
        pets: petNames(booking),
        detail: Array.isArray(booking.petRooms) && booking.petRooms.length
          ? booking.petRooms.map((item) => `${item.petName || 'Pet'}: ${String(item.roomType || '').replace(/^staycation-/, '').replace(/-/g, ' ')}`).join('; ')
          : String(booking.roomType || 'Pet Hotel').replace(/^staycation-/, '').replace(/-/g, ' '),
        schedule: `Check-in: ${fmtDate(booking.checkIn)} ${booking.checkInTime || ''} · Check-out: ${fmtDate(booking.checkOut)} ${booking.checkOutTime || ''}`,
      })),
    ].sort((left, right) => left.date.localeCompare(right.date) || left.time.localeCompare(right.time));
    upcomingArrivalRows.innerHTML = upcomingArrivals.length
      ? upcomingArrivals.map((arrival) => `<tr>
        <td>${arrival.type}</td>
        <td>${escapeHtml(arrival.customer)}</td>
        <td><span class="appointment-primary">${escapeHtml(arrival.pets)}</span><span class="appointment-detail">${escapeHtml(arrival.detail)}</span></td>
        <td>${escapeHtml(arrival.schedule)}</td>
      </tr>`).join('')
      : '<tr><td colspan="4" class="empty">No upcoming grooming appointments or pet hotel arrivals.</td></tr>';

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

  pendingGroomingRows.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-confirm-grooming]');
    if (!button) return;
    const bookingId = button.dataset.confirmGrooming;
    button.disabled = true;
    button.textContent = 'Confirming…';
    try {
      await apiPut(`/grooming/${encodeURIComponent(bookingId)}`, { status: 'confirmed' });
      button.closest('tr')?.remove();
      if (!pendingGroomingRows.querySelector('tr')) {
        pendingGroomingRows.innerHTML = '<tr><td colspan="7" class="empty">No pending Grooming arrivals today.</td></tr>';
      }
      const pendingCount = document.getElementById('staff-pending-grooming-count');
      if (pendingCount) pendingCount.textContent = String(Math.max(0, Number(pendingCount.textContent) - 1));
      messageEl.className = 'text-success';
      messageEl.textContent = 'Grooming appointment confirmed and added to today’s active schedule.';
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Confirm';
      messageEl.className = 'text-error';
      messageEl.textContent = error.message;
    }
  });

  document.getElementById('staff-refresh-pending-grooming').addEventListener('click', () => {
    loadDashboard().catch((error) => {
      messageEl.className = 'text-error';
      messageEl.textContent = `Unable to refresh pending Grooming arrivals: ${error.message}`;
    });
  });

  loadDashboard().catch((error) => {
    statsEl.innerHTML = `<div class="alert alert-error show">${escapeHtml(error.message)}</div>`;
    groomingRows.innerHTML = `<tr><td colspan="5" class="empty">${escapeHtml(error.message)}</td></tr>`;
    hotelRows.innerHTML = `<tr><td colspan="5" class="empty">${escapeHtml(error.message)}</td></tr>`;
  });
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
