/* Capture deterministic close-ups of complete NPC motions for visual review. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { session, openScene } from './lib/chrome.mjs';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const url = arg('--url', 'http://localhost:4321');
const out = arg('--out', '/tmp/nightbowl-motion-review');
mkdirSync(out, { recursive: true });

const reviews = [
  { kind: 'diner', index: 2, act: 'eat', times: [0, 0.7, 1.35, 1.75, 2.4, 3.2, 3.8, 4.2] },
  { kind: 'cook', index: 0, act: 'stir', times: [0, 0.4, 0.8, 1.2, 1.6, 2, 2.4, 2.8] },
];

await session({ width: 1200, height: 900 }, async (ctx) => {
  const { evaluate, send } = ctx;
  if (!await openScene(ctx, url)) throw new Error('Scene did not boot');
  await evaluate('window.__nightbowl.auditBegin()');
  await evaluate(`(() => {
    const canvas = document.getElementById('scene');
    for (const el of document.querySelectorAll('body *')) {
      if (el !== canvas && !el.contains(canvas)) el.style.visibility = 'hidden';
    }
  })()`);

  const subjects = await evaluate('window.__nightbowl.auditSubjects()');
  for (const review of reviews) {
    const subject = subjects.find((item) => item.kind === review.kind && item.index === review.index);
    if (!subject) continue;
    const front = review.kind === 'cook' ? 0.2 : Math.PI + 0.2;
    for (const time of review.times) {
      await evaluate(`window.__nightbowl.auditPose(
        ${JSON.stringify(review.kind)}, ${review.index}, ${JSON.stringify(review.act)}, ${time})`);
      for (const [view, azimuth] of [['front', front], ['side', front + Math.PI / 2]]) {
        await evaluate(`window.__nightbowl.auditFrame(${JSON.stringify({
          target: { x: subject.x, y: 1.22, z: subject.z },
          azimuth,
          elevation: 0.04,
          radius: view === 'front' ? 1.25 : 1.05,
        })})`);
        const reply = await send('Page.captureScreenshot', { format: 'png' });
        const stamp = String(Math.round(time * 100)).padStart(3, '0');
        writeFileSync(join(out, `${review.kind}-${review.act}-${stamp}-${view}.png`),
          Buffer.from(reply.result.data, 'base64'));
      }
    }
  }
  await evaluate('window.__nightbowl.auditEnd()');
});

console.log(out);
