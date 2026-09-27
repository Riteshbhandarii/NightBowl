/* Capture the quiet night street from the real localhost scene. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { session, openScene, sleep } from './lib/chrome.mjs';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const url = arg('--url', 'http://localhost:4321');
const out = arg('--out', '/tmp/nightbowl-environment-review');
mkdirSync(out, { recursive: true });

await session({ width: 2048, height: 1100 }, async (ctx) => {
  const { evaluate, send } = ctx;
  if (!await openScene(ctx, url)) throw new Error('Scene did not boot');
  const shot = async (name) => {
    const reply = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(out, `${name}.png`), Buffer.from(reply.result.data, 'base64'));
  };
  await sleep(1800);
  await shot('01-street-arrival');
  await evaluate("document.querySelector('.seat-pin')?.click()");
  for (let i = 0; i < 40; i++) {
    if (await evaluate("window.__nightbowl.selfCheck().phase === 'seated'")) break;
    await sleep(250);
  }
  await evaluate(`(() => {
    const api = window.__nightbowl;
    api.auditBegin();
    api.auditFrame({ target: { x: 0, y: 1.45, z: 2.25 }, azimuth: 0.5, elevation: 0.13, radius: 8.2 });
  })()`);
  await shot('02-wide-night-street');
  await evaluate(`window.__nightbowl.auditEnd()`);
  await sleep(3200);
  await evaluate(`(() => {
    const api = window.__nightbowl;
    api.auditBegin();
    api.auditFrame({ target: { x: 0, y: 1.45, z: 2.25 }, azimuth: 0.5, elevation: 0.13, radius: 8.2 });
  })()`);
  await shot('03-living-night-street');
  await evaluate(`window.__nightbowl.auditEnd()`);
});

console.log(out);
