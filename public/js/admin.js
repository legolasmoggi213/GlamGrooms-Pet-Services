// Shared admin helpers: sidebar injection + modal utilities.

const ADMIN_PAGES = [
  { href: '/admin/appointments.html', label: 'Appointments' },
  { href: '/admin/notifications.html', label: 'Notifications' },
  { href: '/admin/reports.html', label: 'Reports' },
  { href: '/admin/index.html', label: 'Dashboard' },
  { href: '/admin/customers.html', label: 'Customers' },
  { href: '/admin/pets.html', label: 'Pets' },
  { href: '/admin/pos.html', label: 'Counter Checkout' },
  { href: '/admin/staff.html', label: 'Employees' },
  { href: '/admin/change-password.html', label: 'Change Password' },
];

const STAFF_PAGES = [
  { href: '/admin/index.html', label: 'Dashboard' },
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
      <a class="brand" href="/admin/index.html">Glam Grooms Pet Spa & Hotel</a>
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

async function confirmDelete(message, onConfirm) {
  if (window.confirm(message)) {
    await onConfirm();
  }
}
