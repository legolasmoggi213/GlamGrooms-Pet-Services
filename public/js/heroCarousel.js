// Simple fade carousel for hero images
(() => {
  const containers = Array.from(document.querySelectorAll('.hero-images, .about-images'));
  if (!containers.length) return;
  const INTERVAL = 4500;
  containers.forEach((container) => {
    const imgs = Array.from(container.querySelectorAll('img'));
    if (!imgs.length) return;
    let idx = 0;
    imgs.forEach((img, i) => img.classList.toggle('active', i === 0));
    let timer = setInterval(next, INTERVAL);
    function next() {
      imgs[idx].classList.remove('active');
      idx = (idx + 1) % imgs.length;
      imgs[idx].classList.add('active');
    }
    container.addEventListener('mouseenter', () => clearInterval(timer));
    container.addEventListener('mouseleave', () => { timer = setInterval(next, INTERVAL); });
  });
})();
