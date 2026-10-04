import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { siteOrigin } from './lib/site-origin.mjs';

const root = new URL('..', import.meta.url).pathname;
const postsDir = join(root, 'src/content/posts');
const distRoot = join(root, 'dist');
const distDir = existsSync(join(distRoot, 'client')) ? join(distRoot, 'client') : distRoot;
const origin = siteOrigin();
const sitemapPath = join(distDir, 'sitemap-0.xml');
const sitemap = existsSync(sitemapPath) ? readFileSync(sitemapPath, 'utf8') : '';
const failures = [];

const check = (name, ok) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}`);
  if (!ok) failures.push(name);
};

console.log('\ngenerated content routes');
check('/log index exists', existsSync(join(distDir, 'log/index.html')));
check('/admin redirect exists', existsSync(join(distDir, 'admin/index.html')));
check('production server entry exists', existsSync(join(distRoot, 'server/entry.mjs')));
for (const route of ['menu', 'guide', 'bill']) check(`/${route} index exists`, existsSync(join(distDir, route, 'index.html')));
check('sitemap exists only with a configured production origin', Boolean(sitemap) === Boolean(origin));
check('placeholder origin is absent', !sitemap.includes('nightbowl.example'));
check('admin is absent from sitemap', !sitemap.includes('/admin/'));
check('previews are absent from sitemap', !sitemap.includes('/preview/'));

for (const file of readdirSync(postsDir).filter((name) => /\.mdx?$/.test(name))) {
  const source = readFileSync(join(postsDir, file), 'utf8');
  const status = source.match(/^status:\s*([\w-]+)/m)?.[1];
  const slug = basename(file).replace(/\.mdx?$/, '');
  const routeExists = existsSync(join(distDir, 'log', slug, 'index.html'));
  const listed = sitemap.includes(`/log/${slug}/`);
  const previewExists = existsSync(join(distDir, 'preview', 'log', slug, 'index.html'));
  check(`preview route exists: ${slug}`, previewExists);
  if (status === 'published') {
    check(`published post route exists: ${slug}`, routeExists);
    check(`published post sitemap matches origin configuration: ${slug}`, listed === Boolean(origin));
  } else {
    check(`draft post has no route: ${slug}`, !routeExists);
    check(`draft post is absent from sitemap: ${slug}`, !listed);
  }
}

if (failures.length) {
  console.error(`\n${failures.length} generated route check(s) failed`);
  process.exit(1);
}
console.log('all generated route checks passed\n');
