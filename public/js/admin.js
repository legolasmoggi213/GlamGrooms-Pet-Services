// Shared admin helpers: sidebar injection + modal utilities.

const ADMIN_PAGES = [
  { href: '/admin/grooming.html', label: 'Grooming' },
  { href: '/admin/hotel.html', label: 'Hotel' },
  { href: '/admin/notifications.html', label: 'Notifications' },
  { href: '/admin/reports.html', label: 'Reports' },
  { href: '/admin/inventory.html', label: 'Inventory' },
  { href: '/admin/index.html', label: 'Dashboard' },
  { href: '/admin/index.html#revenue', label: 'Reports' },
  { href: '/admin/grooming.html', label: 'Grooming' },
  { href: '/admin/hotel.html', label: 'Hotel' },
  { href: '/admin/inventory.html', label: 'Inventory' },
  { href: '/admin/customers.html', label: 'Customers' },
  { href: '/admin/pets.html', label: 'Pets' },
  { href: '/admin/pos.html', label: 'Point of Sale' },
  { href: '/admin/employees.html', label: 'Employees' },
  { href: '/admin/change-password.html', label: 'Change Password' },
];

async function renderSidebar(activeLabel) {
  let role = null;
  try {
    const response = await fetch('/admin/nav-status', { credentials: 'include' });
    const status = await response.json();
    if (!status.authenticated) return window.location.assign('/admin/login.html');
    role = status.role;
  } catch (error) {
    console.error('Unable to load account role:', error);
  }
  document.body.dataset.adminRole = role || '';
  const pages = role === 'admin'
    ? ADMIN_PAGES
    : ADMIN_PAGES.filter((page) => page.label !== 'Employees');
  const links = pages.map(
    (page) => `<a href="${page.href}" class="${page.label === activeLabel ? 'active' : ''}">${page.label}</a>`
  ).join('');
  document.getElementById('sidebar').innerHTML = `
    <a class="brand" href="/admin/index.html">Glam Grooms Pet Spa & Hotel</a>
    ${links}
    <a href="/" style="margin-top:1rem;">← Back to site</a>
    <a href="/admin/logout" data-confirm-logout style="margin-top:0.6rem;color:var(--danger);">Logout</a>
  `;
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
