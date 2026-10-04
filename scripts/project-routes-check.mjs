import { execFileSync, spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { session, sleep } from './lib/chrome.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const projectsDir = join(root, 'src/content/projects');
const routeSource = readFileSync(join(root, 'src/pages/menu/[slug].astro'), 'utf8');
const menuBookSource = readFileSync(join(root, 'src/components/MenuBook.astro'), 'utf8');
const editorSource = readFileSync(join(root, 'keystatic.config.ts'), 'utf8');
const failures = [];
const outIndex = process.argv.indexOf('--out');
const out = outIndex >= 0 ? process.argv[outIndex + 1] : null;

async function reviewPublishedRoute(slug) {
  const port = 42000 + Math.floor(Math.random() * 10000);
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['scripts/serve.mjs'], {
    cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) }, stdio: 'ignore',
  });
  try {
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      try { ready = (await fetch(`${base}/menu/${slug}/`)).ok; } catch { /* booting */ }
      if (!ready) await sleep(100);
    }
    assert.ok(ready, 'temporary publication server boots');
    for (const width of [1400, 390, 280]) {
      await session({ width, height: 900 }, async ctx => {
        await ctx.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
        await ctx.send('Emulation.setScriptExecutionDisabled', { value: true });
        await ctx.send('Page.navigate', { url: `${base}/menu/${slug}/` });
        for (let i = 0; i < 60; i++) {
          if (await ctx.evaluate("document.readyState==='complete' && !!document.querySelector('.project-body h2')")) break;
          await sleep(100);
        }
        assert.ok(await ctx.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), `${width}px case-study layout fits`);
        assert.ok(await ctx.evaluate("!!document.querySelector('.project-body pre code') && document.querySelector('.project-body img').naturalWidth>0"), 'rich code and image render without JavaScript');
        assert.ok(await ctx.evaluate("!!document.querySelector('.reading-back[href=\"/menu/\"]')"));
        if (out) {
          mkdirSync(out, { recursive: true });
          for (const [part, scroll] of [['top', 'scrollTo(0,0)'], ['body', "document.querySelector('.project-body').scrollIntoView()"]]) {
            await ctx.evaluate(scroll);
            const shot = await ctx.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
            writeFileSync(join(out, `published-fixture-${width}-${part}.png`), Buffer.from(shot.result.data, 'base64'));
          }
        }
        assert.deepEqual(ctx.errors, []);
      });
    }
    check('published rich route is readable without JavaScript at desktop, phone and 280px', true);
  } finally {
    server.kill('SIGTERM');
    await sleep(200);
  }
}

const check = (name, ok) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}`);
  if (!ok) failures.push(name);
};

const projectFiles = readdirSync(projectsDir)
  .filter((name) => name.endsWith('.md'))
  .map((name) => join(projectsDir, name));

const field = (source, name) => {
  const value = source.match(new RegExp(`^${name}:\\s*["']?([^"'\\n]+)`, 'm'))?.[1];
  return value?.trim();
};

const frontmatterEnd = (source) => source.indexOf('\n---', 4);
const body = (source) => source.slice(frontmatterEnd(source) + 4).trim();
const outputRoot = () => {
  const dist = join(root, 'dist');
  return existsSync(join(dist, 'client')) ? join(dist, 'client') : dist;
};
const build = () => execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });

console.log('\nproject source contract');
for (const file of projectFiles) {
  const source = readFileSync(file, 'utf8');
  check(`${basename(file)} has an explicit public summary`, Boolean(field(source, 'summary')));
  check(`${basename(file)} has an explicit publication status`, ['draft', 'published'].includes(field(source, 'status')));
}
check('detail route filters the collection to published projects', routeSource.includes("data.status === 'published'"));
check('menu-book project markup reads summary instead of project body', menuBookSource.includes('p.data.summary') && !menuBookSource.includes('p.body'));

console.log('\nproject editor contract');
for (const editorCapability of [
  'summary:',
  'status:',
  'contribution:',
  'context:',
  'stack:',
  'sourceUrl:',
  'demoUrl:',
  'heading: true',
  'unorderedList: true',
  'codeBlock: true',
  "public/images/projects",
]) {
  check(`editor exposes ${editorCapability}`, editorSource.includes(editorCapability));
}

const draftFile = projectFiles.find((file) => field(readFileSync(file, 'utf8'), 'status') === 'draft') || projectFiles[0];
if (!draftFile) {
  throw new Error('A project is required for the temporary publication fixture.');
}

