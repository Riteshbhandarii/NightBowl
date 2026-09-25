import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = new URL('..', import.meta.url).pathname;
const client = join(root, 'dist/client');
const html = readFileSync(join(client, 'index.html'), 'utf8');
const localAssets = [...html.matchAll(/(?:src|href)="(\/_astro\/[^"?#]+)"/g)]
  .map((match) => match[1]);
const files = [
  join(client, 'index.html'),
  ...[...new Set(localAssets)].map((asset) => join(client, asset)),
];
const rawBytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
const gzipBytes = files.reduce((sum, file) => sum + gzipSync(readFileSync(file)).byteLength, 0);
const failures = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name} — ${detail}`);
  if (!ok) failures.push(name);
};

console.log('\npublic home transfer budget');
check('raw first-party payload <= 750 KiB', rawBytes <= 750 * 1024, `${(rawBytes / 1024).toFixed(1)} KiB`);
check('gzip first-party payload <= 250 KiB', gzipBytes <= 250 * 1024, `${(gzipBytes / 1024).toFixed(1)} KiB`);
check('public home does not load the CMS bundle', !/keystatic-page|react-dom/.test(html), `${files.length} initial files`);

if (failures.length) process.exit(1);
console.log('all performance budgets passed\n');
