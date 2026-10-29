const firebaseApp = firebase.initializeApp(window.firebaseConfig);
const firebaseAuth = firebase.auth(firebaseApp);

const isAcceptedRegistrationEmail = (email) => {
    const trimmed = String(email || '').trim().toLowerCase();
  return /^[^@\s]+@(gmail\.com|yahoo\.com|outlook\.com)$/.test(trimmed);
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

const createSession = async (user, profile, challengeId, verificationCode) => {
  const idToken = await user.getIdToken();
  const response = await fetch('/customer/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ idToken, profile, challengeId, verificationCode }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || 'Unable to create the customer session.');
  }
};

document.addEventListener('DOMContentLoaded', () => {
    const form = document.querySelector('form');
    if (!form) return;

  const credentialFields = document.getElementById('credential-fields');
  const codeStep = document.getElementById('customer-code-step');
  const codeInput = document.getElementById('verification-code');
  const resendCodeButton = document.getElementById('resend-code-button');
  const backButton = document.getElementById('back-to-login-button');
  const isRegistrationForm = form.action.endsWith('/customer/register');
  const passwordInput = isRegistrationForm ? form.elements.password : null;
  const confirmPasswordInput = isRegistrationForm ? form.elements.confirmPassword : null;
  const confirmPasswordStatus = isRegistrationForm ? document.getElementById('confirm-password-status') : null;
  let pendingUser = null;
  let pendingProfile = null;
  let challengeId = null;

  const updatePasswordMatch = () => {
    if (!passwordInput || !confirmPasswordInput || !confirmPasswordStatus) return false;
    const hasConfirmation = Boolean(confirmPasswordInput.value);
    const passwordsMatch = passwordInput.value === confirmPasswordInput.value;
    const mismatch = hasConfirmation && !passwordsMatch;
    confirmPasswordInput.setCustomValidity(mismatch ? 'Passwords do not match.' : '');
    confirmPasswordInput.classList.toggle('is-invalid', mismatch);
    confirmPasswordInput.setAttribute('aria-invalid', String(mismatch));
    confirmPasswordStatus.hidden = !hasConfirmation;
    confirmPasswordStatus.textContent = mismatch ? 'Passwords do not match.' : 'Passwords match.';
    confirmPasswordStatus.className = `confirm-password-status${mismatch ? ' is-mismatch' : ' is-match'}`;
    return !mismatch;
  };

  if (passwordInput && confirmPasswordInput) {
    passwordInput.addEventListener('input', updatePasswordMatch);
    confirmPasswordInput.addEventListener('input', updatePasswordMatch);
  }

  const requestLoginCode = async (user) => {
    const response = await fetch('/customer/login/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ idToken: await user.getIdToken() }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Unable to send a verification code.');
    return result.challengeId;
  };

  const returnToCredentials = async () => {
    pendingUser = null;
    pendingProfile = null;
    challengeId = null;
    codeInput.value = '';
    codeInput.required = false;
    codeStep.hidden = true;
    credentialFields.hidden = false;
    await firebaseAuth.signOut();
  };

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
    if (pendingUser) {
      const verificationCode = codeInput.value.trim();
      if (!/^[0-9]{6}$/.test(verificationCode)) {
        showAuthStatus('error', '<span style="color:#9c3a2e; font-weight:700;">Enter the 6-digit code sent to your email.</span>');
        codeInput.focus();
        return;
      }
      const verifyButton = document.getElementById('verify-code-button');
      verifyButton.disabled = true;
      try {
        await createSession(pendingUser, pendingProfile, challengeId, verificationCode);
        await firebaseAuth.signOut();
        showAuthStatus('success', '<span style="color:#1a6b4a; font-weight:700;">✓ Successfully verified. Redirecting...</span>');
        window.location.href = pendingProfile.return && pendingProfile.return !== '/'
          ? pendingProfile.return
          : '/customer/account.html';
      } catch (error) {
        showAuthStatus('error', `<span style="color:#9c3a2e; font-weight:700;">✗ ${error.message}</span>`);
      } finally {
        verifyButton.disabled = false;
      }
      return;
    }
    const isRegistration = isRegistrationForm;
    const termsCheckbox = isRegistration ? document.getElementById('privacy-panel-accept') : null;
    if (isRegistration && (!termsCheckbox || !termsCheckbox.checked)) {
      showAuthError({ message: 'Please accept the terms and conditions before continuing.' });
      if (typeof window.openPrivacyModal === 'function') window.openPrivacyModal();
      termsCheckbox?.focus();
      return;
    }
    const data = Object.fromEntries(new FormData(form));
    // Mark empty required fields as invalid (red) before any other checks
    let hasEmptyRequired = false;
    form.querySelectorAll('[required]').forEach((field) => {
      if (field === termsCheckbox) return;
      const empty = !String(field.value || '').trim();
      field.classList.toggle('is-invalid', empty);
      if (empty) hasEmptyRequired = true;
    });
    if (hasEmptyRequired) {
      const firstInvalid = form.querySelector('.is-invalid');
      if (firstInvalid) firstInvalid.focus();
      return;
    }
    const continueButton = credentialFields && credentialFields.querySelector('button[type="submit"]');
    if (!isRegistration) {
      const verifyButton = document.getElementById('verify-code-button');
      credentialFields.hidden = true;
      codeStep.hidden = false;
      codeInput.required = true;
      codeInput.disabled = true;
      verifyButton.disabled = true;
      resendCodeButton.disabled = true;
      backButton.disabled = true;
      continueButton.disabled = true;
      showAuthStatus('success', '<span style="color:#1a6b4a; font-weight:700;">Checking your credentials...</span>');
    }
    if (form.action.endsWith('/customer/register')) {
      if (!updatePasswordMatch()) {
        confirmPasswordInput.focus();
        return;
      }
      delete data.confirmPassword;
      const phoneInput = form.elements.phone;
      if (phoneInput && /[^0-9]/.test(phoneInput.value)) {
        phoneInput.focus();
        showAuthError({ message: 'Phone number must contain digits only.' });
        return;
      }
      if (phoneInput && !/^09[0-9]{9}$/.test(phoneInput.value)) {
        phoneInput.focus();
        showAuthError({ message: 'Enter an 11-digit mobile number starting with 09.' });
        return;
      }
      if (!isAcceptedRegistrationEmail(data.email)) {
        showAuthError({ message: 'Use a Gmail, Yahoo, or Outlook email address (@gmail.com, @yahoo.com, or @outlook.com).' });
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
        const registrationCheckResponse = await fetch('/customer/registration-email-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ email: data.email }),
        });
        const registrationCheck = await registrationCheckResponse.json().catch(() => ({}));
        if (!registrationCheckResponse.ok) {
          throw new Error(registrationCheck.error || 'Unable to verify this email for registration.');
        }
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
              termsAccepted: Boolean(termsCheckbox?.checked),
            },
          }),
        });
        const profileResult = await profileResponse.json().catch(() => ({}));
        if (!profileResponse.ok) throw new Error(profileResult.error || 'Unable to save your profile details. Please try registering again.');
        await firebaseAuth.signOut();
        const baseUrl = data.return && data.return !== '/' ? data.return : '/';
        window.location.href = `/customer/login.html?registered=1&return=${encodeURIComponent(baseUrl)}`;
        return;
      } else {
        const result = await firebaseAuth.signInWithEmailAndPassword(data.email, data.password);
        user = result.user;
        pendingUser = user;
        pendingProfile = { ...data };
        delete pendingProfile.password;
        const verifyButton = document.getElementById('verify-code-button');
        showAuthStatus('success', '<span style="color:#1a6b4a; font-weight:700;">Credentials accepted. Sending a verification code to your email...</span>');
        try {
          challengeId = await requestLoginCode(user);
          codeInput.disabled = false;
          codeInput.focus();
          showAuthStatus('success', '<span style="color:#1a6b4a; font-weight:700;">A verification code was sent to your email. Enter it to finish signing in.</span>');
        } catch (error) {
          showAuthStatus('error', `<span style="color:#9c3a2e; font-weight:700;">✗ ${error.message}</span>`);
        } finally {
          verifyButton.disabled = !challengeId;
          resendCodeButton.disabled = false;
          backButton.disabled = false;
          continueButton.disabled = false;
        }
        return;
      }
    } catch (error) {
      if (!pendingUser && firebaseAuth.currentUser) {
        await firebaseAuth.signOut().catch((signOutError) => {
          console.error('Unable to clear unfinished customer sign-in:', signOutError);
        });
      }
      if (!pendingUser && !form.action.endsWith('/customer/register')) {
        credentialFields.hidden = false;
        codeStep.hidden = true;
        codeInput.required = false;
        codeInput.disabled = false;
        document.getElementById('verify-code-button').disabled = false;
        resendCodeButton.disabled = false;
        backButton.disabled = false;
        credentialFields.querySelector('button[type="submit"]').disabled = false;
      }
      const code = error.code || '';
      const msg = code === 'auth/invalid-credential'
        ? 'The email or password is incorrect.'
        : code === 'auth/email-already-in-use'
          ? 'That email is already registered.'
          : code === 'auth/operation-not-allowed'
            ? 'Email/password sign-in is disabled in Firebase Authentication settings.'
          : code === 'auth/too-many-requests'
            ? 'Too many attempts. Please wait a moment and try again.'
          : error.message;
showAuthStatus('error', `<span style="color:#9c3a2e; font-weight:700;">✗ ${msg}</span>`);
    }
  });

  if (resendCodeButton) {
    resendCodeButton.addEventListener('click', async () => {
      if (!pendingUser) return;
      resendCodeButton.disabled = true;
      try {
        challengeId = await requestLoginCode(pendingUser);
        codeInput.disabled = false;
        document.getElementById('verify-code-button').disabled = false;
        codeInput.focus();
        showAuthStatus('success', '<span style="color:#1a6b4a; font-weight:700;">A new verification code was sent to your Gmail.</span>');
      } catch (error) {
        showAuthStatus('error', `<span style="color:#9c3a2e; font-weight:700;">✗ ${error.message}</span>`);
      } finally {
        resendCodeButton.disabled = false;
      }
    });
  }
  if (backButton) {
    backButton.addEventListener('click', () => returnToCredentials().catch((error) => {
      console.error('Unable to reset customer sign-in:', error);
    }));
  }
});