const original = readFileSync(draftFile, 'utf8');
const slug = basename(draftFile, '.md');
const fixtureBody = `
## PROJECT_ROUTE_FIXTURE_HEADING

- PROJECT_ROUTE_FIXTURE_LIST

\`PROJECT_ROUTE_FIXTURE_INLINE_CODE\`

\`\`\`text
PROJECT_ROUTE_FIXTURE_CODE_BLOCK
\`\`\`

![PROJECT_ROUTE_FIXTURE_IMAGE](/favicon.svg)
`;
// Replace only for the test, rather than assuming owner-authored fields or
// publication states stay empty forever. The existing slug is retained.
const draftFixture = `---
name: "Publication test fixture"
course: "mains"
tag: "Test only"
summary: "Synthetic route fixture. The original project is restored after this check."
status: "draft"
contribution: "PROJECT_ROUTE_FIXTURE_CONTRIBUTION"
context: "PROJECT_ROUTE_FIXTURE_CONTEXT"
stack: ["PROJECT_ROUTE_FIXTURE_STACK"]
sourceUrl: "https://github.com/Riteshbhandarii/NightBowl"
order: 0
draftCopy: true
---
${fixtureBody}`;

try {
  writeFileSync(draftFile, draftFixture);
  build();
  const draftDist = outputRoot();
  check('extended draft has no public detail route', !existsSync(join(draftDist, 'menu', slug, 'index.html')));
  for (const route of ['index.html', 'menu/index.html']) {
    const html = readFileSync(join(draftDist, route), 'utf8');
    check(`${route} excludes draft body and private fields`,
      !html.includes('PROJECT_ROUTE_FIXTURE_HEADING')
      && !html.includes('PROJECT_ROUTE_FIXTURE_CONTRIBUTION')
      && !html.includes('PROJECT_ROUTE_FIXTURE_CONTEXT')
      && !html.includes('PROJECT_ROUTE_FIXTURE_STACK'));
  }
  writeFileSync(draftFile, draftFixture.replace(/^status:\s*["']?draft["']?$/m, 'status: "published"'));
  build();

  const dist = outputRoot();
  const menuHtml = readFileSync(join(dist, 'menu/index.html'), 'utf8');
  const detailPath = join(dist, 'menu', slug, 'index.html');
  check('published fixture creates its existing-slug detail route', existsSync(detailPath));

  if (existsSync(detailPath)) {
    const detailHtml = readFileSync(detailPath, 'utf8');
    check('detail renders a heading', detailHtml.includes('PROJECT_ROUTE_FIXTURE_HEADING'));
    check('detail renders a list', detailHtml.includes('PROJECT_ROUTE_FIXTURE_LIST'));
    check('detail renders inline code', detailHtml.includes('PROJECT_ROUTE_FIXTURE_INLINE_CODE'));
    check('detail renders a code block', detailHtml.includes('PROJECT_ROUTE_FIXTURE_CODE_BLOCK'));
    check('detail renders an image', detailHtml.includes('PROJECT_ROUTE_FIXTURE_IMAGE'));
    check('detail renders approved-only structured fields',
      detailHtml.includes('PROJECT_ROUTE_FIXTURE_CONTRIBUTION')
        && detailHtml.includes('PROJECT_ROUTE_FIXTURE_CONTEXT')
        && detailHtml.includes('PROJECT_ROUTE_FIXTURE_STACK'));
    check('detail has a normal return link to the Menu', detailHtml.includes('href="/menu/"'));
    for (const href of ['/guide/', '/log/', '/bill/', '/']) {
      check(`reading navigation includes ${href}`, detailHtml.includes(`href="${href}"`));
    }
  }

  check('summary index links to a published case study', menuHtml.includes(`href="/menu/${slug}/"`));
  check('summary index does not leak extended Markdown',
    !menuHtml.includes('PROJECT_ROUTE_FIXTURE_HEADING')
      && !menuHtml.includes('PROJECT_ROUTE_FIXTURE_CODE_BLOCK'));
  check('summary index does not leak private structured fields',
    !menuHtml.includes('PROJECT_ROUTE_FIXTURE_CONTRIBUTION')
      && !menuHtml.includes('PROJECT_ROUTE_FIXTURE_CONTEXT')
      && !menuHtml.includes('PROJECT_ROUTE_FIXTURE_STACK'));
  await reviewPublishedRoute(slug);
} finally {
  writeFileSync(draftFile, original);
  build();
}

console.log('\ndraft publication boundary');
const finalDist = outputRoot();
const finalMenu = readFileSync(join(finalDist, 'menu/index.html'), 'utf8');
const restoredSource = readFileSync(draftFile, 'utf8');
check('temporary project fixture restores the exact owner source', restoredSource === original);
check('restored detail route matches the owner publication status', existsSync(join(finalDist, 'menu', slug, 'index.html')) === (field(original, 'status') === 'published'));
check('restored owner summary remains public', finalMenu.includes(field(restoredSource, 'summary')));
if (body(restoredSource)) {
  check('restored draft body is absent from the public summary index', !finalMenu.includes(body(restoredSource)));
}

if (failures.length) {
  console.error(`\n${failures.length} project route check(s) failed`);
  process.exit(1);
}

console.log('all project route checks passed\n');
