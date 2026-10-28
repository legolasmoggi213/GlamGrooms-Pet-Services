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
    if (!revenueAnalyticsData || !window.jspdf) {
      alert('PDF export is unavailable right now. Please refresh and try again.');
      return;
    }
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('l', 'mm', 'a4');
    const period = revenueAnalyticsData.period || 'monthly';
    const margin = 14;
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    let y = 16;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(18);
    pdf.text('Revenue & Sales Report', margin, y);
    y += 7;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.text(`${revenuePeriods[period] || period} · Generated ${new Date().toLocaleString()}`, margin, y);
    y += 9;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.text(`Grooming: ${fmtMoney(revenueAnalyticsData.totals.grooming)}    Hotel: ${fmtMoney(revenueAnalyticsData.totals.hotel)}    Combined: ${fmtMoney(revenueAnalyticsData.totals.combined)}`, margin, y);
    y += 10;

    const drawTable = (title, rows) => {
      const widths = [pageWidth - margin * 2 - 100, 30, 70];
      const drawHeader = () => {
        pdf.setFillColor(32, 45, 50);
        pdf.rect(margin, y - 5, pageWidth - margin * 2, 8, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        pdf.setTextColor(255, 255, 255);
        pdf.text('Service / period', margin + 2, y);
        pdf.text('Count', margin + widths[0] + 2, y);
        pdf.text('Revenue', margin + widths[0] + widths[1] + 2, y);
        pdf.setTextColor(37, 50, 56);
        pdf.setFont('helvetica', 'normal');
        y += 7;
      };
      const newPage = () => {
        pdf.addPage();
        y = 16;
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(12);
        pdf.text(title, margin, y);
        y += 8;
        drawHeader();
      };
      if (y + 22 > pageHeight - margin) newPage();
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      pdf.text(title, margin, y);
      y += 8;
      drawHeader();
      rows.forEach((row) => {
        const labelLines = pdf.splitTextToSize(String(row[0]), widths[0] - 4);
        const rowHeight = Math.max(7, labelLines.length * 4 + 2);
        if (y + rowHeight > pageHeight - margin) newPage();
        pdf.setFontSize(8);
        pdf.text(labelLines, margin + 2, y);
        pdf.text(String(row[1]), margin + widths[0] + 2, y);
        pdf.text(String(row[2]), margin + widths[0] + widths[1] + 2, y);
        y += rowHeight;
      });
      y += 6;
    };

    const periods = (revenueAnalyticsData.grooming || []).map((bucket, index) => {
      const hotel = revenueAnalyticsData.hotel?.[index] || {};
      return [bucket.label, `${Number(bucket.count || 0)} / ${Number(hotel.count || 0)}`, fmtMoney(Number(bucket.revenue || 0) + Number(hotel.revenue || 0))];
    });
    drawTable('Revenue by period (Grooming / Hotel counts)', periods);
    drawTable('Grooming service sales', (revenueAnalyticsData.groomingServices || []).map((entry) => [entry.label, entry.count, fmtMoney(entry.revenue)]));
    drawTable('Hotel room sales', (revenueAnalyticsData.hotelServices || []).map((entry) => [entry.label, entry.count, fmtMoney(entry.revenue)]));
    pdf.save(`revenue-sales-report-${period}.pdf`);
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
    const hotelGuests = hotelBookings.filter((booking) => booking.status === 'checked-in'
      && String(booking.checkIn || '') <= businessDate
      && String(booking.checkOut || '') >= businessDate);

    statsEl.innerHTML = [
      statCard("Today's Grooming", groomingToday.length, 'green'),
      statCard('Upcoming Grooming', upcomingGrooming.length, 'green'),
      statCard('Current Hotel Guests', hotelGuests.length, 'orange'),
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
