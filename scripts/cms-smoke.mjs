import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const base = arg('--url', 'http://127.0.0.1:4321');
const mode = arg('--mode', 'local');
const chromeCandidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);
const chromePath = chromeCandidates.find((candidate) => existsSync(candidate));
const profile = mkdtempSync(join(tmpdir(), 'nightbowl-cms-smoke-'));
const port = 9433 + Math.floor(Math.random() * 400);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

if (!chromePath) throw new Error('Chrome not found. Set CHROME_PATH.');

const chrome = spawn(chromePath, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1280,900',
  ...(process.env.SMOKE_FLAGS ? process.env.SMOKE_FLAGS.split(' ') : []),
  'about:blank',
], { stdio: 'ignore' });

let target;
for (let attempt = 0; attempt < 80 && !target; attempt++) {
  await sleep(250);
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = targets.find((item) => item.type === 'page');
  } catch { /* Chrome is still starting. */ }
}
if (!target) throw new Error('Chrome did not expose a debugging target.');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let id = 0;
const pending = new Map();
const runtimeErrors = [];
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
  if (message.method === 'Runtime.exceptionThrown') {
    runtimeErrors.push(message.params.exceptionDetails.exception?.description
      || message.params.exceptionDetails.text);
  }
});
const send = (method, params = {}) => new Promise((resolve) => {
  const requestId = ++id;
  pending.set(requestId, resolve);
  ws.send(JSON.stringify({ id: requestId, method, params }));
});
const evaluate = async (expression) => {
  const response = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.exception?.description
      || response.result.exceptionDetails.text);
  }
  return response.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');

