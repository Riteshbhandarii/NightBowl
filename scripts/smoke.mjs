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
// Not a fixed port: a Chrome left behind by an earlier run still answers on it,
// and the next run attaches to that stale browser instead of the one it just
// spawned. Nothing errors, the flags just belong to the wrong process. The
// about:blank assertion below is the backstop.
let nextPort = 9300 + Math.floor(Math.random() * 600);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Navigation pins that do not currently sit on the object they label. Listing
// them keeps the check honest about what is broken instead of loosening it for
// everyone: anything not named here has to be on target at every viewport.
const PIN_DRIFT = {};
const fmtRect = (r) => `${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.right)},${Math.round(r.bottom)}`;

/* The navigation pins are DOM buttons re-positioned every frame from a point in
   the 3D scene. They can slide off the object they name, or land on top of each
   other so one is unclickable, and neither shows up as an error. Called from
   both viewport passes; the book must be closed, because the scene hides every
   pin while it is open. */
async function checkPins({ evaluate }, where) {
  let pinState = null;
  for (let i = 0; i < 24 && !pinState?.pins?.length; i++) {
    pinState = await evaluate('window.__nightbowl.auditPins()');
    if (!pinState?.pins?.length) await sleep(250);
  }
  const shownPins = (pinState?.pins || []).filter((pin) => pin.shown);
  check(`${where}: navigation pins are built`, (pinState?.pins || []).length > 0);
  check(`${where}: at least one pin is on screen`, shownPins.length > 0,
    `shown=${shownPins.map((pin) => pin.key).join(',') || 'none'}`);

  // A pin is anchored when its rect overlaps the screen-space box of the object
  // it labels. PIN_DRIFT lists the pins that do not manage that today, so the
  // ones that do cannot quietly join them.
  for (const pin of shownPins) {
    const known = PIN_DRIFT[pin.key];
    if (known) {
      // Failing when a listed pin comes back on target is deliberate: the entry
      // is now lying about the scene and has to go, or that pin is unprotected
      // forever. The message says exactly that rather than reporting a drift
      // that is no longer there.
      check(`${where}: ${pin.key} pin drift is unchanged`, !pin.onTarget,
        pin.onTarget
          ? `now on target — ${known} looks fixed, delete the ${pin.key} entry from PIN_DRIFT`
          : `still drifting, tracked by ${known}`);
    } else {
      check(`${where}: ${pin.key} pin sits on what it labels`, pin.onTarget,
        `pin=${fmtRect(pin.rect)} object=${pin.target ? fmtRect(pin.target) : 'off screen'}`);
    }
  }

  // Two pins on top of each other means one of them cannot be clicked.
  const collisions = [];
  for (let i = 0; i < shownPins.length; i++) {
    for (let j = i + 1; j < shownPins.length; j++) {
      const a = shownPins[i].rect, b = shownPins[j].rect;
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (overlapX > 0 && overlapY > 0) {
        collisions.push(`${shownPins[i].key}/${shownPins[j].key}`
          + ` ${Math.round(overlapX)}x${Math.round(overlapY)}px`);
      }
    }
  }
  check(`${where}: pins do not overlap each other`, collisions.length === 0, collisions.join(', '));

  // A hidden pin is only acceptable if its anchor really is outside the band the
  // scene draws pins in. Hiding one that is plainly on screen would mean a
  // section became unreachable from the 3D view.
  const wronglyHidden = (pinState?.pins || []).filter((pin) => {
    if (pin.shown) return false;
    const { x, y, behind } = pin.anchor;
    const w = pinState.viewport.width, h = pinState.viewport.height;
    return !(behind || x < 40 || x > w - 40 || y < 74 || y > h - 40);
  });
  check(`${where}: hidden pins are hidden because they are off screen`, wronglyHidden.length === 0,
    wronglyHidden.map((pin) => `${pin.key}@${Math.round(pin.anchor.x)},${Math.round(pin.anchor.y)}`).join(', '));
}

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
  const port = nextPort++;
  const profile = mkdtempSync(join(tmpdir(), 'nightbowl-smoke-'));
  const chrome = spawn(findChrome(), [
    '--headless=new',
    `--remote-debugging-port=${port}`,
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
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch { /* not up yet */ }
  }
  // A leftover browser from a previous run answers with a page already
  // navigated somewhere. Refuse it rather than measure the wrong thing.
  if (target && !/^(about:blank|chrome:\/\/new-tab-page)/.test(target.url || '')) {
    chrome.kill('SIGKILL');
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    throw new Error(`Port ${port} is already serving a different Chrome (target url ${target.url}).`
      + ' Close stray headless Chrome processes and run again.');
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
  const send = (method, params = {}) =>
    new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) {
      const detail = r.result.exceptionDetails;
      throw new Error(detail.exception?.description || detail.text);
    }
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
    // The Scene script executes before MenuBook appears later in the document.
    // Waiting only for the scene handle races the HTML parser on slower runs.
    if (await evaluate(`!!window.__nightbowl
      && document.readyState === 'complete'
      && !!document.getElementById('book')`)) return true;
    const msg = await evaluate(`document.getElementById('loading')?.textContent || ''`);
    if (/scene error/i.test(msg)) return false;
  }
  return false;
}

