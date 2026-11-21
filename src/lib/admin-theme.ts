// Keystatic has no theme option. Its UI reads the --kui slate scale, so the admin is made
// pitch black by overriding that scale. src/middleware.ts injects this into every
// /keystatic HTML response, so it is in the page before any script runs.
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
`;
