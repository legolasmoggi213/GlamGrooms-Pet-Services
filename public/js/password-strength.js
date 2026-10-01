(function () {
  const passwordInput = document.querySelector('input[name="password"]');
  if (!passwordInput) return;

  const hint = document.createElement('div');
  hint.className = 'password-strength';
  hint.setAttribute('role', 'status');

  const bars = document.createElement('div');
  bars.className = 'password-strength-bars';
  bars.setAttribute('aria-hidden', 'true');
  const strengthBars = Array.from({ length: 3 }, () => {
    const bar = document.createElement('span');
    bar.className = 'password-strength-bar';
    bars.appendChild(bar);
    return bar;
  });
  const label = document.createElement('span');
  label.className = 'password-strength-label';
  hint.append(bars, label);

  // Insert the hint after the password field's parent wrapper so it sits
  // below the input + toggle button instead of overlapping them.
  const wrapper = passwordInput.closest('.password-field') || passwordInput.parentElement;
  wrapper.insertAdjacentElement('afterend', hint);

  const hasUpper = (p) => /[A-Z]/.test(p);
  const hasLower = (p) => /[a-z]/.test(p);
  const hasNumber = (p) => /\d/.test(p);
  const hasSpecial = (p) => /[^A-Za-z0-9]/.test(p);

  const updateStrength = () => {
    const password = passwordInput.value;
    const validLength = password.length >= 8 && password.length <= 24;
    const criteriaCount = [hasUpper(password), hasLower(password), hasNumber(password), hasSpecial(password)]
      .filter(Boolean).length;
    const valid = validLength && criteriaCount === 4;
    const level = !password
      ? ''
      : !validLength || criteriaCount < 3
        ? 'weak'
        : valid && password.length >= 12
          ? 'strong'
          : 'medium';
    const messages = {
      weak: 'Weak: use 8-24 characters with upper/lowercase letters, a number, and a symbol.',
      medium: 'Medium: meets the password requirements; 12 or more characters improves strength.',
      strong: 'Strong password.',
    };

    hint.className = `password-strength${level ? ` is-${level}` : ''}`;
    label.textContent = messages[level] || 'Use 8-24 characters with upper/lowercase letters, a number, and a symbol.';
    strengthBars.forEach((bar, index) => {
      bar.className = `password-strength-bar${level && index < (level === 'weak' ? 1 : level === 'medium' ? 2 : 3) ? ` is-${level}` : ''}`;
    });
    passwordInput.setCustomValidity(password && !valid
      ? 'Password must be 8-24 characters and include uppercase and lowercase letters, a number, and a special character.'
      : '');
  };

  passwordInput.addEventListener('input', updateStrength);

  updateStrength();
})();