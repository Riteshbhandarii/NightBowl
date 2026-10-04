/* Real book interactions and full-page content round trips must not reseat a visitor. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { session, openScene, sleep } from './lib/chrome.mjs';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const url = arg('--url', 'http://127.0.0.1:4321');
const out = arg('--out', '/tmp/nightbowl-visit-continuity');
mkdirSync(out, { recursive: true });

async function wait(ctx, expression, label) {
  for (let i = 0; i < 120; i++) {
    if (await ctx.evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error(`Timed out: ${label}`);
}

async function shot(ctx, name) {
  await wait(ctx, '!document.getElementById("loading") || getComputedStyle(document.getElementById("loading")).opacity === "0"', 'loading fade settles');
  await ctx.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const response = await ctx.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(out, `${name}.png`), Buffer.from(response.result.data, 'base64'));
}

async function assertSeated(ctx, label) {
  await wait(ctx, '!!window.__nightbowl && document.readyState === "complete"', label);
  assert.equal(await ctx.evaluate('window.__nightbowl.selfCheck().phase'), 'seated', `${label}: no repeated entrance`);
  assert.equal(await ctx.evaluate('!!document.querySelector(".seat-pin")'), false, `${label}: seat invitation is removed`);
  assert.equal(await ctx.evaluate('window.__nightbowl.selfCheck().nonFinite'), 0);
}

for (const width of [1400, 390]) {
  await session({ width, height: 900 }, async (ctx) => {
    const { evaluate, send } = ctx;
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    // Enable diagnostic measurements after real links navigate to /, without
    // changing their actual click or full-document navigation behavior.
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__visitAuditDocument = crypto.randomUUID();
      if (location.pathname === '/' && !location.search.includes('nbtest')) {
        const url = new URL(location.href); url.searchParams.set('nbtest', '1');
        history.replaceState(history.state, '', url);
      }` });
    assert.ok(await openScene(ctx, url));
    assert.equal(await evaluate('window.__nightbowl.selfCheck().phase'), 'street', 'fresh tab still offers entrance');
    await evaluate('document.querySelector(".seat-pin").click()');
    await wait(ctx, 'window.__nightbowl.selfCheck().phase === "seated"', 'first seating');
    await evaluate('document.querySelector("[data-visitor-dish=house]").click()');
    for (const section of ['menu', 'bill']) {
      await evaluate(`document.querySelector('.topbar [data-open=${section}]').click()`);
      const before = await evaluate('window.__nightbowl.selfCheck().visitorOrder');
      assert.equal(await evaluate('document.getElementById("book").classList.contains("open")'), true);
      await sleep(350);
      assert.deepEqual(await evaluate('window.__nightbowl.selfCheck().visitorOrder'), before, `${section}: reading preserves active meal`);
      await evaluate('document.getElementById("bookClose").click()');
      await assertSeated(ctx, `${section} book close`);
      await send('Page.getNavigationHistory').then(async (history) => {
        await send('Page.navigateToHistoryEntry', { entryId: history.result.entries[history.result.currentIndex - 1].id });
      });
      await wait(ctx, 'document.getElementById("book").classList.contains("open")', `${section} browser Back`);
      await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
      await assertSeated(ctx, `${section} Escape`);
    }
    await send('Page.navigate', { url: new URL('/menu/', url).href });
    await wait(ctx, 'document.querySelector(".reading-header nav a[aria-current=page]")?.getAttribute("href") === "/menu/"', 'native Menu');
    await evaluate('[...document.querySelectorAll(".reading-header nav a")].find(a => a.getAttribute("href") === "/bill/").click()');
    await wait(ctx, 'document.querySelector(".reading-header nav a[aria-current=page]")?.getAttribute("href") === "/bill/"', 'native Bill');
    await shot(ctx, `${width}-native-bill`);
    await evaluate('[...document.querySelectorAll(".reading-header a")].find(a => a.textContent === "Back to the stall").click()');
    await assertSeated(ctx, 'native Menu/Bill return');
    assert.equal(await evaluate('window.__nightbowl.selfCheck().visitorOrder.dish'), null, 'return never invents an order');
    await shot(ctx, `${width}-returned-seated`);
    const documentId = await evaluate('window.__visitAuditDocument');
    await send('Page.reload');
    await wait(ctx, `window.__visitAuditDocument !== ${JSON.stringify(documentId)} && !!window.__nightbowl`, 'new document after reload');
    await assertSeated(ctx, 'same-tab reload');
    assert.deepEqual(ctx.errors, []);
    console.log(`PASS ${width}px: fresh entrance, Menu/Bill book/history/meal continuity, native return, reload`);
  });
}

await session({ width: 1400, height: 900 }, async (ctx) => {
  await ctx.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });` });
  assert.ok(await openScene(ctx, url));
  await ctx.evaluate('document.querySelector(".seat-pin").click()');
  await wait(ctx, 'window.__nightbowl.selfCheck().phase === "seated"', 'blocked-storage seating');
  await ctx.evaluate('document.querySelector(".topbar [data-open=menu]").click()');
  await ctx.evaluate('document.getElementById("bookClose").click()');
  await assertSeated(ctx, 'blocked-storage book round trip');
  assert.deepEqual(ctx.errors, []);
  console.log('PASS blocked session storage: seating and book round trip stay usable');
});
