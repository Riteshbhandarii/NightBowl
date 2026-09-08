// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// Update `site` once the real domain is picked (needed for correct sitemap / OG URLs).
export default defineConfig({
  site: 'https://nightbowl.example',
  integrations: [mdx(), sitemap()],
  build: { inlineStylesheets: 'auto' },
});
