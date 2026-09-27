/* Capture the cook collecting and returning a bowl on the real scene. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { session, openScene, sleep } from './lib/chrome.mjs';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const url = arg('--url', 'http://localhost:4321');
const out = arg('--out', '/tmp/nightbowl-service-review');
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
    c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, clientX: 1040, clientY: 420, bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9, clientX: 1000, clientY: 450, bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, clientX: 1000, clientY: 450, bubbles: true }));
  })()`);
  await sleep(700);
  const shot = async (name) => {
    const reply = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(out, `${name}.png`), Buffer.from(reply.result.data, 'base64'));
  };
  if (!await evaluate('window.__nightbowl.testEmptyBowl(0)')) throw new Error('Could not start service');
  for (let i = 0; i < 40; i++) {
    if ((await evaluate('window.__nightbowl.selfCheck()')).service?.active) break;
    await sleep(100);
  }
  let previous = 0;
  for (const [at, name] of [
    [0.7, '01-reach'], [1.35, '02-collect'], [2.15, '03-carry-empty'],
    [3.05, '04-refill'], [3.85, '05-carry-full'], [4.55, '06-deliver'],
  ]) {
    await sleep((at - previous) * 1000);
    await shot(name);
    previous = at;
  }
});

console.log(out);