async function loadPage({ send, evaluate }, path, readySelector) {
  await send('Page.navigate', { url: new URL(path, URL_).href });
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    if (await evaluate(`document.readyState === 'complete'
      && !!document.querySelector(${JSON.stringify(readySelector)})`)) return true;
  }
  return false;
}

console.log(`\nnightbowl smoke test → ${URL_}\n`);

// ---- pass 1: the normal path ----
console.log('normal load');
await session([], async (ctx) => {
  const { send, evaluate, errors } = ctx;
  const booted = await load(ctx);
  check('scene initialises', booted, booted ? '' : 'scene error panel or no handle');
  if (!booted) return;

  const before = await evaluate('window.__nightbowl.selfCheck()');
  check('cook, diners and walkers exist',
    before.cook && before.diners === 3 && before.visitor && before.walkers >= 2,
    `cook=${before.cook} diners=${before.diners} visitor=${before.visitor} walkers=${before.walkers}`);
  check('visitor is not an autonomous diner', !before.visitorAutonomous);
  check('each speaking character has a distinct mouth phase',
    before.mouthPhases.length === 4 && new Set(before.mouthPhases).size === 4,
    JSON.stringify(before.mouthPhases));
  check('each NPC keeps a distinct action tempo',
    before.actionTempos.length === 4
      && new Set(before.actionTempos).size === 4
      && before.actionTempos.every((tempo) => tempo >= 0.82 && tempo <= 1.18),
    JSON.stringify(before.actionTempos));
  check('each diner owns a reachable bowl, chopsticks and cup',
    before.dinerStations.length === 3 && before.dinerStations.every((station) =>
      Math.abs(station.seatX - station.bowlX) < 0.01
      && station.bowlZ >= 0.85
      && station.hasHeldChopsticks
      && station.hasCup),
    JSON.stringify(before.dinerStations));
  check('diner props match what their hands are doing',
    before.dinerActions.every((state) =>
      state.action === 'eat' && state.biting
        ? state.heldChopsticks && !state.restingChopsticks && !state.heldCup
        : state.action === 'drink'
          ? state.heldCup && !state.counterCup && !state.heldChopsticks
          : state.restingChopsticks && state.counterCup && !state.heldChopsticks && !state.heldCup),
    JSON.stringify(before.dinerActions));
  check('cook works at the pot with real props',
    before.cookStationOffset >= 0.3 && before.cookStationOffset <= 0.6
      && before.cookHasWorkingProps
      && before.pot.scale <= 0.6 && before.pot.y <= 1.03,
    JSON.stringify(before.pot));
  check('three detailed ramen bowls exist',
    before.ramenBowls === 3 && before.heroBowls === 1
      && before.ramenIngredients.every((parts) => parts.length === 8),
    `bowls=${before.ramenBowls} hero=${before.heroBowls}`);
  check('steam uses curling ribbons', before.steamSources === 4 && before.steamStyle,
    `sources=${before.steamSources} ribbons=${before.steamStyle}`);
  check('ramen detail stays inside the scene budget', before.renderCalls <= 250 && before.triangles <= 50000,
    `calls=${before.renderCalls} triangles=${before.triangles}`);
  check('no non-finite values in any rig', before.nonFinite === 0, `count=${before.nonFinite}`);
  check('starts in first person', before.phase === 'street', `phase=${before.phase}`);
  check('nav pins hidden before sitting',
    (await evaluate(`document.getElementById('pins').style.display`)) === 'none');
  const seatTarget = await evaluate(`(() => {
    const el = document.querySelector('.seat-pin');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height, text: el.textContent.trim(), aria: el.getAttribute('aria-label'),
      x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  check('the glowing chair has a wordless finger-sized seat target',
    seatTarget && seatTarget.width >= 112 && seatTarget.height >= 132
      && seatTarget.text === '' && !!seatTarget.aria,
    JSON.stringify(seatTarget));
  check('top bar nav is live before sitting',
    (await evaluate(`document.querySelectorAll('.topbar [data-open]').length`)) > 0);

  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: seatTarget.x, y: seatTarget.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: seatTarget.x, y: seatTarget.y, button: 'left', clickCount: 1 });
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
  check('seat target is gone', !(await evaluate(`!!document.querySelector('.seat-pin')`)));
  check('you are shown at the counter', await evaluate(`!!document.querySelector('.you-pin')`));

  // Force one bowl empty and observe the entire causal loop. This catches the
  // old screensaver behaviour where arms moved forever but food and cook state
  // never changed.
  check('test can empty a diner bowl', await evaluate('window.__nightbowl.testEmptyBowl(0)'));
  let sawService = false, sawLift = false, sawFilledCarry = false, serviceDone = false;
  let sawSafeCarryPose = false, unsafeCarryPose = null;
  for (let i = 0; i < 40 && !serviceDone; i++) {
    await sleep(250);
    const state = await evaluate('window.__nightbowl.selfCheck()');
    // Read the latched audit rather than sampling for a transient: under a slow
    // software renderer the carry phase can pass entirely between two polls.
    sawService ||= state.serviceAudit?.started || (!!state.service?.active && state.cookAction === 'serve');
    sawLift ||= !!state.serviceAudit?.lifted;
    sawFilledCarry ||= !!state.serviceAudit?.filledCarry;
    const carryPose = state.service?.carryPose;
    if (carryPose?.carrying) {
      const safe = carryPose.handSeparation >= 0.25 && carryPose.faceClearance >= 0.07;
      sawSafeCarryPose ||= safe;
      if (!safe) unsafeCarryPose = carryPose;
    }
    serviceDone = !state.service
      && state.dinerActions[0].fill > 0.95
      && !state.dinerActions[0].needsService
      && state.dinerActions[0].bowlVisible;
  }
  check('cook reacts to an empty bowl', sawService);
  check('cook takes the empty bowl off the counter', sawLift);
  check('the bowl refilled is the one in the cook\'s hands, seat left empty', sawFilledCarry);
  check('cook carries the bowl below his face with uncrossed hands',
    sawSafeCarryPose && !unsafeCarryPose, JSON.stringify(unsafeCarryPose));
  check('cook returns a full bowl and diner resumes', serviceDone,
    JSON.stringify((await evaluate('window.__nightbowl.selfCheck()')).dinerActions[0]));

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

// ---- pass 3: the book must fill large screens without escaping small ones ----
console.log('\nbook layout');
await session(['--force-prefers-reduced-motion'], async (ctx) => {
  const { send, evaluate, errors } = ctx;
  const viewports = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'compact desktop', width: 1024, height: 768 },
    { name: 'mobile', width: 390, height: 844 },
  ];

  for (const viewport of viewports) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.name === 'mobile',
    });
    const booted = await load(ctx);
    check(`${viewport.name}: scene initialises`, booted);
    if (!booted) continue;

    // Before the book opens: the scene hides every pin while it is open.
    await checkPins(ctx, viewport.name);

    await evaluate(`document.dispatchEvent(new CustomEvent('nb:open', { detail: 'menu' }))`);
    await sleep(100);
    const layout = await evaluate(`(() => {
      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      };
      const book = document.getElementById('book');
      const close = document.getElementById('bookClose');
      return {
        url: location.href,
        missing: [!book && 'book', !close && 'bookClose'].filter(Boolean),
        viewport: { width: innerWidth, height: innerHeight },
        book: rect(book),
        close: rect(close),
        tabs: [...document.querySelectorAll('#tabs button')].map(rect),
        horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
        pages: [...document.querySelectorAll('.book-inner .page')]
          .filter((el) => getComputedStyle(el).display !== 'none')
          .map((el) => ({ client: el.clientHeight, scroll: el.scrollHeight })),
      };
    })()`);
    const contained = (r) => r.left >= -0.5 && r.top >= -0.5
      && r.right <= layout.viewport.width + 0.5 && r.bottom <= layout.viewport.height + 0.5;

    check(`${viewport.name}: book UI exists`, layout.missing.length === 0,
      layout.missing.length ? `${layout.url}: missing ${layout.missing.join(', ')}` : '');
    if (layout.missing.length) continue;

    check(`${viewport.name}: book stays in viewport`, contained(layout.book),
      `${Math.round(layout.book.width)}x${Math.round(layout.book.height)}`);
    check(`${viewport.name}: controls stay reachable`,
      contained(layout.close) && layout.tabs.every(contained));
    if (viewport.name !== 'mobile') {
      check(`${viewport.name}: tabs stay off the page`,
        layout.tabs.every((tab) => tab.left >= layout.book.right - 0.5),
        `bookRight=${Math.round(layout.book.right)} tabLeft=${Math.round(Math.min(...layout.tabs.map((tab) => tab.left)))}`);
    }
    check(`${viewport.name}: no horizontal page overflow`, layout.horizontalOverflow <= 0.5,
      `overflow=${layout.horizontalOverflow}`);

    const sections = ['menu', 'guide', 'log', 'bill'];
    for (const section of sections) {
      await evaluate(`document.querySelector('#tabs [data-tab="${section}"]').click()`);
      await sleep(20);
      const state = await evaluate(`(() => {
        const active = document.querySelector('#tabs button.active')?.dataset.tab;
        const visible = [...document.querySelectorAll('.book-inner .page')]
          .filter((el) => getComputedStyle(el).display !== 'none');
        return {
          active,
          text: visible.map((el) => el.textContent.trim()).join('|'),
          pages: visible.map((el) => ({ client: el.clientHeight, scroll: el.scrollHeight })),
          horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
        };
      })()`);
      check(`${viewport.name}: ${section} tab activates`,
        state.active === section && state.text.length > 0, `active=${state.active}`);
      check(`${viewport.name}: ${section} has no horizontal overflow`,
        state.horizontalOverflow <= 0.5, `overflow=${state.horizontalOverflow}`);
      if (viewport.name === 'desktop') {
        check(`desktop: ${section} pages fit without scrolling`,
          state.pages.every((p) => p.scroll <= p.client + 1), JSON.stringify(state.pages));
      }

      if (section === 'menu') {
        const turned = await evaluate(`(() => {
          const page = document.getElementById('pageRight');
          const before = page.textContent.trim();
          const control = page.querySelector('.pageflip-hint');
          if (!control) return { found: false, changed: false, pages: [] };
          control.click();
          const visible = [...document.querySelectorAll('.book-inner .page')]
            .filter((el) => getComputedStyle(el).display !== 'none');
          return {
            found: true,
            changed: page.textContent.trim() !== before,
            pages: visible.map((el) => ({ client: el.clientHeight, scroll: el.scrollHeight })),
          };
        })()`);
        check(`${viewport.name}: menu page-turn changes the spread`, turned.found && turned.changed);
        if (viewport.name === 'desktop') {
          check('desktop: turned menu pages fit without scrolling',
            turned.pages.every((p) => p.scroll <= p.client + 1), JSON.stringify(turned.pages));
        }
      }
    }

    if (viewport.name === 'desktop') {
      check('desktop: book commands the viewport', layout.book.width >= 1170 && layout.book.height >= 770,
        `${Math.round(layout.book.width)}x${Math.round(layout.book.height)}`);
    }
    if (viewport.name === 'mobile') {
      check('mobile: book remains full-screen',
        Math.abs(layout.book.width - layout.viewport.width) <= 1
          && Math.abs(layout.book.height - layout.viewport.height) <= 1,
        `${Math.round(layout.book.width)}x${Math.round(layout.book.height)}`);
    }
  }

  check('book layout: no uncaught exceptions', errors.length === 0, errors.slice(0, 2).join(' | '));
});

// ---- pass 4: the Kitchen Log is a real, responsive content surface ----
console.log('\nkitchen log');
await session([], async (ctx) => {
  const { send, evaluate, errors } = ctx;
  for (const viewport of [
    { name: 'desktop', width: 1280, height: 800, mobile: false },
    { name: 'mobile', width: 390, height: 844, mobile: true },
  ]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile,
    });
    const loaded = await loadPage(ctx, '/log/', '.log-index');
    check(`${viewport.name}: Kitchen Log index loads`, loaded);
    if (!loaded) continue;
    const log = await evaluate(`(() => ({
      title: document.querySelector('h1')?.textContent.trim(),
      entries: document.querySelectorAll('.log-index > li').length,
      drafts: document.querySelectorAll('.log-index > li.draft').length,
      linkedDrafts: document.querySelectorAll('.log-index > li.draft h2 a').length,
      homeLink: document.querySelector('.log-header a[href="/"]')?.textContent.trim(),
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
    }))()`);
    check(`${viewport.name}: Kitchen Log has its own index`,
      log.title === 'Kitchen Log' && log.entries > 0 && !!log.homeLink,
      `title=${log.title} entries=${log.entries}`);
    check(`${viewport.name}: drafts are teasers, not links`,
      log.drafts > 0 && log.linkedDrafts === 0,
      `drafts=${log.drafts} linked=${log.linkedDrafts}`);
    check(`${viewport.name}: Kitchen Log has no horizontal overflow`,
      log.horizontalOverflow <= 0.5, `overflow=${log.horizontalOverflow}`);
  }
  check('Kitchen Log: no uncaught exceptions', errors.length === 0, errors.slice(0, 2).join(' | '));
});

// ---- pass 5: cover the viewport shapes that routinely break fixed 3D shells ----
console.log('\ncross-device matrix');
await session(['--force-prefers-reduced-motion'], async (ctx) => {
  const { send, evaluate, errors } = ctx;
  const devices = [
    { name: 'small phone portrait', width: 320, height: 568, touch: true },
    { name: 'large phone portrait', width: 430, height: 932, touch: true },
    { name: 'phone landscape', width: 844, height: 390, touch: true },
    { name: 'very narrow phone', width: 280, height: 653, touch: true },
    { name: 'tablet portrait', width: 768, height: 1024, touch: true },
    { name: 'tablet landscape', width: 1024, height: 768, touch: true },
    { name: 'small laptop', width: 1366, height: 768, touch: false },
    { name: 'wide monitor', width: 1920, height: 1080, touch: false },
  ];

  for (const device of devices) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: device.width,
      height: device.height,
      deviceScaleFactor: device.touch ? 2 : 1,
      mobile: device.touch,
    });
    await send('Emulation.setTouchEmulationEnabled', {
      enabled: device.touch,
      maxTouchPoints: device.touch ? 5 : 1,
    });
    const booted = await load(ctx);
    check(`${device.name}: scene initialises`, booted);
    if (!booted) continue;

    const shell = await evaluate(`(() => {
      const rect = (element) => {
        const r = element?.getBoundingClientRect();
        return r && { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };
      const primary = getComputedStyle(document.querySelector('.menu-toggle')).display !== 'none'
        ? document.querySelector('.menu-toggle')
        : document.querySelector('.nav');
      return {
        primary: rect(primary),
        wordmark: rect(document.querySelector('.wordmark')),
        overflowX: document.documentElement.scrollWidth - innerWidth,
        overflowY: document.documentElement.scrollHeight - innerHeight,
        touchAction: getComputedStyle(document.getElementById('scene')).touchAction,
      };
    })()`);
    const contained = (rect) => rect && rect.left >= -0.5 && rect.top >= -0.5
      && rect.right <= device.width + 0.5 && rect.bottom <= device.height + 0.5;
    check(`${device.name}: primary controls remain reachable`,
      contained(shell.primary) && contained(shell.wordmark), JSON.stringify(shell));
    check(`${device.name}: shell has no page overflow`,
      shell.overflowX <= 0.5 && shell.overflowY <= 0.5,
      `x=${shell.overflowX} y=${shell.overflowY}`);
    if (device.touch) {
      check(`${device.name}: canvas owns touch gestures`, shell.touchAction === 'none', shell.touchAction);
    }

    if (device.name === 'phone landscape') {
      const sceneCost = await evaluate(`(() => {
        const state = window.__nightbowl.selfCheck();
        return { calls: state.renderCalls, triangles: state.triangles };
      })()`);
      check(`${device.name}: visible geometry stays inside the 50,000 triangle budget`,
        sceneCost.triangles <= 50000,
        `calls=${sceneCost.calls} triangles=${sceneCost.triangles}`);
    }

    await checkPins(ctx, device.name);

    await evaluate(`document.dispatchEvent(new CustomEvent('nb:open', { detail: 'menu' }))`);
    await sleep(30);
    const bookUi = await evaluate(`(() => {
      const rect = (element) => {
        const r = element?.getBoundingClientRect();
        return r && { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };
      return {
        close: rect(document.getElementById('bookClose')),
        tabs: [...document.querySelectorAll('#tabs button')].map(rect),
        overflowX: document.documentElement.scrollWidth - innerWidth,
      };
    })()`);
    check(`${device.name}: book controls remain reachable`,
      contained(bookUi.close) && bookUi.tabs.every(contained));
    check(`${device.name}: book creates no horizontal overflow`, bookUi.overflowX <= 0.5);
    await evaluate(`document.getElementById('bookClose').click()`);

    if (device.touch) {
      const gesture = await evaluate(`(() => {
        const canvas = document.getElementById('scene');
        const before = window.__nightbowl.selfCheck().camera;
        const fire = (type, id, x, y) => canvas.dispatchEvent(new PointerEvent(type, {
          pointerId: id, pointerType: 'touch', clientX: x, clientY: y,
          bubbles: true, cancelable: true, isPrimary: id === 1,
        }));
        const scrollBefore = { x: scrollX, y: scrollY };
        fire('pointerdown', 1, 120, 180);
        fire('pointermove', 1, 175, 200);
        fire('pointerup', 1, 175, 200);
        const afterDrag = window.__nightbowl.selfCheck().camera;
        fire('pointerdown', 1, 110, 210);
        fire('pointerdown', 2, 210, 210);
        fire('pointermove', 1, 70, 210);
        fire('pointermove', 2, 250, 210);
        fire('pointerup', 1, 70, 210);
        fire('pointerup', 2, 250, 210);
        const afterPinch = window.__nightbowl.selfCheck().camera;
        return {
          dragged: Math.abs(afterDrag.azimuth - before.azimuth) > 0.01,
          pinched: Math.abs(afterPinch.radius - afterDrag.radius) > 0.05,
          stayedPut: scrollX === scrollBefore.x && scrollY === scrollBefore.y,
        };
      })()`);
      check(`${device.name}: drag rotates the camera`, gesture.dragged);
      check(`${device.name}: pinch zooms the camera`, gesture.pinched);
      check(`${device.name}: gestures do not scroll the page`, gesture.stayedPut);
    }
  }
  check('cross-device matrix: no uncaught exceptions', errors.length === 0,
    errors.slice(0, 2).join(' | '));
});

// ---- pass 6: weak or disabled WebGL must leave the content UI usable ----
console.log('\nWebGL fallback');
await session(['--disable-webgl', '--disable-gpu'], async (ctx) => {
  const { send, evaluate, errors } = ctx;
  await send('Page.navigate', { url: `${URL_}/?fallback=1` });
  let failed = false;
  for (let i = 0; i < 30 && !failed; i++) {
    await sleep(250);
    failed = await evaluate(`document.getElementById('loading')?.classList.contains('failed') || false`);
  }
  check('disabled WebGL shows the fallback', failed);
  const fallback = await evaluate(`({
    canvasHidden: document.getElementById('scene')?.hidden || false,
    message: document.getElementById('loading')?.textContent?.trim() || '',
    navVisible: !!document.querySelector('[data-open="menu"]'),
  })`);
  check('fallback hides the dead canvas and explains the failure',
    fallback.canvasHidden && fallback.message.length > 5, fallback.message);
  check('fallback keeps content navigation available', fallback.navVisible);
  await evaluate(`document.querySelector('[data-open="menu"]').click()`);
  await sleep(50);
  check('menu still opens without WebGL',
    await evaluate(`document.getElementById('book')?.classList.contains('open') || false`));
  check('fallback has no uncaught exceptions', errors.length === 0, errors.slice(0, 2).join(' | '));
});

// ---- pass 7: repeatable throttled-load budget (FCP is the supported paint metric) ----
console.log('\nthrottled 4G load');

// Two budgets for the same assertion, because the same page genuinely takes
// longer without a GPU, and because the software path is noisy.
//
//   hardware GPU, local          ~1670ms
//   software rasteriser, local    3215ms
//   software rasteriser, runner   2748ms and 4143ms on two runs
//
// 2500ms is the product target and hardware meets it. The software numbers
// spread by 1.4s across runs on the same commit, so a bound set just above the
// worst one would go red on runner load rather than on a regression, which is
// worse than no bound at all. 6000ms sits clear of that spread and still
// catches a real doubling. It is a coarse guard, not the product target, and
// on this path it lands close to the scene-ready bound below: issue #27 is
// what makes this check sharp again. Which bound applied is printed with it.
const SOFTWARE_GPU = /swiftshader/i.test(process.env.SMOKE_FLAGS || '');
const USABLE_BUDGET = SOFTWARE_GPU ? 6000 : 2500;

await session(['--force-prefers-reduced-motion'], async (ctx) => {
  const { send, evaluate, errors } = ctx;
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: 1.6 * 1024 * 1024 / 8,
    uploadThroughput: 750 * 1024 / 8,
    connectionType: 'cellular4g',
  });
  await send('Page.navigate', { url: `${URL_}/?nbtest=1&throttled=1` });
  let measurement;
  let usableAt = 0;
  // 250ms, deliberately. Each sample calls elementFromPoint, which forces a
  // style and layout flush; polling at 50ms measurably slowed the very load
  // being timed on a software-rendered runner (2748ms became 4089ms). The
  // probe has to stay cheap enough not to be part of what it measures.
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    measurement = await evaluate(`(() => ({
      fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0,
      sceneReady: !!window.__nightbowl,
      elapsed: performance.now(),
      navigationOnTop: (() => {
        const button = document.querySelector('[data-open="menu"]');
        if (!button) return false;
        const rect = button.getBoundingClientRect();
        const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return top === button || button.contains(top);
      })(),
      sameOriginBytes: performance.getEntriesByType('resource')
        .filter((entry) => new URL(entry.name).origin === location.origin)
        .reduce((sum, entry) => sum + (entry.transferSize || 0), 0),
    }))()`);
    if (!usableAt && measurement.navigationOnTop) {
      const opened = await evaluate(`(() => {
        document.querySelector('[data-open="menu"]')?.click();
        return document.getElementById('book')?.classList.contains('open') || false;
      })()`);
      if (opened) usableAt = measurement.elapsed;
    }
    if (measurement.fcp && measurement.sceneReady && usableAt) break;
  }
  check('4G: first contentful paint stays under 2.5s',
    measurement?.fcp > 0 && measurement.fcp <= 2500,
    `FCP=${Math.round(measurement?.fcp || 0)}ms`);
  // This times the menu becoming openable, which waits on the MenuBook island
  // hydrating, not on WebGL. The scene is covered by the next check.
  check(`4G: menu content is usable inside ${USABLE_BUDGET}ms`,
    usableAt > 0 && usableAt <= USABLE_BUDGET,
    `usable=${Math.round(usableAt)}ms budget=${USABLE_BUDGET}ms`
    + ` (${SOFTWARE_GPU ? 'software renderer' : 'hardware GPU'})`);
  check('4G: interactive scene is ready inside 6s',
    measurement?.sceneReady && measurement.elapsed <= 6000,
    `ready=${measurement?.sceneReady} elapsed=${Math.round(measurement?.elapsed || 0)}ms`);
  check('4G: first-party transfer stays under 250 KiB',
    measurement?.sameOriginBytes > 0 && measurement.sameOriginBytes <= 250 * 1024,
    `transfer=${(measurement?.sameOriginBytes / 1024 || 0).toFixed(1)} KiB`);
  check('4G: no uncaught exceptions', errors.length === 0, errors.slice(0, 2).join(' | '));
});

// ---- pass 8: the walk-in must take the same wall-clock time on a slow machine ----
//
// The intro is driven by performance.now(), not by accumulated frame deltas,
// precisely so a slow machine drops frames instead of stretching the animation.
// dt is capped at 0.05s, so a frame-counted version of the same move would take
// 6.0 / (fps * 0.05) seconds — 150 seconds at the 0.8fps the CI runner manages.
//
// CPU throttling alone does not prove this: the intro is cheap enough that 6x
// throttling barely moves the frame rate on a machine with a GPU (measured
// 30.0fps at 1x, 30.1fps at 6x). So each frame is also deliberately starved by
// burning 80ms on the main thread, and there is a separate check that the
// starvation really bit, so this cannot pass by failing to load the machine.
//
// Frame rates measured for this check span 0.8fps to 30fps and worst frames
// 48ms to 5110ms. docs/ci.md carries the full table.
console.log('\nwalk-in intro is wall-clock driven');

const INTRO_NOMINAL_MS = 6000; // BEAT.walk + BEAT.sit + BEAT.hold + BEAT.pull in src/lib/scene.js

// A wall-clock animation finishes on the first frame at or after its deadline,
// so it can only ever overshoot by about one frame. That, not a percentage, is
// the right bound: the CI runner draws this intro at 0.8fps with single frames
// over four seconds long, where any fixed percentage is either meaningless or
// permanently red. The extra 750ms covers the poll interval and, in the starved
// trial, the 80ms this test itself burns after each frame.
const INTRO_POLL_SLACK_MS = 750;

for (const trial of [
  { name: 'unthrottled', rate: 1, hogMs: 0 },
  { name: '6x CPU throttle', rate: 6, hogMs: 0 },
  { name: '6x CPU throttle with starved frames', rate: 6, hogMs: 80 },
]) {
  await session([], async (ctx) => {
    const { send, evaluate } = ctx;
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    const booted = await load(ctx);
    check(`intro ${trial.name}: scene initialises`, booted);
    if (!booted) return;
    await send('Emulation.setCPUThrottlingRate', { rate: trial.rate });
    await sleep(600);

    const run = await evaluate(`(async () => {
      const api = window.__nightbowl;
      const hog = ${trial.hogMs};
      const seatPin = document.querySelector('.seat-pin');
      if (!seatPin) return { error: 'no seat prompt to click' };
      let frames = 0, worst = 0, last = performance.now();
      let running = true;
      const tick = () => {
        const now = performance.now();
        worst = Math.max(worst, now - last);
        last = now;
        frames++;
        if (hog) { const end = performance.now() + hog; while (performance.now() < end); }
        if (running) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      const t0 = performance.now();
      seatPin.click();
      await new Promise((done) => {
        const poll = () => {
          if (api.selfCheck().phase === 'seated') return done();
          if (performance.now() - t0 > 30000) return done();
          setTimeout(poll, 16);
        };
        poll();
      });
      const ms = performance.now() - t0;
      running = false;
      return { ms, fps: frames / (ms / 1000), worst, phase: api.selfCheck().phase };
    })()`);

    if (run.error) { check(`intro ${trial.name}: can be started`, false, run.error); return; }
    const overshoot = run.ms - INTRO_NOMINAL_MS;
    const allowed = run.worst + INTRO_POLL_SLACK_MS;
    // What the same move would have taken driven by accumulated frame deltas
    // instead, given dt is capped at 0.05s. This is the number the measurement
    // has to be nowhere near.
    const ifFrameCounted = INTRO_NOMINAL_MS / Math.max(run.fps * 0.05, 1e-6);
    const detail = `${Math.round(run.ms)}ms vs ${INTRO_NOMINAL_MS}ms nominal`
      + ` at ${run.fps.toFixed(1)}fps, worst frame ${Math.round(run.worst)}ms`
      + ` — overshoot ${Math.round(overshoot)}ms, one frame allows ${Math.round(allowed)}ms,`
      + ` frame-counted would be ${Math.round(ifFrameCounted)}ms`;
    check(`intro ${trial.name}: completes`, run.phase === 'seated', `phase=${run.phase} ${detail}`);
    check(`intro ${trial.name}: overshoots by at most one frame`,
      overshoot <= allowed && overshoot >= -allowed, detail);
    if (trial.hogMs) {
      // Without this the previous check proves nothing: it has to be shown that
      // the frame rate really did collapse during the run being measured.
      check('intro starvation actually slowed the frames down', run.worst >= 60,
        `worst frame ${Math.round(run.worst)}ms at ${run.fps.toFixed(1)}fps`);
    }
  });
}

console.log('');
if (failures.length) {
  console.error(`${failures.length} check(s) failed:`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('all checks passed\n');
