// A soft lantern light follows the mouse over the page, and cards catch it on
// their edges. Mouse only, and nothing at all under reduced motion, so touch
// and keyboard visitors get the same page without the effect.
export function initPageLight(root) {
  if (!root) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;

  // Sections ease in once as they arrive.
  const reveals = root.querySelectorAll('.reveal');
  if (!reduced && 'IntersectionObserver' in window && reveals.length) {
    document.documentElement.classList.add('motion-ready');
    const seen = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in');
        seen.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -12% 0px' });
    reveals.forEach((el) => seen.observe(el));
  }

  if (reduced || !fine) return;
  const glow = root.querySelector('.page-glow');
  const cards = [...root.querySelectorAll('[data-spotlight]')];
  let x = 0, y = 0, queued = false, shown = false;

  function paint() {
    queued = false;
    // Read every rect first, then write, so no write forces another layout.
    const box = root.getBoundingClientRect();
    const rects = cards.map((card) => card.getBoundingClientRect());
    if (glow) glow.style.transform = `translate3d(${x - box.left}px, ${y - box.top}px, 0)`;
    cards.forEach((card, i) => {
      const r = rects[i];
      if (x < r.left - 240 || x > r.right + 240 || y < r.top - 240 || y > r.bottom + 240) return;
      card.style.setProperty('--mx', `${x - r.left}px`);
      card.style.setProperty('--my', `${y - r.top}px`);
    });
  }

  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    x = e.clientX; y = e.clientY;
    if (!shown) { shown = true; root.classList.add('has-glow'); }
    if (!queued) { queued = true; requestAnimationFrame(paint); }
  }, { passive: true });
  // The light stays under the pointer while the page scrolls beneath it.
  addEventListener('scroll', () => {
    if (shown && !queued) { queued = true; requestAnimationFrame(paint); }
  }, { passive: true });
  document.addEventListener('mouseleave', () => { shown = false; root.classList.remove('has-glow'); });
}
