const firebaseApp = firebase.initializeApp(window.firebaseConfig);
const firebaseAuth = firebase.auth(firebaseApp);

const isGmailOnly = (email) => {
    const trimmed = String(email || '').trim().toLowerCase();
    return /^[^@\s]+@gmail\.com$/.test(trimmed);
  };

  const showAuthError = (error) => {
    const form = document.querySelector('form');
    if (!form) return;

    let message = form.querySelector('.text-error');
    if (!message) {
      message = document.createElement('p');
      message.className = 'text-error';
      form.prepend(message);
    }

    message.textContent = error.code === 'auth/email-already-in-use'
      ? 'That email is already registered.'
      : error.code === 'auth/invalid-credential'
        ? 'The email or password is incorrect.'
        : error.code === 'auth/operation-not-allowed'
          ? 'Email/password sign-in is disabled in Firebase Authentication settings.'
        : error.code === 'auth/too-many-requests'
          ? 'Too many attempts. Please wait a moment and try again.'
        : error.code === 'auth/email-not-verified'
          ? 'Please verify your email before signing in. Check your inbox.'
          : error.message;
  };

  const showAuthStatus = (type, message) => {
    const form = document.querySelector('form');
    if (!form) return;
    let status = form.querySelector('.auth-status');
    if (!status) {
      status = document.createElement('p');
      status.className = 'auth-status';
      form.appendChild(status);
    }
    status.className = `auth-status auth-status-${type}`;
    status.innerHTML = message;
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.classList.toggle('btn-success', type === 'success');
      submitBtn.classList.toggle('btn-error', type === 'error');
    }
  };

  const showVerificationMessage = (user) => {
    const form = document.querySelector('form');
    if (!form) return;
    let message = form.querySelector('.text-success');
    if (!message) {
      message = document.createElement('p');
      message.className = 'text-success';
      form.appendChild(message);
    }
    message.textContent = 'Please verify your email before signing in. Check your inbox.';
    message.hidden = false;
  };

const createSession = async (user, profile) => {
  const idToken = await user.getIdToken();
  const response = await fetch('/customer/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ idToken, profile }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || 'Unable to create the customer session.');
  }
};

