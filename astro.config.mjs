// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import markdoc from '@astrojs/markdoc';
import sitemap from '@astrojs/sitemap';
import node from '@astrojs/node';
import keystatic from '@keystatic/astro';

// Update `site` once the real domain is picked (needed for correct sitemap / OG URLs).
export default defineConfig({
  site: 'https://nightbowl.example',
  adapter: node({ mode: 'standalone' }),
  integrations: [
    react(),
    mdx(),
    markdoc(),
    sitemap({
      filter: (page) => {
        const pathname = new URL(page).pathname;
        return !pathname.startsWith('/admin')
          && !pathname.startsWith('/keystatic')
          && !pathname.startsWith('/preview');
      },
    }),
    keystatic(),
  ],
  build: { inlineStylesheets: 'auto' },
});
