import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv[2] || 'http://127.0.0.1:4328';
const out = process.argv[3] || '/tmp/nightbowl-visual-audit';
const chromePath = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(chromePath)) throw new Error('Chrome not found; set CHROME_PATH');
mkdirSync(out, { recursive: true });

const port = 9444;
const chrome = spawn(chromePath, [
  '--headless=new', `--remote-debugging-port=${port}`,
  '--user-data-dir=/tmp/nightbowl-visual-profile', '--no-first-run',
  '--window-size=2048,768', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let target;
for (let i = 0; i < 40 && !target; i++) {
  await sleep(250);
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = targets.find((item) => item.type === 'page');
  } catch { /* Chrome is still starting. */ }
}
if (!target) throw new Error('Chrome did not expose a page target');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});
let id = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
const send = (method, params = {}) => new Promise((resolve) => {
  const requestId = ++id;
  pending.set(requestId, resolve);
  ws.send(JSON.stringify({ id: requestId, method, params }));
});
const evaluate = async (expression) => {
  const reply = await send('Runtime.evaluate', { expression, returnByValue: true });
  return reply.result?.result?.value;
};
const shot = async (name) => {
  const reply = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(`${out}/${name}.png`, Buffer.from(reply.result.data, 'base64'));
};

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: `${base}/?nbtest=1` });
  for (let i = 0; i < 40 && !(await evaluate('!!window.__nightbowl')); i++) await sleep(250);
  await evaluate("document.querySelector('.seat-pin')?.click()");
  for (let i = 0; i < 40; i++) {
    if ((await evaluate('window.__nightbowl.selfCheck().phase')) === 'seated') break;
    await sleep(250);
  }
  await evaluate(`(() => {
    const c = document.getElementById('scene');
    c.dispatchEvent(new WheelEvent('wheel', { deltaY: -1200, bubbles: true, cancelable: true }));
    c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, clientX: 1040, clientY: 420, bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 1000, clientY: 450, bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, clientX: 1000, clientY: 450, bubbles: true }));
  })()`);
  await sleep(700);
  await shot('00-seated');
  for (let i = 1; i <= 5; i++) { await sleep(800); await shot(`0${i}-bite`); }

  await evaluate('window.__nightbowl.testEmptyBowl(0)');
  for (const [name, delay] of [['10-collect', 1400], ['11-carry-empty', 900], ['12-refill', 650], ['13-carry-full', 900], ['14-place', 950], ['15-resume', 1500]]) {
    await sleep(delay);
    await shot(name);
  }
  console.log(out);
} finally {
  ws.close();
  chrome.kill('SIGKILL');
}
