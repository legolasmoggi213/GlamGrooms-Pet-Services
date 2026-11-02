// Shared admin helpers: sidebar injection + modal utilities.

const ADMIN_PAGES = [
  { href: '/admin/index.html', label: 'Dashboard' },
  { href: '/admin/appointments.html', label: 'Appointments' },
  { href: '/admin/notifications.html', label: 'Notifications' },
  { href: '/admin/reports.html', label: 'Reports' },
  { href: '/admin/customers.html', label: 'Customers' },
  { href: '/admin/pets.html', label: 'Pets' },
  { href: '/admin/pos.html', label: 'Counter Checkout' },
  { href: '/admin/staff.html', label: 'Employees' },
  { href: '/admin/change-password.html', label: 'Change Password' },
];

const STAFF_PAGES = [
  { href: '/admin/staff-dashboard.html', label: 'Dashboard' },
  { href: '/admin/appointments.html', label: 'Appointments' },
  ...ADMIN_PAGES.filter((page) => ['Customers', 'Pets', 'Notifications', 'Reports'].includes(page.label)),
];

function renderSidebar(activeLabel) {
  const sidebar = document.getElementById('sidebar');
  const renderLinks = (pages) => {
    const links = pages.map((page) =>
      `<a href="${page.href}" class="${page.label === activeLabel ? 'active' : ''}">${page.label === 'Notifications' ? 'Notifications <span class="admin-notification-count" data-notification-count hidden></span>' : page.label}</a>`
    ).join('');
    sidebar.innerHTML = `
      <a class="brand" href="${pages === STAFF_PAGES ? '/admin/staff-dashboard.html' : '/admin/index.html'}">Glam Grooms Pet Spa & Hotel</a>
      ${links}
      <a href="/admin/logout" style="margin-top:0.6rem;color:var(--danger);">Logout</a>
    `;
  };
  renderLinks(STAFF_PAGES);
  fetch('/admin/nav-status', { credentials: 'include', cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`Navigation authorization failed (${response.status}).`);
      return response.json();
    })
    .then(({ authenticated, role }) => {
      if (!authenticated) {
        window.location.href = '/admin/login.html';
        return;
      }
      const pages = role === 'STAFF' ? STAFF_PAGES : ADMIN_PAGES;
      renderLinks(pages);
      if (pages.some((page) => page.label === 'Notifications')) {
        const refreshNotificationCount = async () => {
          try {
            const notifications = await apiGet('/notifications');
            const unreadCount = notifications.filter((notification) => !notification.read).length;
            const badge = sidebar.querySelector('[data-notification-count]');
            if (!badge) return;
            badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
            badge.hidden = unreadCount === 0;
          } catch (error) {
            console.warn('Unable to refresh notification count:', error);
          }
        };
        refreshNotificationCount();
        if (!window.adminNotificationRefreshTimer) {
          window.adminNotificationRefreshTimer = window.setInterval(() => {
            if (!document.hidden) refreshNotificationCount();
          }, 10000);
          document.addEventListener('visibilitychange', () => {
            if (!document.hidden) refreshNotificationCount();
          });
        }
      }
    })
    .catch((error) => {
      console.error('Unable to load role-based navigation:', error);
      sidebar.innerHTML = '<div class="alert alert-error show">Unable to load navigation. Please sign in again.</div>';
    });
}

function showAdminNotice(message, type = 'success') {
  let notice = document.getElementById('admin-action-notice');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'admin-action-notice';
    notice.className = 'alert';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    const main = document.querySelector('.admin-main');
    if (main) main.prepend(notice);
  }
  notice.className = `alert alert-${type} show`;
  notice.textContent = message;
}

document.addEventListener('click', (event) => {
  const logoutLink = event.target.closest('[data-confirm-logout]');
  if (logoutLink && !window.confirm('Are you sure you want to log out?')) {
    event.preventDefault();
  }
});

function openModal(title, bodyHtml) {
  let backdrop = document.getElementById('modal-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'modal-backdrop';
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = '<div class="modal"><h3 id="modal-title"></h3><div id="modal-body"></div></div>';
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });
  }
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  backdrop.classList.add('open');
}

function closeModal() {
  const backdrop = document.getElementById('modal-backdrop');
  if (backdrop) backdrop.classList.remove('open');
}

