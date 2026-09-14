/* ============================================================
   nightbowl smoke test

   Drives a real headless Chrome over the DevTools protocol and checks the
   things that break silently:

     - the scene throws during construction (renders a "scene error" panel,
       logs one line, and otherwise looks like a normal page)
     - a non-finite value leaks into a character rig (renders as a vanished
       or mangled person and throws nothing at all)
     - the intro never completes, so the site stays unusable
     - the director never fires, so the stall is a still life

   Usage:  node scripts/smoke.mjs [--url http://localhost:4321]
   Env:    CHROME_PATH   explicit browser binary
           SMOKE_FLAGS   extra Chrome flags (CI uses swiftshader)
   ============================================================ */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const URL_ = arg('--url', 'http://localhost:4321');
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

function findChrome() {
  for (const p of CANDIDATES) if (existsSync(p)) return p;
  throw new Error('No Chrome binary found. Set CHROME_PATH.');
}

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures.push(name + (detail ? ': ' + detail : ''));
};

async function session(flags, run) {
  const profile = mkdtempSync(join(tmpdir(), 'nightbowl-smoke-'));
  const chrome = spawn(findChrome(), [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,800',
    ...(process.env.SMOKE_FLAGS ? process.env.SMOKE_FLAGS.split(' ') : []),
    ...flags,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  // Keep Chrome's own output. If it fails to start, that output is the only
  // thing that says why, and discarding it turns a five minute fix into a
  // guessing game against CI.
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
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch { /* not up yet */ }
  }
  if (!target) {
    chrome.kill('SIGKILL');
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    throw new Error(
      `Chrome never exposed a debugging target on port ${PORT}`
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
  const send = (method, params = {}) =>
    new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');

  try {
    await run({ send, evaluate, errors });
  } finally {
    ws.close();
    chrome.kill('SIGKILL');
    // Chrome keeps writing to its profile for a moment after the signal, so give
    // it time and never let tidying up decide whether the run passed.
    await sleep(500);
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp dir */ }
  }
}

async function load({ send, evaluate }) {
  await send('Page.navigate', { url: `${URL_}/?nbtest=1` });
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (await evaluate('!!window.__nightbowl')) return true;
    const msg = await evaluate(`document.getElementById('loading')?.textContent || ''`);
    if (/scene error/i.test(msg)) return false;
  }
  return false;
}

console.log(`\nnightbowl smoke test → ${URL_}\n`);

// ---- pass 1: the normal path ----
console.log('normal load');
await session([], async (ctx) => {
  const { evaluate, errors } = ctx;
  const booted = await load(ctx);
  check('scene initialises', booted, booted ? '' : 'scene error panel or no handle');
  if (!booted) return;

  const before = await evaluate('window.__nightbowl.selfCheck()');
  check('cook, diners and walkers exist',
    before.cook && before.diners >= 4 && before.walkers >= 2,
    `cook=${before.cook} diners=${before.diners} walkers=${before.walkers}`);
  check('no non-finite values in any rig', before.nonFinite === 0, `count=${before.nonFinite}`);
  check('starts in first person', before.phase === 'street', `phase=${before.phase}`);
  check('nav pins hidden before sitting',
    (await evaluate(`document.getElementById('pins').style.display`)) === 'none');
  check('seat prompt is offered', await evaluate(`!!document.querySelector('.seat-pin')`));
  check('top bar nav is live before sitting',
    (await evaluate(`document.querySelectorAll('.topbar [data-open]').length`)) > 0);

  await evaluate(`document.querySelector('.seat-pin').click()`);
  let seated = false;
  for (let i = 0; i < 40 && !seated; i++) {
    await sleep(500);
    seated = (await evaluate('window.__nightbowl.selfCheck()')).phase === 'seated';
  }
  check('sitting down completes', seated);

  const after = await evaluate('window.__nightbowl.selfCheck()');
  check('no non-finite values after the intro', after.nonFinite === 0, `count=${after.nonFinite}`);
  check('nav pins appear once seated',
    (await evaluate(`document.getElementById('pins').style.display`)) === '');
  check('seat prompt is gone', !(await evaluate(`!!document.querySelector('.seat-pin')`)));
  check('you are shown at the counter', await evaluate(`!!document.querySelector('.you-pin')`));

  // the director is on a randomised timer, so poll rather than assume a moment
  let spoke = false;
  for (let i = 0; i < 90 && !spoke; i++) {
    await sleep(500);
    spoke = (await evaluate(`document.querySelectorAll('.say').length`)) > 0;
  }
  check('the NPCs talk to each other', spoke, spoke ? '' : 'no speech bubble within 45s');

  check('no uncaught exceptions', errors.length === 0, errors.slice(0, 2).join(' | '));
});

// ---- pass 2: reduced motion must skip the intro entirely ----
console.log('\nprefers-reduced-motion');
await session(['--force-prefers-reduced-motion'], async (ctx) => {
  const { evaluate, errors } = ctx;
  const booted = await load(ctx);
  check('scene initialises', booted);
  if (!booted) return;
  const st = await evaluate('window.__nightbowl.selfCheck()');
  check('skips straight to seated', st.phase === 'seated', `phase=${st.phase}`);
  check('no non-finite values in any rig', st.nonFinite === 0, `count=${st.nonFinite}`);
  check('no seat prompt', !(await evaluate(`!!document.querySelector('.seat-pin')`)));
  check('nav pins are visible immediately',
    (await evaluate(`document.getElementById('pins').style.display`)) !== 'none');
  check('no uncaught exceptions', errors.length === 0, errors.slice(0, 2).join(' | '));
});

console.log('');
if (failures.length) {
  console.error(`${failures.length} check(s) failed:`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('all checks passed\n');
