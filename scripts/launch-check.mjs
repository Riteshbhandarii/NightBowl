import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteOrigin } from './lib/site-origin.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const copyPath = join(root, 'src/content/site.json');
const original = readFileSync(copyPath, 'utf8');
const fixture = JSON.parse(original);
const fixtureUrl = `/nightbowl-download-fixture-${process.pid}.pdf`;
const fixturePath = join(root, 'public', fixtureUrl.slice(1));
assert.ok(!existsSync(fixturePath), 'never overwrite an existing public asset');
const dist = join(root, 'dist/client');
const html = (route) => readFileSync(join(dist, route), 'utf8');
const origin = 'https://nightbowl-fixture.dev'; // Test input, not the selected launch domain.
function build(site = '', failure) {
  const env = { ...process.env, NIGHTBOWL_SITE_URL: site };
  if (failure) {
    const result = spawnSync('npm', ['run', 'build'], { cwd: root, env, encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'invalid launch input must fail the build');
    assert.match(`${result.stdout}${result.stderr}`, failure, 'failure names the actual bad input');
  } else {
    execFileSync('npm', ['run', 'build'], { cwd: root, env, stdio: 'inherit' });
    execFileSync('node', ['scripts/check-build.mjs'], { cwd: root, env, stdio: 'inherit' });
  }
}
const save = () => writeFileSync(copyPath, `${JSON.stringify(fixture, null, 2)}\n`);

assert.equal(siteOrigin(''), undefined);
assert.equal(siteOrigin('https://nightbowl-fixture.dev/'), origin);
for (const invalid of ['https://nightbowl.example', 'https://example.com', 'http://real-domain.dev',
  'https://localhost', 'https://127.0.0.1', 'https://portfolio.test', 'https://user:pass@real-domain.dev',
  'https://real-domain.dev/path', 'https://real-domain.dev/?preview=1', 'https://real-domain.dev/#menu']) {
  assert.throws(() => siteOrigin(invalid), /NIGHTBOWL_SITE_URL/);
}
const image = readFileSync(join(root, 'public/images/nightbowl-share.png'));
assert.equal(image.subarray(1, 4).toString(), 'PNG');
assert.equal(image.readUInt32BE(16), 1200);
assert.equal(image.readUInt32BE(20), 630);

try {
  fixture.bill.email = 'unapproved-fixture@nightbowl.invalid';
  fixture.bill.emailConfirmed = false;
  fixture.bill.cvReady = false;
  save();
  build();
  for (const route of ['index.html', 'bill/index.html']) {
    const page = html(route);
    assert.ok(!page.includes(fixture.bill.email), 'unapproved email is not exposed');
    assert.ok(!/href="\/cv.pdf"/.test(page), 'missing CV creates no download link');
    assert.ok(!/rel="canonical"|property="og:url"|property="og:image"/.test(page), 'unset origin produces no fabricated absolute metadata');
  }
  assert.ok(!existsSync(join(dist, 'sitemap-index.xml')));

  fixture.bill.emailConfirmed = true;
  fixture.bill.email = 'not an email';
  save();
  build('', /valid confirmed public email/);
  fixture.bill.email = 'contact-fixture@nightbowl-fixture.dev';
  fixture.bill.cvReady = true;
  fixture.bill.cvUrl = fixtureUrl;
  save();
  build('', /ready CV is missing/);
  writeFileSync(fixturePath, '<svg>Not a PDF</svg>');
  build('', /ready CV asset is not a PDF/);

  // A blank, valid PDF used only by this test, never an invented owner CV.
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, object] of [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources <<>> /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ].entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  writeFileSync(fixturePath, pdf);
  fixture.bill.draftCopy = false;
  save();
  build(origin);
  for (const route of ['index.html', 'bill/index.html']) {
    const page = html(route);
    assert.ok(page.includes(`href="mailto:${encodeURIComponent(fixture.bill.email)}"`), 'confirmed email has a direct destination');
    assert.match(page, new RegExp(`href="${fixtureUrl}"[^>]*download`), 'verified local PDF has a download action');
  }
  assert.equal(readFileSync(join(dist, fixtureUrl.slice(1))).subarray(0, 5).toString(), '%PDF-');
  const titles = new Set();
  for (const [route, path] of [['index.html', '/'], ['menu/index.html', '/menu/'],
    ['log/index.html', '/log/'], ['bill/index.html', '/bill/']]) {
    const page = html(route);
    assert.ok(page.includes(`rel="canonical" href="${origin}${path}"`), `${path}: canonical uses configured origin and route`);
    assert.ok(page.includes(`property="og:url" content="${origin}${path}"`));
    assert.ok(page.includes(`${origin}/images/nightbowl-share.png`));
    assert.ok(page.includes('name="twitter:card" content="summary_large_image"'));
    assert.ok(page.includes('content="1200"') && page.includes('content="630"'));
    const title = page.match(/<title>(.*?)<\/title>/)?.[1];
    assert.ok(title.includes(fixture.site.ownerName));
    assert.ok(!titles.has(title), 'public page titles are distinct');
    titles.add(title);
  }
  for (const route of ['guide/index.html', 'preview/menu/index.html',
    'preview/log/why-a-ramen-stall/index.html']) {
    const page = html(route);
    assert.ok(page.includes('content="noindex, nofollow"'), `${route}: drafts/previews not indexed`);
    assert.ok(!page.includes('rel="canonical"') && !page.includes('property="og:url"'));
  }
  const sitemap = html('sitemap-0.xml');
  assert.ok(sitemap.includes(`${origin}/menu/`) && sitemap.includes(`${origin}/bill/`));
  for (const path of ['/guide/', '/preview/', '/admin/', '/keystatic/', '/log/why-a-ramen-stall/']) assert.ok(!sitemap.includes(path));
  assert.ok(!sitemap.includes('nightbowl.example'));
} finally {
  writeFileSync(copyPath, original);
  if (existsSync(fixturePath)) unlinkSync(fixturePath);
  execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
}
assert.equal(readFileSync(copyPath, 'utf8'), original, 'test restores owner-controlled content');
console.log('launch checks: contact/CV rejection and publication guards, configured/unset identity, distinct metadata, original image and draft sitemap boundaries passed');
