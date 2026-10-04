import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { session, openScene, sleep } from './lib/chrome.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const url = arg('--url', 'http://127.0.0.1:4321');
const out = arg('--out', '/tmp/nightbowl-runtime-lifecycle');
mkdirSync(out, { recursive: true });
async function wait(ctx, expression, label) {
  for (let i = 0; i < 180; i++) {
    if (await ctx.evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error(`Timed out: ${label}`);
}
const check = ctx => ctx.evaluate('window.__nightbowl.selfCheck()');
const click = (ctx, selector) => ctx.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
async function shot(ctx, name) {
  const result = await ctx.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(out, `${name}.png`), Buffer.from(result.result.data, 'base64'));
}
async function seat(ctx) {
  await click(ctx, '#sceneMotionControl');
  await click(ctx, '.seat-pin');
  await click(ctx, '#sceneMotionControl');
  await wait(ctx, 'window.__nightbowl.selfCheck().cookHasWorkingProps', 'cook ready');
}
async function loss(ctx) {
  assert.ok(await ctx.evaluate(`(() => {
    window.__lostScene = window.__nightbowl;
    const extension = document.getElementById('scene').getContext('webgl2').getExtension('WEBGL_lose_context');
    if (!extension) return false;
    window.__lossExtension = extension;
    extension.loseContext();
    return true;
  })()`), 'real WebGL loss extension available');
  await sleep(500);
}
async function resourcesReleased(ctx) {
  const state = await ctx.evaluate('window.__lostScene.selfCheck()');
  assert.equal(state.geometries, 0, 'owned rendered geometry released');
  // Three r185 uploads its shared 16x16 half-float DFG LUT from
  // renderers/shaders/DFGLUTData.js. It is not an application-owned texture.
  // Tracing real createTexture/deleteTexture calls confirmed that only this
  // LUT (plus uncounted WebGL state defaults) survives renderer disposal.
  assert.equal(state.textures, 1, 'only the Three-owned DFG lookup texture remains');
}
const abandoned = ctx => ctx.evaluate(`({
  hidden: document.getElementById('scene').hidden,
  failed: document.getElementById('loading').classList.contains('failed'),
  gone: document.getElementById('loading').classList.contains('gone'),
  unavailable: document.getElementById('sceneMotionControl').dataset.state === 'unavailable',
  disabled: document.getElementById('sceneMotionControl').disabled,
  controls: document.querySelectorAll('.seat-pin,.you-pin,#pins .pin,.say').length,
  orderHidden: document.getElementById('visitorOrder').hidden,
  reopenHidden: document.getElementById('visitorOrderReopenPanel').hidden,
  handle: !!window.__nightbowl,
})`);
async function content(ctx, screenshot) {
  // Native keyboard activation proves the non-WebGL content still works.
  const toggle = await ctx.evaluate("innerWidth < 700 ? '.menu-toggle' : '.topbar [data-open=menu]'");
  await ctx.evaluate(`document.querySelector(${JSON.stringify(toggle)}).focus()`);
  await ctx.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await ctx.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await wait(ctx, "document.getElementById('book').classList.contains('open')", 'fallback Menu keyboard access');
  for (const key of ['guide', 'log', 'bill']) {
    await click(ctx, `#book [data-tab=${key}]`);
    await wait(ctx, `document.querySelector('#book [data-tab=${key}]').classList.contains('active')`, `fallback ${key} content`);
    assert.ok(await ctx.evaluate("document.getElementById('pageLeft').textContent.length + document.getElementById('pageRight').textContent.length > 100"), `${key} has readable content`);
  }
  await sleep(500);
  await shot(ctx, screenshot);
  await click(ctx, '#bookClose');
}
const failures = [];
async function scenario(name, options, run) {
  try {
    await session(options, async ctx => { await run(ctx); assert.deepEqual(ctx.errors, []); });
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

await scenario('context loss during arrival; delayed loader and timer stay dead', {}, async ctx => {
  let requestId;
  ctx.on('Fetch.requestPaused', event => { requestId = event.requestId; });
  await ctx.send('Fetch.enable', { patterns: [{ urlPattern: '*/models/chef.glb', requestStage: 'Request' }] });
  assert.ok(await openScene(ctx, url));
  for (let i = 0; i < 50 && !requestId; i++) await sleep(100);
  assert.ok(requestId, 'cook request really remains pending until context loss');
  await wait(ctx, 'window.__nightbowl.selfCheck().phase === "street"', 'arrival');
  await loss(ctx);
  const time = await ctx.evaluate('window.__lostScene.selfCheck().sceneTime');
  await ctx.send('Fetch.failRequest', { requestId, errorReason: 'Aborted' });
  await ctx.send('Fetch.disable');
  await sleep(3300);
  await shot(ctx, 'arrival-loss');
  assert.deepEqual(await abandoned(ctx), { hidden: true, failed: true, gone: false, unavailable: true, disabled: true, controls: 0, orderHidden: true, reopenHidden: true, handle: false });
  assert.equal(await ctx.evaluate('window.__lostScene.selfCheck().sceneTime'), time, 'abandoned clock freezes');
  await resourcesReleased(ctx);
  await content(ctx, 'arrival-fallback-content');
  // Restoring the old context cannot resurrect stale controls. Reload is recovery.
  await ctx.evaluate('window.__lossExtension.restoreContext()');
  await sleep(500);
  assert.equal((await abandoned(ctx)).handle, false);
  await ctx.send('Page.reload');
  await wait(ctx, '!!window.__nightbowl', 'reload recovers');
  assert.equal(await ctx.evaluate("document.getElementById('scene').hidden"), false);
});

await scenario('phone context loss during meal service', { width: 390, height: 844 }, async ctx => {
  await ctx.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  assert.ok(await openScene(ctx, url));
  await seat(ctx);
  await click(ctx, '[data-visitor-dish=house]');
  await wait(ctx, '!!window.__nightbowl.selfCheck().visitorOrder.carrying', 'visitor service carry');
  await shot(ctx, 'phone-service-before-loss');
  await loss(ctx);
  await shot(ctx, 'phone-service-loss');
  assert.equal((await abandoned(ctx)).controls, 0);
  assert.equal((await abandoned(ctx)).orderHidden, true);
  await resourcesReleased(ctx);
  const time = await ctx.evaluate('window.__lostScene.selfCheck().sceneTime');
  await ctx.evaluate("window.__lostScene.dispose(); window.__lostScene.dispose(); window.__lostScene.setBookOpen(false); window.__lostScene.setMotionPaused(false)");
  assert.equal(await ctx.evaluate("window.__lostScene.orderMeal('house')"), false, 'stale API cannot place another meal');
  await content(ctx, 'phone-fallback-content');
  await sleep(1000);
  assert.equal(await ctx.evaluate('window.__lostScene.selfCheck().sceneTime'), time);
});

await scenario('successful late model load cannot revive disposed pins', {}, async ctx => {
  let requestId;
  ctx.on('Fetch.requestPaused', event => { requestId = event.requestId; });
  await ctx.send('Fetch.enable', { patterns: [{ urlPattern: '*/models/chef.glb', requestStage: 'Request' }] });
  assert.ok(await openScene(ctx, url));
  for (let i = 0; i < 50 && !requestId; i++) await sleep(100);
  assert.ok(requestId, 'model response held');
  await loss(ctx);
  // Synthetic triangle is only a loader fixture, not a character asset.
  const bytes = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer).toString('base64');
  const fixture = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], buffers: [{ byteLength: 36, uri: `data:application/octet-stream;base64,${bytes}` }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }] };
  await ctx.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'model/gltf+json' }], body: Buffer.from(JSON.stringify(fixture)).toString('base64') });
  await ctx.send('Fetch.disable');
  await sleep(3300);
  assert.equal((await abandoned(ctx)).controls, 0);
  assert.equal((await abandoned(ctx)).handle, false);
  await resourcesReleased(ctx);
});

