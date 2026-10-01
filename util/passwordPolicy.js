const MIN_PASSWORD_LENGTH = 8;

function isStrongPassword(password) {
  return typeof password === 'string'
    && password.length >= MIN_PASSWORD_LENGTH
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password);
}

module.exports = { MIN_PASSWORD_LENGTH, isStrongPassword };