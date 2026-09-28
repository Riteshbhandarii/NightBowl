/* Close localhost evidence for stirring geometry and the attached backpack. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { session, openScene, sleep } from './lib/chrome.mjs';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const url = arg('--url', 'http://localhost:4321');
const out = arg('--out', '/tmp/nightbowl-human-motion-review');
mkdirSync(out, { recursive: true });

await session({ width: 1400, height: 900 }, async (ctx) => {
  const { evaluate, send } = ctx;
  if (!await openScene(ctx, url)) throw new Error('Scene did not boot');
  await sleep(900);
  const shot = async (name) => {
    const reply = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(out, `${name}.png`), Buffer.from(reply.result.data, 'base64'));
  };
  await evaluate(`(() => {
    const api = window.__nightbowl;
    api.auditBegin();
    api.auditFocus('cook', 0);
  })()`);
  for (const [index, time] of [0.2, 1.0, 1.8, 2.6].entries()) {
    await evaluate(`(() => {
      const api = window.__nightbowl;
      api.auditPose('cook', 0, 'stir', ${time});
      api.auditFrame({ target: { x: 0.18, y: 1.3, z: 0.18 }, azimuth: 0.08, elevation: 0.13, radius: 2.25 });
    })()`);
    await shot(`0${index + 1}-stir-${String(time).replace('.', '-')}`);
  }
  await evaluate(`(() => {
    const api = window.__nightbowl;
    api.auditFocus('walker', 1);
    api.auditStreetWalkers([-5.48, 0]);
    api.auditFrame({ target: { x: 0, y: 1.0, z: 2.68 }, azimuth: 1.57, elevation: 0.05, radius: 1.65 });
  })()`);
  await shot('05-backpack-contact');
  await evaluate(`window.__nightbowl.auditFrame({ target: { x: 0, y: 1.0, z: 2.68 }, azimuth: 0, elevation: 0.05, radius: 1.65 })`);
  await shot('06-backpack-side');
  await evaluate('window.__nightbowl.auditEnd()');
});

console.log(out);
