/* Capture the complete leave-vacant-arrive-sit customer loop on localhost. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { session, openScene, sleep } from './lib/chrome.mjs';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const url = arg('--url', 'http://localhost:4321');
const out = arg('--out', '/tmp/nightbowl-turnover-review');
const dinerIndex = Number(arg('--index', '1'));
mkdirSync(out, { recursive: true });

await session({ width: 2048, height: 768 }, async (ctx) => {
  const { evaluate, send } = ctx;
  if (!await openScene(ctx, url)) throw new Error('Scene did not boot');
  await evaluate("document.querySelector('.seat-pin')?.click()");
  for (let i = 0; i < 40; i++) {
    if (await evaluate("window.__nightbowl.selfCheck().phase === 'seated'")) break;
    await sleep(250);
  }
  await evaluate(`(() => {
    const c = document.getElementById('scene');
    c.dispatchEvent(new WheelEvent('wheel', { deltaY: -1200, bubbles: true, cancelable: true }));
    c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 8, clientX: 1040, clientY: 420, bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointermove', { pointerId: 8, clientX: 1000, clientY: 450, bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointerup', { pointerId: 8, clientX: 1000, clientY: 450, bubbles: true }));
  })()`);
  await sleep(700);

  const shot = async (name) => {
    const reply = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(out, `${name}.png`), Buffer.from(reply.result.data, 'base64'));
  };

  await shot('00-before');
  if (!await evaluate(`window.__nightbowl.testTurnover(${dinerIndex})`)) throw new Error('Could not start turnover');
  const wanted = ['stand', 'stepOut', 'leave', 'vacant', 'arrive', 'stepIn', 'sit'];
  const seen = new Set();
  const started = Date.now();
  while (Date.now() - started < 24000 && seen.size < wanted.length) {
    const state = await evaluate('window.__nightbowl.selfCheck()');
    const phase = state?.turnover?.phase;
    if (phase && wanted.includes(phase) && !seen.has(phase)) {
      seen.add(phase);
      await sleep(450);
      await shot(`${String(seen.size).padStart(2, '0')}-${phase}`);
    }
    await sleep(120);
  }
  for (let i = 0; i < 40; i++) {
    const state = await evaluate('window.__nightbowl.selfCheck()');
    if (!state.turnover && state.customerGenerations[dinerIndex] > 0) break;
    await sleep(250);
  }
  await shot('08-new-customer-seated');
  if (seen.size !== wanted.length) throw new Error(`Missing turnover phases: ${wanted.filter((p) => !seen.has(p)).join(', ')}`);
});

console.log(out);
