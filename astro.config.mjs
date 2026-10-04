// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import markdoc from '@astrojs/markdoc';
import sitemap from '@astrojs/sitemap';
import node from '@astrojs/node';
import keystatic from '@keystatic/astro';
import { readFileSync } from 'node:fs';
import { siteOrigin } from './scripts/lib/site-origin.mjs';

const origin = siteOrigin();
const copy = JSON.parse(readFileSync(new URL('./src/content/site.json', import.meta.url), 'utf8'));
// An unconfigured local/preview build must not advertise an invented launch URL.
export default defineConfig({
  ...(origin ? { site: origin } : {}),
  adapter: node({ mode: 'standalone' }),
  integrations: [
    react(),
    mdx(),
    markdoc(),
    ...(origin ? [sitemap({
      filter: (page) => {
        const pathname = new URL(page).pathname;
        return !pathname.startsWith('/admin')
          && !pathname.startsWith('/keystatic')
          && !pathname.startsWith('/preview')
          && !(copy.guide.draftCopy && /^\/guide\/?$/.test(pathname))
          && !(copy.bill.draftCopy && /^\/bill\/?$/.test(pathname));
      },
    })] : []),
    keystatic(),
  ],
  build: { inlineStylesheets: 'auto' },
});
