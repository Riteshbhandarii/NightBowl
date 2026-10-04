/* Real visitor flow, including repeated bites, a busy cook and reduced motion.
   --out captures the live serving/bite frames for visual review before merge. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { session, openScene, sleep } from './lib/chrome.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const url = arg('--url', 'http://localhost:4321');
const out = arg('--out', '');
if (out) mkdirSync(out, { recursive: true });
let maxCalls = 0, maxStreetCalls = 0, maxLandscapeTriangles = 0, maxAnimatedTriangles = 0;

async function waitFor(ctx, predicate, label, timeout = 40000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const state = await ctx.evaluate('({...window.__nightbowl.selfCheck(), reduced:matchMedia("(prefers-reduced-motion: reduce)").matches, viewport:{width:innerWidth,height:innerHeight}})');
    assert.equal(state.nonFinite, 0, 'finite visitor and NPC rigs');
    assert.equal(state.visitorAutonomous, false, 'visitor must not enter diner AI');
    if (state.visitorOrder.carryPose) {
      assert.ok(state.visitorOrder.carryPose.handGap <= 0.035, 'hands touch the visitor bowl rim');
      assert.ok(state.visitorOrder.carryPose.handSeparation >= 0.32, 'carry arms do not cross');
      assert.ok(state.visitorOrder.carryPose.faceClearance >= 0.05, 'bowl stays below cook face');
    }
    // Match smoke.mjs: 250 calls at street startup, 50k triangles at the
    // reduced-motion phone-landscape viewport. Animated cost is also recorded;
    // the existing animated scene already exceeds that static-view triangle cap.
    // The full seated street already draws more calls than the startup view.
    if (state.phase !== 'sitting') {
      maxCalls = Math.max(maxCalls, state.renderCalls);
      if (state.phase === 'street') {
        maxStreetCalls = Math.max(maxStreetCalls, state.renderCalls);
        assert.ok(state.renderCalls <= 250, `startup render calls ${state.renderCalls}/250`);
      }
      if (!state.reduced) maxAnimatedTriangles = Math.max(maxAnimatedTriangles, state.triangles);
      if (state.reduced && state.viewport.width === 844 && state.viewport.height === 390) {
        maxLandscapeTriangles = Math.max(maxLandscapeTriangles, state.triangles);
        assert.ok(state.triangles <= 50000, `phone landscape triangles ${state.triangles}/50000`);
      }
    }
    if (predicate(state)) return state;
    await sleep(200);
  }
  throw new Error(`Timed out: ${label}`);
}

async function shot(ctx, name) {
  if (!out) return;
  const r = await ctx.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(out, `${name}.png`), Buffer.from(r.result.data, 'base64'));
}

async function menuRoundTrip(ctx, restore = true) {
  await ctx.evaluate("document.querySelector('.menu-toggle').click()");
  assert.equal(await ctx.evaluate("document.getElementById('book').classList.contains('open')"), true, 'portfolio opens during order');
  assert.equal(await ctx.evaluate("document.getElementById('visitorOrder').hidden"), true, 'order panel hides behind book');
  await ctx.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))");
  assert.equal(await ctx.evaluate("document.getElementById('visitorOrder').hidden"), !restore, 'closing book restores correct order state');
}

await session({ width: 1440, height: 900 }, async (ctx) => {
  for (const dish of ['house', 'veggie']) {
    await ctx.send('Emulation.setDeviceMetricsOverride', { width: dish === 'house' ? 1440 : 844, height: dish === 'house' ? 900 : 390, deviceScaleFactor: 1, mobile: false });
    assert.ok(await openScene(ctx, url), 'scene boots');
    await waitFor(ctx, (s) => s.phase === 'street', 'street startup budget');
    assert.equal(await ctx.evaluate("window.__nightbowl.orderMeal('house')"), false, 'no ordering before sitting');
    assert.equal(await ctx.evaluate("document.getElementById('visitorOrder').hidden"), true);
    await ctx.evaluate("document.querySelector('.seat-pin').click()");
    await waitFor(ctx, (s) => s.phase === 'seated', 'visitor sits');
    await shot(ctx, `${dish}-01-choice`);
    await menuRoundTrip(ctx);
    assert.equal(await ctx.evaluate("window.__nightbowl.orderMeal('not-a-dish')"), false);
    if (dish === 'house') {
      assert.ok(await ctx.evaluate('window.__nightbowl.testEmptyBowl(0)'));
      await waitFor(ctx, (s) => !!s.service, 'existing diner service starts');
    }
    await ctx.evaluate(`document.querySelector('[data-visitor-dish="${dish}"]').click()`);
    assert.deepEqual(await ctx.evaluate("[window.__nightbowl.orderMeal('house'),window.__nightbowl.orderMeal('veggie')]"), [false, false], 'one meal despite duplicate choices');
    if (dish === 'house') {
      const queued = await ctx.evaluate('window.__nightbowl.selfCheck()');
      assert.equal(queued.visitorOrder.status, 'queued', 'busy cook finishes diner before visitor');
      assert.equal(queued.visitorOrder.bowlVisible, false);
      await menuRoundTrip(ctx);
    }
    await waitFor(ctx, (s) => s.visitorOrder.status === 'serving', 'cook starts visitor order');
    const captured = new Set();
    const firstBite = await waitFor(ctx, (s) => {
      assert.ok(!(s.visitorOrder.status === 'serving' && (s.service || s.turnover)), 'cook never overlaps services or turnover');
      return s.visitorOrder.firstBite;
    }, 'serve and first bite', 25000);
    assert.equal(firstBite.visitorOrder.status, 'eating', 'visitor continues after the first bite');
    assert.ok(Math.abs(firstBite.visitorOrder.fill - 0.82) < 0.001);
    assert.equal(firstBite.visitorOrder.heldChopsticks, true, 'keep chopsticks between bites');
    assert.equal(firstBite.visitorOrder.restingChopsticks, false);
    assert.equal(firstBite.visitorOrder.steam, true);
    assert.ok(firstBite.visitorOrder.toppings.includes(dish === 'house' ? 'chashu' : 'tofu'));
    assert.ok(!firstBite.visitorOrder.toppings.includes(dish === 'house' ? 'tofu' : 'chashu'));
    await menuRoundTrip(ctx);
    const secondBite = await waitFor(ctx, (s) => s.visitorOrder.fill < 0.7, 'visitor takes another bite');
    assert.equal(secondBite.visitorOrder.status, 'eating');
    const finished = await waitFor(ctx, (s) => s.visitorOrder.status === 'done', 'visitor finishes the bowl', 60000);
    // Screenshots need live intermediate frames, so the capture run below uses
    // a fresh visit; this assertion run never stops or forces the animation.
    assert.equal(finished.visitorOrder.dish, dish);
    assert.equal(finished.visitorOrder.firstBite, true);
    assert.equal(finished.visitorOrder.fill, 0);
    assert.equal(finished.visitorOrder.bowlVisible, true);
    assert.equal(finished.visitorOrder.steam, false);
    assert.equal(finished.visitorOrder.heldChopsticks, false);
    assert.equal(finished.visitorOrder.restingChopsticks, true);
    assert.deepEqual(finished.visitorOrder.position, [0.1, 1.09, 1]);
    await menuRoundTrip(ctx);
    await ctx.evaluate("document.getElementById('visitorOrderSkip').click()");
    await menuRoundTrip(ctx, false);
    assert.equal(await ctx.evaluate("window.__nightbowl.orderMeal('house')"), false, 'completed meal cannot reorder');
    await shot(ctx, `${dish}-05-served`);
    console.log(`PASS ${dish}: selected bowl, serialized delivery, repeated bites until empty, portfolio navigation`);

    if (out) {
      assert.ok(await openScene(ctx, url));
      await ctx.evaluate("document.querySelector('.seat-pin').click()");
      await waitFor(ctx, (s) => s.phase === 'seated', 'screenshot seating');
      await ctx.evaluate(`document.querySelector('[data-visitor-dish="${dish}"]').click()`);
      await waitFor(ctx, (s) => s.visitorOrder.status === 'serving', 'screenshot serving');
      const start = Date.now();
      while (Date.now() - start < 18000) {
        const s = await ctx.evaluate('window.__nightbowl.selfCheck()');
        const t = await ctx.evaluate('performance.now()/1000');
        let name = '';
        if (s.visitorOrder.status === 'serving' && t - s.visitorOrder.startedAt >= 1.7 && !captured.has('carry')) name = 'carry';
        if (s.visitorOrder.status === 'serving' && t - s.visitorOrder.startedAt >= 3.7 && !captured.has('place')) name = 'place';
        if (s.visitorOrder.status === 'eating' && t - s.visitorOrder.biteAt >= 1.7 && !captured.has('bite')) name = 'bite';
        if (name) { captured.add(name); await shot(ctx, `${dish}-${name}`); }
        if (s.visitorOrder.status === 'done') break;
        await sleep(100);
      }
      assert.ok(captured.has('carry') && captured.has('place') && captured.has('bite'), 'live motion frames captured');
      await ctx.evaluate(`window.__nightbowl.auditBegin(); window.__nightbowl.auditFocus('visitor',0);
        document.getElementById('visitorOrder').hidden = true; document.getElementById('pins').style.display = 'none';`);
      for (const [time, name] of [[0, 'reach'], [1.9, 'mouth']]) {
        await ctx.evaluate(`window.__nightbowl.auditPose('visitor',0,'eat',${time});
          window.__nightbowl.auditFrame({target:{x:0.1,y:1.26,z:1.2},azimuth:2.65,elevation:0.3,radius:1.5});`);
        await shot(ctx, `${dish}-close-${name}`);
      }
    }
  }
  assert.ok(await openScene(ctx, url));
  await ctx.evaluate("document.querySelector('.seat-pin').click()");
  await waitFor(ctx, (s) => s.phase === 'seated', 'turnover test seating');
  assert.ok(await ctx.evaluate('window.__nightbowl.testTurnover(0)'));
  await waitFor(ctx, (s) => !!s.turnover, 'existing turnover starts');
  assert.ok(await ctx.evaluate("window.__nightbowl.orderMeal('house')"));
  assert.equal(await ctx.evaluate("window.__nightbowl.selfCheck().visitorOrder.status"), 'queued');
  await waitFor(ctx, (s) => {
    assert.ok(!(s.visitorOrder.status === 'serving' && (s.service || s.turnover)));
    return s.visitorOrder.status === 'done';
  }, 'visitor order waits for replacement customer and finishes eating', 90000);
  assert.ok(await ctx.evaluate('window.__nightbowl.testTurnover(1)'));
  await waitFor(ctx, (s) => !!s.turnover && s.visitorOrder.status === 'done' && s.visitorOrder.fill === 0, 'room resumes without refilling or removing visitor');
  console.log('PASS busy turnover queues delivery; room resumes while visitor keeps their meal');
  assert.deepEqual(ctx.errors, []);
});

await session({ width: 390, height: 844 }, async (ctx) => {
  await ctx.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  for (const [width, height] of [[280, 640], [390, 844], [844, 390], [1366, 768], [1920, 1080]]) {
    await ctx.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    assert.ok(await openScene(ctx, url));
    const layout = await ctx.evaluate(`(() => {
      const p = document.getElementById('visitorOrder'), r = p.getBoundingClientRect();
      return {shown: !p.hidden, left:r.left, right:r.right, top:r.top, bottom:r.bottom,
        targets:[...p.querySelectorAll('button')].map(b => b.getBoundingClientRect().height),
        overflow:document.documentElement.scrollWidth > innerWidth};
    })()`);
    assert.ok(layout.shown && layout.left >= 0 && layout.right <= width && layout.top >= 0 && layout.bottom <= height);
    assert.ok(layout.targets.every((h) => h >= 44), '44px touch targets');
    assert.equal(layout.overflow, false);
    await menuRoundTrip(ctx);
    // Real key events activate the native button, not a test-only order call.
    await ctx.evaluate("document.querySelector('[data-visitor-dish=veggie]').focus()");
    await ctx.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
    await ctx.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await ctx.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const s = await waitFor(ctx, (s) => s.visitorOrder.status === 'done', 'immediate reduced-motion meal', 3000);
    assert.equal(s.visitorOrder.dish, 'veggie');
    assert.equal(s.visitorOrder.fill, 1);
    assert.equal(s.visitorOrder.firstBite, false, 'reduced motion skips bite animation');
    assert.equal(s.visitorOrder.bowlVisible, true);
    await shot(ctx, `reduced-${width}x${height}`);
  }
  assert.ok(await openScene(ctx, url));
  await ctx.evaluate("document.getElementById('visitorOrderSkip').click()");
  assert.equal(await ctx.evaluate("window.__nightbowl.orderMeal('house')"), false, 'dismissed choice stays dismissed');
  await menuRoundTrip(ctx, false);
  assert.deepEqual(ctx.errors, []);
  console.log('PASS reduced motion, keyboard, dismissal and five viewport layouts');
});
console.log(`PASS budgets: startup ${maxStreetCalls}/250 calls, reduced phone landscape ${maxLandscapeTriangles}/50000 triangles`);
console.log(`Animated cost (informational): peak ${maxCalls} calls / ${maxAnimatedTriangles} triangles`);
if (out) console.log(`Live review evidence: ${out}`);