await scenario('explicit dispose removes controls, input and delayed UI', {}, async ctx => {
  assert.ok(await openScene(ctx, url));
  await seat(ctx);
  await ctx.evaluate("window.__lostScene=window.__nightbowl; window.__lostScene.dispose(); window.__lostScene.dispose()");
  await ctx.evaluate("document.getElementById('scene').dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,clientX:100,clientY:100})); window.dispatchEvent(new Event('resize'))");
  await sleep(3300);
  const state = await abandoned(ctx);
  assert.equal(state.controls, 0);
  assert.equal(state.orderHidden, true);
  await resourcesReleased(ctx);
  assert.equal(await ctx.evaluate("document.getElementById('scene').classList.contains('grabbing')"), false, 'pointer handler removed');
});

async function hideAndReturn(ctx, label) {
  const preference = await ctx.evaluate("localStorage.getItem('nightbowl:scene-motion')");
  const target = await ctx.send('Target.createTarget', { url: 'about:blank' });
  try {
    await ctx.send('Target.activateTarget', { targetId: target.result.targetId });
    await wait(ctx, 'document.hidden', 'actual hidden tab');
    const before = await check(ctx);
    await sleep(1600);
    assert.equal((await check(ctx)).sceneTime, before.sceneTime, `${label}: hidden clock frozen`);
    const returnedAt = Date.now();
    await ctx.send('Page.bringToFront');
    await wait(ctx, '!document.hidden', 'visible tab');
    await sleep(200);
    const after = await check(ctx);
    assert.ok(after.sceneTime - before.sceneTime <= (Date.now() - returnedAt) / 1000 + 0.2, `${label}: excludes hidden wall time`);
    assert.equal(await ctx.evaluate("localStorage.getItem('nightbowl:scene-motion')"), preference, 'visibility does not change manual preference');
    await shot(ctx, `visibility-${label}`);
    return { before, after };
  } finally {
    await ctx.send('Target.closeTarget', { targetId: target.result.targetId });
    await ctx.send('Page.bringToFront');
  }
}
await scenario('real tab switching preserves entrance, meal and turnover', {}, async ctx => {
  assert.ok(await openScene(ctx, url));
  await click(ctx, '.seat-pin');
  const entrance = await hideAndReturn(ctx, 'entrance');
  assert.equal(entrance.before.phase, 'sitting');
  assert.equal(entrance.after.phase, 'sitting', 'hidden time does not finish arrival');
  await wait(ctx, 'window.__nightbowl.selfCheck().phase === "seated"', 'arrival finishes visibly');
  await click(ctx, '[data-visitor-dish=house]');
  await wait(ctx, '!!window.__nightbowl.selfCheck().visitorOrder.carrying', 'service carry');
  await hideAndReturn(ctx, 'meal');
  await ctx.evaluate('window.__nightbowl.testTurnover(0)');
  await wait(ctx, 'window.__nightbowl.selfCheck().turnover?.phase === "leave"', 'departure');
  await hideAndReturn(ctx, 'departure');
  await click(ctx, '#sceneMotionControl');
  const paused = await hideAndReturn(ctx, 'manual-pause');
  assert.equal(paused.before.sceneTime, paused.after.sceneTime);
  await click(ctx, '.topbar [data-open=menu]');
  await click(ctx, '#sceneMotionControl');
  const reading = await hideAndReturn(ctx, 'reading');
  assert.equal(reading.before.sceneTime, reading.after.sceneTime);
  await click(ctx, '#bookClose');
  const time = (await check(ctx)).sceneTime;
  await wait(ctx, `window.__nightbowl.selfCheck().sceneTime > ${time}`, 'visible unpaused clock resumes');
});

