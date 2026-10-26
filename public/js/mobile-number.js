document.addEventListener('input', (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.matches('[data-mobile-number]')) return;
  input.value = input.value.replace(/\D/g, '').slice(0, 11);
});
