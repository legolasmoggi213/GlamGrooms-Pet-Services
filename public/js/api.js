// Shared API helper for all frontend pages.
const API_BASE = '/api/v1';

const updateNumericValidity = (input) => {
  const value = input.value.trim();
  if (!value) {
    input.setCustomValidity('');
    return;
  }
  const number = Number(value);
  const minimum = input.getAttribute('min');
  const maximum = input.getAttribute('max');
  const step = input.getAttribute('step');
  let message = '';
  if (input.dataset.numericOnly === 'decimal' && !/^\d+(?:\.\d+)?$/.test(value)) {
    message = 'Enter numbers only.';
  } else if (minimum !== null && number < Number(minimum)) {
    message = `Enter a number of at least ${minimum}.`;
  } else if (maximum !== null && number > Number(maximum)) {
    message = `Enter a number no greater than ${maximum}.`;
  } else if (step && step !== 'any' && Number.isFinite(Number(step))) {
    const precision = (step.split('.')[1] || '').length;
    if ((value.split('.')[1] || '').length > precision) message = `Enter no more than ${precision} decimal places.`;
  }
  input.setCustomValidity(message);
};

const configureNumericInput = (input) => {
  const originalType = input.type;
  const name = String(input.name || '').toLowerCase();
  const isPhone = name === 'phone' || name === 'contact' || input.id === 'c-phone' || input.id === 'sale-contact';
  if (isPhone) input.dataset.numericOnly = 'integer';
  if (originalType === 'number' && !input.dataset.numericOnly) {
    input.dataset.numericOnly = input.step && input.step !== '1' ? 'decimal' : 'integer';
  }
  const mode = input.dataset.numericOnly;
  if (!mode) return;

  if (originalType === 'number') input.type = 'text';
  input.inputMode = mode === 'decimal' ? 'decimal' : 'numeric';
  input.pattern = mode === 'decimal' ? '[0-9]+(\\.[0-9]+)?' : '[0-9]*';
  input.autocomplete = 'off';
  if (mode === 'decimal') {
    const cleaned = input.value.replace(/[^0-9.]/g, '');
    const decimalIndex = cleaned.indexOf('.');
    input.value = decimalIndex === -1
      ? cleaned
      : `${cleaned.slice(0, decimalIndex + 1)}${cleaned.slice(decimalIndex + 1).replace(/\./g, '')}`;
  } else {
    input.value = input.value.replace(/[^0-9]/g, '');
  }
  updateNumericValidity(input);
};

const sanitizeNumericInput = (input) => {
  configureNumericInput(input);
  if (!input.dataset.numericOnly) return;
  if (input.dataset.numericOnly === 'decimal') {
    const cleaned = input.value.replace(/[^0-9.]/g, '');
    const decimalIndex = cleaned.indexOf('.');
    input.value = decimalIndex === -1
      ? cleaned
      : `${cleaned.slice(0, decimalIndex + 1)}${cleaned.slice(decimalIndex + 1).replace(/\./g, '')}`;
  } else {
    input.value = input.value.replace(/[^0-9]/g, '');
  }
  updateNumericValidity(input);
};

const prepareNumericInputs = (root = document) => {
  root.querySelectorAll('input[type="number"], input[data-numeric-only], input[name="phone"], input[name="contact"], #c-phone, #sale-contact')
    .forEach(configureNumericInput);
};

prepareNumericInputs();
new MutationObserver((mutations) => {
  mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.matches('input')) configureNumericInput(node);
    prepareNumericInputs(node);
  }));
}).observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('input', (event) => {
  if (event.target instanceof HTMLInputElement) sanitizeNumericInput(event.target);
});

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
  });

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    // non-JSON response
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      const currentPath = window.location.pathname;
      const isAdminPage = currentPath.startsWith('/admin') || currentPath.includes('/admin/');
      const loginPage = isAdminPage ? '/admin/login.html' : '/customer/login.html';
      const returnPath = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
      window.location.href = `${loginPage}?return=${returnPath}`;
    }

    const message =
      (data && data.details && data.details.join(', ')) ||
      (data && data.error) ||
      `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

const apiGet = (path) => api(path);
const apiPost = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
const apiPut = (path, body) => api(path, { method: 'PUT', body: JSON.stringify(body) });
const apiPatch = (path, body) => api(path, { method: 'PATCH', body: JSON.stringify(body) });
const apiDelete = (path) => api(path, { method: 'DELETE' });

// Formatting helpers
const fmtDate = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const fmtMoney = (n) => `₱${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString() : '—');
const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

const escapeHtml = (str) =>
  String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const statusBadge = (status) => {
  const safe = String(status || 'unknown').toLowerCase();
  return `<span class="status-badge status-${safe}">${escapeHtml(status || 'unknown')}</span>`;
};