// A real background target, not a mocked document.hidden property. Relay CDP
// messages because the shared driver is attached to the original page target.
await scenario('initially hidden tab does not auto-seat', {}, async ctx => {
  const target = await ctx.send('Target.createTarget', { url: 'about:blank', background: true });
  const targetId = target.result.targetId;
  const attached = await ctx.send('Target.attachToTarget', { targetId, flatten: false });
  const sessionId = attached.result.sessionId;
  let id = 0;
  const pending = new Map();
  const off = ctx.on('Target.receivedMessageFromTarget', event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    pending.get(message.id)?.(message);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const request = ++id;
    const timer = setTimeout(() => { pending.delete(request); reject(new Error(`Background CDP timeout: ${method}`)); }, 15000);
    pending.set(request, message => { clearTimeout(timer); pending.delete(request); resolve(message); });
    ctx.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: request, method, params }) });
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true });
    assert.ok(!result.result?.exceptionDetails, 'background evaluation succeeds');
    return result.result?.result?.value;
  };
  try {
    await send('Page.navigate', { url: `${url}/?nbtest=1` });
    await wait({ evaluate }, '!!window.__nightbowl', 'background scene boot');
    const state = await evaluate('({hidden:document.hidden,...window.__nightbowl.selfCheck()})');
    assert.equal(state.hidden, true);
    assert.equal(state.phase, 'street', 'background load must not imply seating');
    assert.equal(state.sceneTime, 0, 'background load starts frozen');
    await ctx.send('Target.activateTarget', { targetId });
    await wait({ evaluate }, '!document.hidden', 'activate initially hidden tab');
    await wait({ evaluate }, 'window.__nightbowl.selfCheck().sceneTime > 0', 'first visible interval starts clock');
    assert.equal(await evaluate('window.__nightbowl.selfCheck().phase'), 'street');
  } finally {
    off();
    await ctx.send('Target.detachFromTarget', { sessionId });
    await ctx.send('Target.closeTarget', { targetId });
  }
});
assert.deepEqual(failures, [], 'all lifecycle scenarios pass');
console.log(`runtime lifecycle: live context loss, teardown and real tab visibility passed; screenshots: ${out}`);