function openRevenueCustomersModal(bookings, service, paymentType) {
  const isOnlinePayment = paymentType === 'online';
  const paymentLabel = isOnlinePayment ? 'ONLINE PAYMENT' : 'CASH';
  const paidBookings = bookings
    .filter((booking) => String(booking.paymentStatus || '').toLowerCase() === 'paid'
      && (isOnlinePayment
        ? String(booking.paymentMethod || '').toLowerCase() === 'qrph'
        : String(booking.paymentMethod || 'cash').toLowerCase() !== 'qrph'))
    .sort((left, right) => (Date.parse(right.paymentPaidAt || '') || 0) - (Date.parse(left.paymentPaidAt || '') || 0));
  const rows = paidBookings.length
    ? paidBookings.map((booking) => {
      const petNames = Array.isArray(booking.petNames) && booking.petNames.length
        ? booking.petNames.join(', ')
        : (booking.Pets || (booking.Pet ? [booking.Pet] : [])).map((pet) => pet.name).filter(Boolean).join(', ') || '—';
      const serviceDetails = service === 'grooming'
        ? (Array.isArray(booking.petServices) && booking.petServices.length
          ? booking.petServices.map((item) => `${item.petName || 'Pet'}: ${String(item.service || '').replace(/^grooming-/, '').replace(/-/g, ' ')}`).join('; ')
          : String(booking.service || 'Grooming').replace(/^grooming-/, '').replace(/-/g, ' '))
        : (Array.isArray(booking.petRooms) && booking.petRooms.length
          ? booking.petRooms.map((item) => `${item.petName || 'Pet'}: ${String(item.roomType || '').replace(/^staycation-/, '').replace(/-/g, ' ')}`).join('; ')
          : String(booking.roomType || 'Pet Hotel').replace(/^staycation-/, '').replace(/-/g, ' '));
      const bookingDate = booking.paymentPaidAt || (service === 'grooming' ? booking.date : booking.checkIn);
      const amount = service === 'grooming' ? booking.price : booking.totalPrice;
      return `<tr>
        <td>${escapeHtml(booking.Customer?.name || booking.customerDetails?.name || '—')}</td>
        <td>${escapeHtml(petNames)}</td>
        <td>${escapeHtml(serviceDetails)}</td>
        <td>${escapeHtml(bookingDate ? fmtDateTime(bookingDate) : '—')}</td>
        <td>${escapeHtml(fmtMoney(amount))}</td>
      </tr>`;
    }).join('')
    : `<tr><td colspan="5" class="empty">No paid ${service} bookings found for ${paymentLabel}.</td></tr>`;
  const serviceLabel = service === 'grooming' ? 'Grooming' : 'Pet Hotel';
  openModal(`${serviceLabel} Revenue (${paymentLabel})`, `
    <div class="revenue-customers-list">
      <p class="text-muted">${paidBookings.length} paid booking${paidBookings.length === 1 ? '' : 's'}.</p>
      <div class="table-wrap">
        <table class="appointments-table revenue-customers-table">
          <thead><tr><th>Customer</th><th>Pet(s)</th><th>Service / Room</th><th>Paid / Booking Date</th><th>Amount</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`);
}

function renderHotelOccupancy(days, container) {
  if (!Array.isArray(days) || !days.length) {
    container.innerHTML = '<div class="empty">No occupancy data available.</div>';
    return;
  }

  container.innerHTML = `<div class="occupancy-days">${days.map((day) => {
    const bookings = Array.isArray(day.bookings) ? day.bookings : [];
    const capacity = Math.max(1, Number(day.capacity) || 35);
    const occupiedPets = Math.max(0, Number(day.occupiedPets) || 0);
    const occupancyPercent = Math.round(occupiedPets / capacity * 100);
    const statusText = occupancyPercent >= 100 ? 'At capacity' : bookings.length ? 'Occupied' : 'Available';
    const statusClass = occupancyPercent >= 100 ? 'full' : bookings.length ? 'active' : 'available';
    return `
      <section class="occ-day">
        <div class="occ-day-header">
          <strong>${escapeHtml(fmtDate(day.date))}</strong>
          <span>${Number(day.customers) || 0} ${Number(day.customers) === 1 ? 'customer' : 'customers'} · ${Number(day.reservationCount) || 0} ${Number(day.reservationCount) === 1 ? 'booking' : 'bookings'}</span>
          <span class="occ-status-badge ${statusClass}">${statusText}</span>
          <span class="occ-arrivals">${Number(day.arrivals) || 0} arriving</span>
        </div>
        <div class="occ-capacity" role="meter" aria-label="Pet capacity for ${escapeHtml(fmtDate(day.date))}" aria-valuemin="0" aria-valuemax="${capacity}" aria-valuenow="${occupiedPets}">
          <div class="occ-capacity-label"><span>Pet capacity</span><strong>${occupiedPets} / ${capacity}</strong></div>
          <div class="occ-capacity-track"><span style="width: ${Math.min(100, occupancyPercent)}%"></span></div>
        </div>
        ${bookings.length ? `<div class="occ-booking-list">${bookings.map((booking) => `
          <button type="button" class="occ-booking occ-booking-button" data-booking-id="${escapeHtml(booking.id)}" data-booking-type="hotel" aria-label="View hotel booking for ${escapeHtml(booking.customerName)}">
            <div class="occ-booking-title"><strong>${escapeHtml(booking.customerName)}</strong>${statusBadge(booking.status)}</div>
            <div class="occ-booking-meta">${escapeHtml((booking.petNames || []).join(', ') || 'No pet listed')}${booking.customerPhone ? ` · ${escapeHtml(booking.customerPhone)}` : ''}</div>
            <div class="occ-booking-meta">${escapeHtml((booking.roomAssignments || []).join(' · '))}</div>
            <div class="occ-booking-times">Check-in: ${escapeHtml(fmtDate(booking.checkIn))} ${escapeHtml(booking.checkInTime || 'Time not set')} <span>→</span> Check-out: ${escapeHtml(fmtDate(booking.checkOut))} ${escapeHtml(booking.checkOutTime || 'Time not set')}</div>
          </button>`).join('')}</div>` : '<div class="occ-empty">No hotel bookings occupy this date.</div>'}
      </section>`;
  }).join('')}</div>`;
}

async function confirmDelete(message, onConfirm) {
  if (window.confirm(message)) {
    await onConfirm();
  }
}
