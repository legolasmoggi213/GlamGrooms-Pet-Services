// Shared API helper for all frontend pages.
const API_BASE = '/api/v1';

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
      window.location.href = '/admin/login.html';
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