const isDigitsOnly = (value) => /^\d+$/.test(String(value ?? ''));
const isDecimalNumber = (value) => /^\d+(?:\.\d+)?$/.test(String(value ?? ''));
const isOptionalPhoneNumber = (value) => value == null || String(value).trim() === '' || isDigitsOnly(String(value).trim());

module.exports = { isDigitsOnly, isDecimalNumber, isOptionalPhoneNumber };
