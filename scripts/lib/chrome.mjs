/* ============================================================
   Shared headless-Chrome driver.

   scripts/smoke.mjs predates this and keeps its own copy; these helpers exist
   so the audit and baseline scripts do not each grow a third one.

   Env:  CHROME_PATH   explicit browser binary
         SMOKE_FLAGS   extra Chrome flags (CI uses swiftshader)
   ============================================================ */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

export function findChrome() {
  for (const p of CANDIDATES) if (existsSync(p)) return p;
  throw new Error(
    'No Chrome binary found. Set CHROME_PATH to a Chrome or Chromium executable.'
  );
}

/** True when Chrome was asked to rasterise in software (no GPU on the runner). */
export const softwareRenderer = () => /swiftshader/i.test(process.env.SMOKE_FLAGS || '');

let nextPort = 9600;

/**
 * Boot Chrome, hand `run` a CDP channel, and always tear the browser down.
 * `flags` are appended after SMOKE_FLAGS so a caller can override.
 */
export async function session({ flags = [], width = 1280, height = 800 }, run) {
  const port = nextPort++;
  const profile = mkdtempSync(join(tmpdir(), 'nightbowl-audit-'));
  const chrome = spawn(findChrome(), [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--window-size=${width},${height}`,
    ...(process.env.SMOKE_FLAGS ? process.env.SMOKE_FLAGS.split(' ').filter(Boolean) : []),
    ...flags,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  // Chrome's own output is the only explanation when it refuses to start.
  let chromeLog = '';
  const keep = (d) => { chromeLog = (chromeLog + d).slice(-4000); };
  chrome.stdout.on('data', keep);
  chrome.stderr.on('data', keep);
  let exited = null;
  chrome.on('exit', (code, sig) => { exited = `exit=${code} signal=${sig}`; });

  let target = null;
  for (let i = 0; i < 120 && !target && exited === null; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch { /* not up yet */ }
  }
  if (!target) {
    chrome.kill('SIGKILL');
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    throw new Error(
      `Chrome never exposed a debugging target on port ${port}`
      + (exited ? ` (process ${exited})` : ' (still running)')
      + (chromeLog ? `\n--- chrome output ---\n${chromeLog.trim()}` : '\n(no output captured)')
    );
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push(d.exception?.description || d.text);
    }
  });

  const send = (method, params = {}) => new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (r.result?.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error(d.exception?.description || d.text);
    }
    return r.result?.result?.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');

  try {
    return await run({ send, evaluate, errors });
  } finally {
    ws.close();
    chrome.kill('SIGKILL');
    await sleep(400);
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp dir */ }
  }
}

/** Navigate and wait until the scene handle and the menu markup both exist. */
export async function openScene({ send, evaluate }, url, query = '?nbtest=1') {
  await send('Page.navigate', { url: `${url}/${query}` });
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    const ready = await evaluate(`!!window.__nightbowl
      && document.readyState === 'complete'
      && !!document.getElementById('book')`);
    if (ready) return true;
    const msg = await evaluate(`document.getElementById('loading')?.textContent || ''`);
    if (/scene error/i.test(msg)) return false;
  }
  return false;
}