document.addEventListener('DOMContentLoaded', () => {
    const form = document.querySelector('form');
    if (!form) return;

  const forgotPassword = document.getElementById('forgot-password');
  const resetMessage = document.getElementById('reset-message');
  if (forgotPassword && resetMessage) {
    forgotPassword.addEventListener('click', async () => {
      const email = form.elements.email && form.elements.email.value.trim();
      if (!email) {
        resetMessage.className = 'text-error';
        resetMessage.textContent = 'Enter your email address first.';
        form.elements.email.focus();
        return;
      }

      forgotPassword.disabled = true;
      resetMessage.className = 'text-muted';
      resetMessage.textContent = 'Sending reset email...';
      try {
        await firebaseAuth.sendPasswordResetEmail(email);
        resetMessage.className = 'text-success';
        resetMessage.textContent = 'If an account uses that email, a password reset link has been sent.';
      } catch (error) {
        resetMessage.className = 'text-error';
        resetMessage.textContent = error.code === 'auth/invalid-email'
          ? 'Enter a valid email address.'
          : error.code === 'auth/too-many-requests'
            ? 'Too many requests. Please wait and try again.'
            : 'Unable to send the reset email. Please try again.';
      } finally {
        forgotPassword.disabled = false;
      }
    });
  }

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    // Mark empty required fields as invalid (red) before any other checks
    let hasEmptyRequired = false;
    form.querySelectorAll('[required]').forEach((field) => {
      const empty = !String(field.value || '').trim();
      field.classList.toggle('is-invalid', empty);
      if (empty) hasEmptyRequired = true;
    });
    if (hasEmptyRequired) {
      const firstInvalid = form.querySelector('.is-invalid');
      if (firstInvalid) firstInvalid.focus();
      return;
    }
    if (form.action.endsWith('/customer/register')) {
      const phoneInput = form.elements.phone;
      if (phoneInput && /[^0-9+()\-\s]/.test(phoneInput.value)) {
        phoneInput.focus();
        showAuthError({ message: 'Phone number must contain only numbers and valid formatting characters.' });
        return;
      }
      const termsCheckbox = document.getElementById('privacy-panel-accept');
      if (!termsCheckbox || !termsCheckbox.checked) {
        if (typeof window.openPrivacyModal === 'function') {
          window.openPrivacyModal();
        } else {
          showAuthError({ message: 'You must accept the privacy policy and terms and conditions to register.' });
        }
        return;
      }
      if (!isGmailOnly(data.email)) {
        showAuthError({ message: 'Only Gmail addresses (@gmail.com) are accepted for registration.' });
        return;
      }
      const pw = data.password;
      const hasUpper = /[A-Z]/.test(pw);
      const hasLower = /[a-z]/.test(pw);
      const hasNumber = /\d/.test(pw);
      const hasSpecial = /[^A-Za-z0-9]/.test(pw);
      if (pw.length < 8 || pw.length > 24 || !hasUpper || !hasLower || !hasNumber || !hasSpecial) {
        showAuthError({ message: 'Password must be 8-24 characters and include uppercase and lowercase letters, a number, and a special character (! @ # $ etc.).' });
        return;
      }
    }
    try {
      let user;
      if (form.action.endsWith('/customer/register')) {
        try {
          const result = await firebaseAuth.createUserWithEmailAndPassword(data.email, data.password);
          user = result.user;
        } catch (createError) {
          if (createError.code !== 'auth/email-already-in-use') throw createError;

          let existingResult;
          try {
            existingResult = await firebaseAuth.signInWithEmailAndPassword(data.email, data.password);
          } catch (recoveryError) {
            if (!['auth/invalid-credential', 'auth/wrong-password'].includes(recoveryError.code)) throw recoveryError;
            const passwordError = new Error('Firebase already has an account for this email, but the password entered does not match. Reset the password, then return here to finish registration.');
            passwordError.code = 'auth/registration-password-mismatch';
            passwordError.resetUrl = `/customer/login.html?${new URLSearchParams({ email: data.email })}`;
            throw passwordError;
          }
          user = existingResult.user;
          await user.reload();
          if (user.emailVerified) {
            await firebaseAuth.signOut();
            const accountError = new Error('This email already has a verified account. Sign in instead, or reset your password if needed.');
            accountError.code = 'auth/account-already-verified';
            throw accountError;
          }
        }
        const idToken = await user.getIdToken();
        const profileResponse = await fetch('/customer/register-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            idToken,
            profile: {
              name: data.name,
              email: data.email,
              phone: data.phone,
              address: data.address,
            },
          }),
        });
        const profileResult = await profileResponse.json().catch(() => ({}));
        if (!profileResponse.ok) throw new Error(profileResult.error || 'Unable to save your profile details. Please try registering again.');
        await user.sendEmailVerification();
        await firebaseAuth.signOut();
        const baseUrl = data.return && data.return !== '/' ? data.return : '/';
        window.location.href = `/customer/login.html?registered=1&return=${encodeURIComponent(baseUrl)}`;
        return;
      } else {
        const result = await firebaseAuth.signInWithEmailAndPassword(data.email, data.password);
        user = result.user;
        await user.reload();
        if (!user.emailVerified) {
          await user.sendEmailVerification();
          showVerificationMessage(user);
          await firebaseAuth.signOut();
          return;
        }
        showAuthStatus('success', '<span style="color:#1a6b4a; font-weight:700;">✓ Successfully logged in.</span> Redirecting...');
      }
      await createSession(user, data);
      window.location.href = data.return && data.return !== '/' ? data.return : '/customer/account.html';
    } catch (error) {
      const code = error.code || '';
      const authMessages = {
        'auth/invalid-credential': 'The email or password is incorrect.',
        'auth/email-already-in-use': 'An account already uses this email. Check the address, or sign in and use Forgot password if this is your account.',
        'auth/operation-not-allowed': 'Email/password sign-in is disabled in Firebase Authentication settings.',
        'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
        'auth/email-not-verified': 'Please verify your email before signing in. Check your inbox.',
      };
      const msg = code === 'auth/account-already-verified'
        ? error.message
        : code === 'auth/registration-password-mismatch'
          ? `${error.message} <a href="${error.resetUrl}">Open customer login</a>.`
          : (authMessages[code] || error.message);
showAuthStatus('error', `<span style="color:#9c3a2e; font-weight:700;">✗ ${msg}</span>`);
    }
  });
});