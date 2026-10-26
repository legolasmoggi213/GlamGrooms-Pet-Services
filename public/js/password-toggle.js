// Shared show/hide password toggle for all password fields.
(function () {
  function bindToggles() {
    document.querySelectorAll('.toggle-password').forEach((btn) => {
      if (btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.target);
        if (!target) return;
        const isHidden = target.type === 'password';
        target.type = isHidden ? 'text' : 'password';
        btn.textContent = isHidden ? '🔒︎' : '👁';
        btn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindToggles);
  } else {
    bindToggles();
  }
  // Re-bind after modal content is injected (e.g. admin modals)
  window.bindPasswordToggles = bindToggles;
})();