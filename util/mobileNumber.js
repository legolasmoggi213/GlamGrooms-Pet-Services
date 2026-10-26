const isValidMobileNumber = (value) => typeof value === 'string' && /^[0-9]{11}$/.test(value);

module.exports = { isValidMobileNumber };