try {
  console.log(`\nNightBowl CMS smoke (${mode}) → ${base}\n`);
  if (mode === 'production') {
    const auth = await fetch(new URL('/api/keystatic/github/login', base), {
      redirect: 'manual',
    });
    const authLocation = auth.headers.get('location') || '';
    check('production auth API redirects to GitHub',
      [302, 303, 307, 308].includes(auth.status)
        && authLocation.startsWith('https://github.com/login/oauth/authorize'),
      `status=${auth.status} location=${authLocation}`);
    if (process.env.KEYSTATIC_GITHUB_CLIENT_ID) {
      check('production auth redirect uses the configured client',
        new URL(authLocation).searchParams.get('client_id') === process.env.KEYSTATIC_GITHUB_CLIENT_ID);
    }
  }

  let body = '';
  let adminReady = false;
  for (let loadAttempt = 0; loadAttempt < 3 && !adminReady; loadAttempt++) {
    const path = loadAttempt === 0 ? '/admin/' : `/keystatic?smoke=${loadAttempt}`;
    await send('Page.navigate', { url: new URL(path, base).href });
    for (let attempt = 0; attempt < 60; attempt++) {
      await sleep(250);
      body = await evaluate('document.body?.innerText || ""');
      adminReady = mode === 'local'
        ? /Kitchen Log/i.test(body) && /Menu projects/i.test(body)
        : /GitHub|log in|sign in/i.test(body);
      if (adminReady) break;
    }
    if (!adminReady) runtimeErrors.length = 0;
  }

  const state = await evaluate(`({
    pathname: location.pathname,
    title: document.title,
    text: document.body?.innerText || '',
    links: [...document.querySelectorAll('a')].map((link) => ({
      text: link.textContent?.trim() || '',
      href: link.getAttribute('href') || '',
    })),
  })`);

  check('/admin redirects to the CMS', state.pathname.startsWith('/keystatic'), state.pathname);
  if (mode === 'local') {
    check('CMS shows the NightBowl collections',
      /Kitchen Log/i.test(state.text) && /Menu projects/i.test(state.text),
      state.text.slice(0, 240).replace(/\s+/g, ' '));
    check('CMS shows editable singleton copy', /Site copy/i.test(state.text));
    const postsLink = state.links.find((link) => /Kitchen Log/i.test(link.text));
    check('Kitchen Log collection is navigable', !!postsLink, JSON.stringify(state.links.slice(0, 8)));
    if (postsLink) {
      await send('Page.navigate', { url: new URL(postsLink.href, base).href });
      let collectionText = '';
      for (let attempt = 0; attempt < 40; attempt++) {
        await sleep(250);
        collectionText = await evaluate('document.body?.innerText || ""');
        if (/Training a chess engine|Why a ramen stall/i.test(collectionText)) break;
      }
      check('existing Kitchen Log content is discoverable',
        /Training a chess engine|Why a ramen stall/i.test(collectionText),
        collectionText.slice(0, 240).replace(/\s+/g, ' '));
      const opened = await evaluate(`(() => {
        const leaf = [...document.querySelectorAll('*')]
          .find((element) => element.children.length === 0
            && /Training a chess engine|Why a ramen stall/i.test(element.textContent || ''));
        if (!leaf) return false;
        leaf.click();
        return true;
      })()`);
      for (let attempt = 0; attempt < 20; attempt++) {
        await sleep(200);
        if (/\/item\//.test(await evaluate('location.pathname'))) break;
      }
      const itemPath = await evaluate('location.pathname');
      check('Kitchen Log entries can be opened for editing', opened && /\/item\//.test(itemPath), itemPath);
      if (/\/item\//.test(itemPath)) {
        let editorText = '';
        for (let attempt = 0; attempt < 40; attempt++) {
          await sleep(250);
          editorText = await evaluate('document.body?.innerText || ""');
          if (/Publishing status/i.test(editorText) && /Excerpt/i.test(editorText)) break;
        }
        check('editor exposes draft/publish controls',
          /Publishing status/i.test(editorText) && /Draft/i.test(editorText) && /Published/i.test(editorText));
        check('editor exposes content fields and save action',
          /Excerpt/i.test(editorText) && /Tags/i.test(editorText) && /Save/i.test(editorText));
        const previewControl = await evaluate(`!!document.querySelector(
          '[aria-label*="preview" i], [title*="preview" i], a[href*="/preview/"]'
        )`);
        check('editor exposes preview action', /Preview/i.test(editorText) || previewControl);
      }
    }
  } else {
    check('production CMS requires GitHub authentication',
      /GitHub|log in|sign in/i.test(state.text),
      state.text.slice(0, 240).replace(/\s+/g, ' '));
  }

  await send('Page.navigate', {
    url: new URL('/preview/log/chess-engine-my-games/', base).href,
  });
  let previewReady = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(250);
    previewReady = await evaluate(`!!document.querySelector('.log-article')`);
    if (previewReady) break;
  }
  const postPreview = await evaluate(`({
    title: document.querySelector('h1')?.textContent?.trim() || '',
    banner: document.querySelector('.preview-banner')?.textContent?.trim() || '',
    robots: document.querySelector('meta[name="robots"]')?.content || '',
  })`);
  check('draft post preview renders', previewReady && /Training a chess engine/i.test(postPreview.title));
  check('draft preview is clearly marked and not indexed',
    /Draft preview/i.test(postPreview.banner) && /noindex/i.test(postPreview.robots));

  await send('Page.navigate', { url: new URL('/?preview=menu', base).href });
  let menuPreview;
  for (let attempt = 0; attempt < 60; attempt++) {
    await sleep(250);
    menuPreview = await evaluate(`({
      banner: !document.getElementById('previewBanner')?.hidden,
      open: document.getElementById('book')?.classList.contains('open') || false,
      active: document.querySelector('#tabs button.active')?.dataset.tab || '',
    })`);
    if (menuPreview.banner && menuPreview.open) break;
  }
  check('site-copy preview opens the menu',
    menuPreview?.banner && menuPreview?.open && menuPreview?.active === 'menu',
    JSON.stringify(menuPreview));
  check('CMS has no uncaught browser errors', runtimeErrors.length === 0,
    runtimeErrors.slice(0, 2).join(' | '));
} finally {
  ws.close();
  chrome.kill('SIGKILL');
  await sleep(300);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

if (failures.length) {
  console.error(`\n${failures.length} CMS check(s) failed`);
  process.exit(1);
}
console.log('\nall CMS checks passed\n');
