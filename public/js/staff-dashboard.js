(() => {
  renderSidebar('Dashboard');

  const groomingRows = document.getElementById('staff-grooming-rows');
  const hotelRows = document.getElementById('staff-hotel-rows');
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
  const statCard = (label, value, color) => `
    <a class="stat-card stat-card-link" href="/admin/appointments.html" aria-label="View ${escapeHtml(label)} in appointments">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value ${color}">${value}</div>
      <span class="stat-card-hint" aria-hidden="true">View appointments →</span>
    </a>`;
  const revenuePeriods = { daily: 'Last 7 days', weekly: 'Last 8 weeks', monthly: 'Last 6 months', yearly: 'Last 5 years' };
  let revenueAnalyticsData = null;

  const renderServiceChart = (entries) => {
    const active = (entries || []).filter((entry) => Number(entry.revenue) || Number(entry.count));
    const maximum = Math.max(0, ...active.map((entry) => Number(entry.revenue) || 0));
    return active.length ? active.map((entry) => {
      const value = Number(entry.revenue) || 0;
      const height = maximum ? Math.max(value ? 4 : 0, (value / maximum) * 100) : 0;
      return `<div class="revenue-bar-column" title="${escapeHtml(`${entry.label}: ${fmtMoney(value)}, ${entry.count} bookings or pets served`)}">
        <span class="revenue-bar-value">${value ? fmtMoney(value) : '—'}</span>
        <div class="revenue-bar-track"><div class="revenue-bar" style="height:${height}%"></div></div>
        <span class="revenue-bar-label revenue-service-label">${escapeHtml(entry.label)}</span>
        <span class="revenue-bar-count">${Number(entry.count) || 0}</span>
      </div>`;
    }).join('') : '<div class="empty">No service sales in this period.</div>';
  };

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
    document.getElementById('staff-grooming-service-chart').innerHTML = renderServiceChart(groomingServices);
    document.getElementById('staff-hotel-service-chart').innerHTML = renderServiceChart(hotelServices);
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
    const groomingToday = groomingBookings.filter((booking) => booking.date === businessDate);
    const upcomingGrooming = groomingBookings
      .filter((booking) => String(booking.date || '') >= businessDate)
      .sort((left, right) => String(left.date).localeCompare(String(right.date))
        || String(left.time || '').localeCompare(String(right.time || '')));
    const nextGrooming = upcomingGrooming.slice(0, 8);
    const hotelStays = hotelBookings
      .filter((booking) => String(booking.checkOut || '') >= businessDate)
      .sort((left, right) => String(left.checkIn).localeCompare(String(right.checkIn)))
      .slice(0, 8);
    statsEl.innerHTML = [
      statCard("Today's Grooming", groomingToday.length, 'green'),
      statCard('Upcoming Grooming', upcomingGrooming.length, 'green'),
      statCard('Upcoming Hotel Stays', hotelBookings.filter((booking) => ['pending', 'reserved', 'confirmed'].includes(booking.status)
        && String(booking.checkIn || '') >= businessDate).length, 'orange'),
    ].join('');

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
          <td>${statusBadge(booking.status)}</td>
        </tr>`).join('')
      : '<tr><td colspan="5" class="empty">No current guests or upcoming hotel stays.</td></tr>';
    messageEl.textContent = `Schedule refreshed ${new Date().toLocaleTimeString()}.`;
  };

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
