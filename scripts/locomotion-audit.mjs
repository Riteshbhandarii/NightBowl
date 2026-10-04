/* Verify planted feet and distance-driven gait under live and sparse frames. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { session, openScene, sleep, softwareRenderer } from './lib/chrome.mjs';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const url = arg('--url', 'http://localhost:4321');
const out = arg('--out', '/tmp/nightbowl-locomotion-audit');
mkdirSync(out, { recursive: true });

const horizontal = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

function planted(samples, label) {
  const ratios = [];
  const stanceY = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    const foot = a.footL.y <= a.footR.y ? 'footL' : 'footR';
    if (foot !== (b.footL.y <= b.footR.y ? 'footL' : 'footR')) continue;
    const rootTravel = horizontal(a.root, b.root);
    if (rootTravel < 0.003) continue;
    ratios.push(horizontal(a[foot], b[foot]) / rootTravel);
    stanceY.push(Math.max(a[foot].y, b[foot].y));
  }
  assert.ok(ratios.length >= 5, `${label}: not enough live stance samples`);
  assert.ok(median(ratios) < 0.38, `${label}: stance foot drifts with root (${median(ratios)})`);
  assert.ok(median(stanceY) < 0.12, `${label}: stance foot is above floor (${median(stanceY)})`);
  return { samples: ratios.length, medianDriftRatio: median(ratios), medianStanceY: median(stanceY) };
}

async function waitFor(evaluate, expression, label, attempts = 180) {
  for (let i = 0; i < attempts; i++) {
    if (await evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function sample(evaluate, kind, index, count, delay = 70) {
  const frames = [];
  for (let i = 0; i < count; i++) {
    frames.push(await evaluate(`window.__nightbowl.auditLocomotion('${kind}', ${index})`));
    await sleep(delay);
  }
  return frames;
}

async function screenshot(send, name) {
  await send('Runtime.evaluate', { expression: 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))', awaitPromise: true });
  const reply = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(out, `${name}.png`), Buffer.from(reply.result.data, 'base64'));
}

const results = { walkers: {}, turnover: {}, cook: {}, sparseCook: {}, reduced: {} };

// Foot contact is a world-space assertion, not a frame-rate benchmark. Keep
// the no-GPU runner's raster small enough to sample the actual moving poses.
const viewport = softwareRenderer() ? { width: 640, height: 400 } : { width: 1400, height: 900 };
await session(viewport, async (ctx) => {
  const { evaluate, send } = ctx;
  for (const [label, busyMs] of [['60fps', 0], ['20fps', 34], ['10fps', 84], ['6fps', 150]]) {
    assert.ok(await openScene(ctx, url), `${label}: scene did not boot`);
    await evaluate('window.__nightbowl.auditStreetWalkers([-2, 2])');
    await sleep(150);
    const before = await evaluate(`({ pose: window.__nightbowl.auditLocomotion('walker', 0), at: performance.now() })`);
    if (busyMs) await evaluate(`(() => {
      window.__locomotionHog = true;
      const burn = () => {
        if (!window.__locomotionHog) return;
        const end = performance.now() + ${busyMs};
        while (performance.now() < end) {}
        requestAnimationFrame(burn);
      };
      requestAnimationFrame(burn);
    })()`);
    await sleep(2200);
    const after = await evaluate(`(() => {
      window.__locomotionHog = false;
      return { pose: window.__nightbowl.auditLocomotion('walker', 0), at: performance.now() };
    })()`);
    const rootTravel = horizontal(before.pose.root, after.pose.root);
    const gaitTravel = (after.pose.distance - before.pose.distance) * after.pose.scale;
    assert.ok(rootTravel > 0.2, `${label}: walker did not advance`);
    assert.ok(Math.abs(rootTravel - gaitTravel) < 0.045,
      `${label}: gait ${gaitTravel} disagrees with travel ${rootTravel}`);
    results.walkers[label] = { elapsedMs: after.at - before.at, rootTravel, gaitTravel };
  }

  assert.ok(await openScene(ctx, url), 'turnover scene did not boot');
  await evaluate("document.querySelector('.seat-pin')?.click()");
  await waitFor(evaluate, "window.__nightbowl.selfCheck().phase === 'seated'", 'seated scene');
  for (const index of [0, 2]) {
    assert.ok(await evaluate(`window.__nightbowl.testTurnover(${index})`), `turnover ${index} did not start`);
    await waitFor(evaluate,
      `window.__nightbowl.selfCheck().turnover?.phase === 'leave' && Math.abs(window.__nightbowl.selfCheck().turnover.x - window.__nightbowl.selfCheck().turnover.seatX) > 0.25`,
      `diner ${index} departure`);
    const leaving = await sample(evaluate, 'diner', index, 18);
    results.turnover[`diner${index}Leave`] = planted(leaving, `diner ${index} departure`);
    await evaluate(`(() => {
      const api = window.__nightbowl;
      const p = api.auditLocomotion('diner', ${index});
      api.auditBegin(); api.auditFocus('diner', ${index});
      api.auditFrame({ target: { x: p.root.x, y: 0.85, z: p.root.z }, azimuth: 0, elevation: 0.03, radius: 2.2 });
    })()`);
    await screenshot(send, `diner-${index}-departure-planted`);
    await evaluate('window.__nightbowl.auditEnd()');
    if (index === 0) {
      await waitFor(evaluate,
        "window.__nightbowl.selfCheck().turnover?.phase === 'arrive' && Math.abs(window.__nightbowl.selfCheck().turnover.x - window.__nightbowl.selfCheck().turnover.entryX) > 0.25",
        'diner 0 arrival', 260);
      const arriving = await sample(evaluate, 'diner', index, 18);
      results.turnover.diner0Arrive = planted(arriving, 'diner 0 arrival');
      await evaluate(`(() => {
        const api = window.__nightbowl;
        const p = api.auditLocomotion('diner', 0);
        api.auditBegin(); api.auditFocus('diner', 0);
        api.auditFrame({ target: { x: p.root.x, y: 0.85, z: p.root.z }, azimuth: 0, elevation: 0.03, radius: 2.2 });
      })()`);
      await screenshot(send, 'diner-0-arrival-planted');
      await evaluate('window.__nightbowl.auditEnd()');
    }
    await waitFor(evaluate, '!window.__nightbowl.selfCheck().turnover', `turnover ${index} completion`, 260);
  }

  assert.ok(await evaluate('window.__nightbowl.testEmptyBowl(0)'), 'cook service did not start');
  await waitFor(evaluate, 'window.__nightbowl.selfCheck().service?.active', 'cook service');
  await waitFor(evaluate, "window.__nightbowl.auditLocomotion('cook', 0)?.moving", 'cook walking');
  await evaluate(`(() => {
    const api = window.__nightbowl;
    const p = api.auditLocomotion('cook', 0);
    api.auditBegin(); api.auditFocus('cook', 0);
    api.auditFrame({ target: { x: p.root.x, y: 0.85, z: p.root.z }, azimuth: Math.PI, elevation: 0.06, radius: 2.25 });
  })()`);
  await screenshot(send, 'cook-service-rear-full-body');
  await evaluate('window.__nightbowl.auditEnd()');
  const cookFrames = await sample(evaluate, 'cook', 0, 88, 75);
  const movingCook = cookFrames.filter((frame) => frame.moving);
  assert.ok(movingCook.length >= 12, `cook only had ${movingCook.length} moving samples`);
  results.cook = planted(cookFrames, 'cook service');
  const service = await evaluate('window.__nightbowl.selfCheck().serviceAudit');
  assert.ok(service.lifted && service.filledCarry && service.completed, `service ordering regressed: ${JSON.stringify(service)}`);

  // A skipped render can advance the service root by more than half a metre.
  // Only an explicit street-loop wrap may reset gait tracking: a legitimate
  // sparse-frame displacement must still advance the cook's feet.
  // Start a fresh room: after two complete turnovers a natural second-meal
  // departure can legitimately take priority over a manually emptied bowl.
  assert.ok(await openScene(ctx, url), 'sparse cook scene did not boot');
  await evaluate("document.querySelector('.seat-pin')?.click()");
  await waitFor(evaluate, "window.__nightbowl.selfCheck().phase === 'seated'", 'sparse cook seating');
  assert.ok(await evaluate('window.__nightbowl.testEmptyBowl(2)'));
  await waitFor(evaluate, 'window.__nightbowl.selfCheck().service?.dinerX > 0', 'right-side cook service');
  const beforeSparse = await evaluate("(() => { window.__nightbowl.auditBegin(); return window.__nightbowl.auditLocomotion('cook'); })()");
  await sleep(700);
  await evaluate('window.__nightbowl.auditEnd(); new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const afterSparse = await evaluate("window.__nightbowl.auditLocomotion('cook')");
  const rootTravel = horizontal(beforeSparse.root, afterSparse.root);
  const gaitTravel = (afterSparse.distance - beforeSparse.distance) * afterSparse.scale;
  assert.ok(rootTravel > 0.5, `sparse cook displacement did not exercise the regression (${rootTravel})`);
  assert.ok(gaitTravel >= rootTravel - 0.045, `sparse cook gait ${gaitTravel} lost root travel ${rootTravel}`);
  results.sparseCook = { rootTravel, gaitTravel };
  assert.deepEqual(ctx.errors, []);
});

await session({ flags: ['--force-prefers-reduced-motion'], width: 1400, height: 900 }, async (ctx) => {
  const { evaluate, send } = ctx;
  assert.ok(await openScene(ctx, url), 'reduced-motion scene did not boot');
  await evaluate('window.__nightbowl.auditStreetWalkers([-2, 2])');
  const before = await evaluate("[window.__nightbowl.auditLocomotion('walker', 0), window.__nightbowl.auditLocomotion('walker', 1)]");
  await sleep(1200);
  const after = await evaluate("[window.__nightbowl.auditLocomotion('walker', 0), window.__nightbowl.auditLocomotion('walker', 1)]");
  results.reduced = before.map((pose, index) => horizontal(pose.root, after[index].root));
  assert.ok(results.reduced.every((distance) => distance < 0.001), `reduced walkers moved: ${results.reduced}`);
  await screenshot(send, 'reduced-both-walkers-static');
});

writeFileSync(join(out, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(`PASS locomotion audit\n${JSON.stringify(results, null, 2)}\n${out}`);
