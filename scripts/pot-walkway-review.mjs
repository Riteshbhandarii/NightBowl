/* Capture the open pot contact and both obstacle-avoiding pedestrian lanes. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { session, openScene, sleep } from './lib/chrome.mjs';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const url = arg('--url', 'http://localhost:4321');
const out = arg('--out', '/tmp/nightbowl-pot-walkway-review');
mkdirSync(out, { recursive: true });

await session({ width: 1600, height: 1000 }, async (ctx) => {
  const { evaluate, send } = ctx;
  if (!await openScene(ctx, url)) throw new Error('Scene did not boot');
  const shot = async (name) => {
    const reply = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(out, `${name}.png`), Buffer.from(reply.result.data, 'base64'));
  };
  await sleep(800);
  await evaluate(`(() => {
    const api = window.__nightbowl;
    api.auditBegin();
    api.auditFocus('cook', 0);
    api.auditPose('cook', 0, 'stir', 1.2);
    api.auditFrame({ target: { x: 0.28, y: 1.28, z: 0.16 }, azimuth: 0.05, elevation: 0.16, radius: 2.45 });
  })()`);
  await shot('01-open-pot-front');
  await evaluate(`window.__nightbowl.auditFrame({ target: { x: 0.28, y: 1.28, z: 0.16 }, azimuth: 1.18, elevation: 0.18, radius: 2.3 })`);
  await shot('02-open-pot-side');
  await evaluate(`(() => {
    const api = window.__nightbowl;
    api.auditEnd();
    api.auditBegin();
    api.auditStreetWalkers([-5.48, 4.25]);
    api.auditFrame({ target: { x: 0, y: 1.3, z: 2.45 }, azimuth: 0.48, elevation: 0.12, radius: 8.1 });
  })()`);
  await shot('03-clear-walkway-routes');
  await evaluate(`window.__nightbowl.auditEnd()`);
});

console.log(out);
