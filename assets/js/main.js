const menuButton = document.querySelector('.menu-toggle');
const menu = document.querySelector('.primary-nav');

menuButton?.addEventListener('click', () => {
  const isOpen = menu.classList.toggle('is-open');
  menuButton.setAttribute('aria-expanded', String(isOpen));
});

menu?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    menu.classList.remove('is-open');
    menuButton?.setAttribute('aria-expanded', 'false');
  });
});

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08 });

  document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));
} else {
  document.querySelectorAll('.reveal').forEach((element) => element.classList.add('is-visible'));
}

document.querySelector('#year').textContent = new Date().getFullYear();

const researchLinks = document.querySelectorAll('.research-link[href^="#paper-"]');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

researchLinks.forEach((link) => {
  link.addEventListener('click', (event) => {
    const selector = link.getAttribute('href');
    const paper = document.querySelector(selector);
    if (!paper) return;

    event.preventDefault();
    paper.scrollIntoView({
      behavior: prefersReducedMotion.matches ? 'auto' : 'smooth',
      block: 'center'
    });
    history.pushState(null, '', selector);

    const highlight = () => {
      paper.classList.remove('is-highlighted');
      void paper.offsetWidth;
      paper.classList.add('is-highlighted');
      window.setTimeout(() => paper.classList.remove('is-highlighted'), 750);
    };

    if (prefersReducedMotion.matches) {
      highlight();
      return;
    }

    const startedAt = performance.now();
    const waitForScroll = () => {
      const bounds = paper.getBoundingClientRect();
      const paperCenter = bounds.top + bounds.height / 2;
      const nearCenter = Math.abs(paperCenter - window.innerHeight / 2) < 90;

      if (nearCenter || performance.now() - startedAt > 1400) {
        highlight();
      } else {
        window.requestAnimationFrame(waitForScroll);
      }
    };

    window.requestAnimationFrame(waitForScroll);
  });
});
