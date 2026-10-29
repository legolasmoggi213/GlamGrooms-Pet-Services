(() => {
  const mobileViewport = window.matchMedia('(max-width: 760px)');

  document.querySelectorAll('[data-mobile-nav]').forEach((header) => {
    const toggle = header.querySelector('.mobile-nav-toggle');
    if (!toggle) return;

    const setOpen = (open) => {
      header.classList.toggle('mobile-nav-open', open && mobileViewport.matches);
      toggle.setAttribute('aria-expanded', String(open && mobileViewport.matches));
      toggle.setAttribute('aria-label', open && mobileViewport.matches ? 'Close navigation menu' : 'Open navigation menu');
    };

    toggle.addEventListener('click', () => {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });

    header.querySelectorAll('nav a').forEach((link) => {
      link.addEventListener('click', () => {
        if (mobileViewport.matches) setOpen(false);
      });
    });

    header.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && header.classList.contains('mobile-nav-open')) {
        setOpen(false);
        toggle.focus();
      }
    });

    const handleViewportChange = () => setOpen(false);
    if (mobileViewport.addEventListener) mobileViewport.addEventListener('change', handleViewportChange);
    else mobileViewport.addListener(handleViewportChange);
  });
})();
