// Shared admin helpers: sidebar injection + modal utilities.

const ADMIN_PAGES = [
  { href: '/admin/index.html', label: 'Dashboard' },
  { href: '/admin/customers.html', label: 'Customers' },
  { href: '/admin/pets.html', label: 'Pets' },
  { href: '/admin/grooming.html', label: 'Grooming' },
  { href: '/admin/hotel.html', label: 'Hotel' },
  { href: '/admin/pos.html', label: 'Point of Sale' },
  { href: '/admin/transactions.html', label: 'Cash Transactions' },
  { href: '/admin/change-password.html', label: 'Change Password' },
];

function renderSidebar(activeLabel) {
    const links = ADMIN_PAGES.map(
      (p) => `<a href="${p.href}" class="${p.label === activeLabel ? 'active' : ''}">${p.label}</a>`
    ).join('');
  document.getElementById('sidebar').innerHTML = `
    <a class="brand" href="/admin/index.html">Glam Grooms Pet Spa & Hotel</a>
    ${links}
    <a href="/" style="margin-top:1rem;">← Back to site</a>
    <a href="/admin/logout" style="margin-top:0.6rem;color:var(--danger);">Logout</a>
  `;
}

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
