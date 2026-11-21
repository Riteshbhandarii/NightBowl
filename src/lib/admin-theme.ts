// Keystatic has no theme option. Its UI reads the --kui slate scale, so the admin is made
// pitch black by overriding that scale. src/middleware.ts injects this into every
// /keystatic HTML response, so it is in the page before any script runs. It also holds
// the small pointer-glow script.
export const ADMIN_THEME_CSS = `
html, html.kui-scheme--auto, html .kui-scheme--auto, html .kui-scheme--light, html .kui-scheme--dark {
  color-scheme: dark !important;
  --kui-color-scale-slate1: #000000 !important;
  --kui-color-scale-slate2: #000000 !important;
  --kui-color-scale-slate3: #0d0d0d !important;
  --kui-color-scale-slate4: #151515 !important;
  --kui-color-scale-slate5: #1d1d1d !important;
  --kui-color-scale-slate6: #2a2a2a !important;
  --kui-color-scale-slate7: #3a3a3a !important;
  --kui-color-scale-slate8: #6b6b6b !important;
  --kui-color-scale-slate9: #8f8f8f !important;
  --kui-color-scale-slate10: #b8b8b8 !important;
  --kui-color-scale-slate11: #ededed !important;
}
html, body, body > div { background-color: #000000 !important; }
/* A soft lantern-coloured light that follows the pointer. It sits above the page, never takes clicks. */
html::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483647;
  background: radial-gradient(460px circle at var(--nb-x, -999px) var(--nb-y, -999px), rgba(255, 173, 88, 0.26), rgba(255, 173, 88, 0.09) 45%, transparent 70%);
  mix-blend-mode: screen;
  opacity: var(--nb-glow, 0);
  transition: opacity 0.3s ease;
}
`;

export const ADMIN_GLOW_JS = `
(() => {
  if (matchMedia('(pointer: coarse)').matches) return;
  const root = document.documentElement;
  let frame = 0, x = 0, y = 0;
  addEventListener('pointermove', (e) => {
    x = e.clientX; y = e.clientY;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      root.style.setProperty('--nb-x', x + 'px');
      root.style.setProperty('--nb-y', y + 'px');
      root.style.setProperty('--nb-glow', '1');
    });
  }, { passive: true });
  document.addEventListener('pointerleave', () => root.style.setProperty('--nb-glow', '0'));
})();
`;
