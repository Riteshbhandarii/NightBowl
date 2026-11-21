// @ts-check
import { defineConfig, envField } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import markdoc from '@astrojs/markdoc';
import sitemap from '@astrojs/sitemap';
import node from '@astrojs/node';
import cloudflare from '@astrojs/cloudflare';
import keystatic from '@keystatic/astro';
import { readFileSync } from 'node:fs';
import { siteOrigin } from './scripts/lib/site-origin.mjs';

const origin = siteOrigin();
const copy = {
  guide: JSON.parse(readFileSync(new URL('./src/content/site/guide.json', import.meta.url), 'utf8')),
  bill: JSON.parse(readFileSync(new URL('./src/content/site/bill.json', import.meta.url), 'utf8')),
};
// An unconfigured local/preview build must not advertise an invented launch URL.
export default defineConfig({
  ...(origin ? { site: origin } : {}),
  // Cloudflare deploys build with NIGHTBOWL_ADAPTER=cloudflare; everything else
  // (dev, CI, smoke tests) keeps the standalone Node server.
  adapter: process.env.NIGHTBOWL_ADAPTER === 'cloudflare' ? cloudflare({ imageService: 'passthrough' }) : node({ mode: 'standalone' }),
  // No Astro sessions are used; this stops the Cloudflare adapter requiring a KV binding.
  session: false,
  // Owner subscriber page. Secrets are Worker secrets in production, never in the repository.
  env: {
    schema: {
      BUTTONDOWN_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      BUTTONDOWN_API_BASE: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },
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
