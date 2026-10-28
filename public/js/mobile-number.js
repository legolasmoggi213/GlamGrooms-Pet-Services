document.addEventListener('input', (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.matches('[data-mobile-number]')) return;

  const prefix = input.dataset.mobileNumberPrefix || '';
  const maxLength = Number(input.maxLength) > 0 ? Number(input.maxLength) : 11;
  const previousValue = input.value;
  const cursorPosition = input.selectionStart;
  let digits = previousValue.replace(/\D/g, '');

  if (prefix) {
    const partialPrefix = digits.length < prefix.length
      && (prefix.startsWith(digits) || prefix.endsWith(digits));
    const suffix = digits.startsWith(prefix)
      ? digits.slice(prefix.length)
      : partialPrefix
        ? ''
        : digits.replace(/^0+/, '');
    digits = `${prefix}${suffix.slice(0, Math.max(0, maxLength - prefix.length))}`;
  } else {
    digits = digits.slice(0, maxLength);
  }

  input.value = digits;
  if (prefix && previousValue !== digits && cursorPosition !== null) {
    const position = Math.max(prefix.length, Math.min(cursorPosition, digits.length));
    input.setSelectionRange(position, position);
  }
});

document.addEventListener('keydown', (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.matches('[data-mobile-number-prefix]')) return;

  const prefixLength = input.dataset.mobileNumberPrefix.length;
  const selectionStart = input.selectionStart;
  const selectionEnd = input.selectionEnd;
  if (selectionStart === null || selectionEnd === null) return;
  if (event.key === 'Backspace' && selectionStart === prefixLength && selectionEnd === prefixLength) {
    event.preventDefault();
    return;
  }
  if (selectionStart >= prefixLength || selectionEnd > prefixLength) return;

  const editsPrefix = event.key === 'Backspace' || event.key === 'Delete'
    || event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
  if (editsPrefix) {
    event.preventDefault();
    input.setSelectionRange(prefixLength, prefixLength);
  }
});
