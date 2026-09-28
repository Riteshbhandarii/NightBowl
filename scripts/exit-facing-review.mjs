/* Capture both departure directions after the body has turned into travel. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { session, openScene, sleep } from './lib/chrome.mjs';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const url = arg('--url', 'http://localhost:4321');
const out = arg('--out', '/tmp/nightbowl-exit-facing-review');
mkdirSync(out, { recursive: true });

await session({ width: 1400, height: 900 }, async (ctx) => {
  const { evaluate, send } = ctx;
  if (!await openScene(ctx, url)) throw new Error('Scene did not boot');
  await evaluate("document.querySelector('.seat-pin')?.click()");
  for (let i = 0; i < 40; i++) {
    if (await evaluate("window.__nightbowl.selfCheck().phase === 'seated'")) break;
    await sleep(250);
  }
  const shot = async (name) => {
    const reply = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(out, `${name}.png`), Buffer.from(reply.result.data, 'base64'));
  };
  const waitFor = async (phase, delay) => {
    for (let i = 0; i < 100; i++) {
      if ((await evaluate('window.__nightbowl.selfCheck().turnover?.phase')) === phase) {
        await sleep(delay);
        return;
      }
      await sleep(100);
    }
    throw new Error(`Turnover never reached ${phase}`);
  };
  for (const dinerIndex of [0, 2]) {
    let started = false;
    for (let i = 0; i < 120 && !started; i++) {
      started = await evaluate(`window.__nightbowl.testTurnover(${dinerIndex})`);
      if (!started) await sleep(100);
    }
    if (!started) {
      throw new Error(`Could not start turnover for diner ${dinerIndex}`);
    }
    await waitFor('stepOut', 850);
    let state = await evaluate('window.__nightbowl.selfCheck().turnover');
    if (state.facingZ < 0.8 || state.z <= state.stageZ + 0.02) {
      throw new Error(`Diner ${dinerIndex} is not walking forward from the counter: ${JSON.stringify(state)}`);
    }
    await evaluate(`(() => {
      const api = window.__nightbowl;
      const t = api.selfCheck().turnover;
      api.auditBegin();
      api.auditFocus('diner', ${dinerIndex});
      api.auditFrame({ target: { x: t.x, y: 0.95, z: t.z }, azimuth: 0, elevation: 0.04, radius: 2.15 });
    })()`);
    await shot(`diner-${dinerIndex}-step-out-forward`);
    await evaluate('window.__nightbowl.auditEnd()');

    await waitFor('leave', 850);
    state = await evaluate('window.__nightbowl.selfCheck().turnover');
    const direction = Math.sign(state.entryX - state.seatX);
    if (state.facingX * direction < 0.8 || Math.abs(state.x - state.seatX) <= 0.05) {
      throw new Error(`Diner ${dinerIndex} is not facing the exit: ${JSON.stringify(state)}`);
    }
    await evaluate(`(() => {
      const api = window.__nightbowl;
      const t = api.selfCheck().turnover;
      api.auditBegin();
      api.auditFocus('diner', ${dinerIndex});
      api.auditFrame({ target: { x: t.x, y: 0.95, z: t.z }, azimuth: 0, elevation: 0.04, radius: 2.15 });
    })()`);
    await shot(`diner-${dinerIndex}-exit-forward`);
    await evaluate('window.__nightbowl.auditEnd()');

    for (let i = 0; i < 160; i++) {
      if (!await evaluate('window.__nightbowl.selfCheck().turnover')) break;
      await sleep(100);
    }
  }
});

console.log(out);
