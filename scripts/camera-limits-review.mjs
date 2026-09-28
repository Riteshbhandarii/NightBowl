/* Exercise the real orbit controls and capture both ends of the composed set. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { session, openScene, sleep } from './lib/chrome.mjs';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const url = arg('--url', 'http://localhost:4321');
const out = arg('--out', '/tmp/nightbowl-camera-limits-review');
mkdirSync(out, { recursive: true });

await session({ width: 1600, height: 1000 }, async (ctx) => {
  const { evaluate, send } = ctx;
  if (!await openScene(ctx, url)) throw new Error('Scene did not boot');
  const shot = async (name) => {
    const reply = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(out, `${name}.png`), Buffer.from(reply.result.data, 'base64'));
  };
  await sleep(700);
  await evaluate("document.querySelector('.seat-pin')?.click()");
  for (let i = 0; i < 40; i++) {
    if (await evaluate("window.__nightbowl.selfCheck().phase === 'seated'")) break;
    await sleep(250);
  }

  const drive = async (fromX, toX, wheelDelta) => evaluate(`(() => {
    const canvas = document.getElementById('scene');
    const event = (type, x) => canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: 72, pointerType: 'mouse', clientX: x, clientY: 500,
      bubbles: true, cancelable: true, isPrimary: true,
    }));
    event('pointerdown', ${fromX});
    event('pointermove', ${toX});
    event('pointerup', ${toX});
    canvas.dispatchEvent(new WheelEvent('wheel', {
      deltaY: ${wheelDelta}, bubbles: true, cancelable: true,
    }));
    return window.__nightbowl.selfCheck().camera;
  })()`);

  const right = await drive(800, -1200, 10000);
  await sleep(1200);
  await shot('01-right-orbit-limit');
  const left = await drive(800, 2800, 10000);
  await sleep(1200);
  await shot('02-left-orbit-limit');

  const epsilon = 0.0001;
  const atRight = Math.abs(right.azimuth - right.limits.azimuthMax) < epsilon;
  const atLeft = Math.abs(left.azimuth - left.limits.azimuthMin) < epsilon;
  const zoomHeld = Math.abs(right.radius - right.limits.radiusMax) < epsilon
    && Math.abs(left.radius - left.limits.radiusMax) < epsilon;
  if (!atRight || !atLeft || !zoomHeld) {
    throw new Error(`Camera clamp failed: ${JSON.stringify({ right, left })}`);
  }
  console.log(JSON.stringify({ right, left }, null, 2));
});

console.log(out);
