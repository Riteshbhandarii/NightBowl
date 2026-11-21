// Checks the Kitchen Log email feature end to end against a fake Buttondown:
//  - the owner page lists subscribers and counts the ones who will receive email
//  - sending needs the confirmation box, a published post and a same-site request
//  - a send is one draft then one send, with the owner's key, and nothing else is called
//  - the sign-up popup opens centred after about 15 seconds on the page, traps focus, can be dismissed, then stays away
// It sets a Buttondown username in src/content/site/log.json for the run and restores it.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { session, sleep } from './lib/chrome.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const logPath = join(root, 'src/content/site/log.json');
const original = readFileSync(logPath, 'utf8');
const calls = [];
const KEY = 'test-key-123';
// SUBSCRIBERS_SHOTS=<folder> also saves screenshots of the popup and the owner page.
const shots = process.env.SUBSCRIBERS_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const snap = async (ctx, name) => { if (shots) writeFileSync(join(shots, name), await (async () => { const r = await ctx.send('Page.captureScreenshot', { format: 'png' }); return Buffer.from(r.data ?? r.result?.data ?? '', 'base64'); })()); };

const fake = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, version: req.headers['x-api-version'], body: body ? JSON.parse(body) : null });
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url.startsWith('/v1/subscribers')) {
      return res.end(JSON.stringify({ count: 3, next: null, results: [
        { email_address: 'ada@example.com', type: 'regular', creation_date: '2026-11-01T10:00:00Z' },
        { email_address: 'grace@example.com', type: 'regular', creation_date: '2026-11-02T10:00:00Z' },
        { email_address: 'pending@example.com', type: 'unactivated', creation_date: '2026-11-03T10:00:00Z' },
      ] }));
    }
    if (req.method === 'POST' && req.url === '/v1/emails') return res.end(JSON.stringify({ id: 'em_test_1' }));
    if (req.method === 'PATCH' && req.url === '/v1/emails/em_test_1') return res.end(JSON.stringify({ id: 'em_test_1', status: 'about_to_send' }));
    res.statusCode = 404;
    res.end('{}');
  });
});
await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
const fakePort = fake.address().port;

const port = 43000 + Math.floor(Math.random() * 5000);
const base = `http://127.0.0.1:${port}`;
let server;
try {
  const copy = JSON.parse(original);
  copy.newsletterButtondown = 'nightbowl-test';
  writeFileSync(logPath, `${JSON.stringify(copy, null, 2)}\n`);

  server = spawn('npx', ['astro', 'dev', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: root, stdio: 'ignore',
    env: { ...process.env, BUTTONDOWN_API_KEY: KEY, BUTTONDOWN_API_BASE: `http://127.0.0.1:${fakePort}/v1` },
  });
  let ready = false;
  for (let i = 0; i < 150 && !ready; i++) {
    try { ready = (await fetch(`${base}/admin/subscribers`)).ok; } catch { /* booting */ }
    if (!ready) await sleep(300);
  }
  assert.ok(ready, 'dev server starts');

  const page = await (await fetch(`${base}/admin/subscribers`)).text();
  assert.match(page, /ada@example\.com/);
  assert.match(page, /pending@example\.com/);
  assert.match(page, /<b[^>]*>2<\/b>will receive emails/, 'only confirmed subscribers are counted as recipients');
  assert.match(page, /noindex/);
  assert.equal(calls[0].auth, `Token ${KEY}`, 'owner key is sent as a Token');
  assert.ok(calls[0].version, 'API version header is sent');
  console.log('  ok   subscriber list and recipient count');

  const slug = page.match(/<option value="([^"]+)"/)[1];
  const post = (fields, headers = { Origin: base }) => fetch(`${base}/admin/subscribers`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields),
  }).then((r) => r.text());
  const writes = () => calls.filter((c) => c.method !== 'GET');

  assert.match(await post({ slug }), /Tick the confirmation box/);
  assert.match(await post({ slug: 'no-such-post', confirm: 'yes' }), /Pick a published post/);
  assert.match(await post({ slug, confirm: 'yes' }, { Origin: 'https://evil.example' }), /did not come from this page|Cross-site/i);
  assert.equal(writes().length, 0, 'nothing is sent unless every guard passes');
  console.log('  ok   sending is refused without confirmation, a real post and a same-site request');

  const sent = await post({ slug, confirm: 'yes' });
  assert.match(sent, /to 2 subscribers/);
  const [draft, send] = writes();
  assert.equal(writes().length, 2, 'one draft and one send');
  assert.equal(draft.url, '/v1/emails');
  assert.equal(draft.body.status, 'draft');
  assert.match(draft.body.subject, /^New in the Kitchen Log: /);
  assert.match(draft.body.body, new RegExp(`/log/${slug}/`));
  assert.equal(send.method, 'PATCH');
  assert.equal(send.body.status, 'about_to_send');
  assert.equal(send.auth, `Token ${KEY}`);
  console.log('  ok   a send is one draft then one send, with a link to the post');

  await session({ width: 1280, height: 800 }, async (ctx) => {
    const shown = () => ctx.evaluate(`(()=>{const c=document.getElementById('subPop');return !!c&&!c.hidden&&c.classList.contains('in')})()`);
    const ready = async () => { for (let i = 0; i < 100; i++) { if (await ctx.evaluate(`document.readyState==='complete'`)) break; await sleep(100); } await sleep(400); };
    await ctx.send('Page.navigate', { url: `${base}/privacy/` });
    await ready();
    await sleep(8000);
    assert.equal(await shown(), false, 'popup does not open in the first seconds, even with no one moving');
    await sleep(8500);
    assert.equal(await shown(), true, 'popup opens once the visitor has been on the page for about 15 seconds');
    const box = await ctx.evaluate(`(()=>{const r=document.querySelector('.sub-pop-card').getBoundingClientRect();return {cx:(r.left+r.right)/2,cy:(r.top+r.bottom)/2,w:innerWidth,h:innerHeight}})()`);
    assert.ok(Math.abs(box.cx - box.w / 2) < 4 && Math.abs(box.cy - box.h / 2) < 4, 'popup is centred on the screen');
    assert.equal(await ctx.evaluate(`document.activeElement && document.activeElement.id`), 'subPopEmail', 'focus moves into the dialog');
    await ctx.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await ctx.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    for (let i = 0; i < 6; i++) { await ctx.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await ctx.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); }
    assert.equal(await ctx.evaluate(`!!document.activeElement.closest('#subPop')`), true, 'Tab stays inside the dialog');
    await snap(ctx, 'popup.png');
    await ctx.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await ctx.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(600);
    assert.equal(await shown(), false, 'Escape closes it');
    assert.equal(await ctx.evaluate(`document.documentElement.style.overflow`), '', 'page scrolling is restored');
    await ctx.send('Page.reload');
    await ready();
    await sleep(16500);
    assert.equal(await shown(), false, 'a dismissed popup stays away');
    assert.deepEqual(ctx.errors, []);
    await ctx.send('Page.navigate', { url: `${base}/admin/subscribers` });
    await sleep(1500);
    await snap(ctx, 'owner-page.png');
  });
  console.log('  ok   popup: opens after about 15 seconds, centred, traps focus, Escape closes, stays away once dismissed');
} finally {
  writeFileSync(logPath, original);
  server?.kill('SIGTERM');
  // `npx` leaves astro running after its wrapper is killed; ask astro to stop its own server.
  try { execFileSync('npx', ['astro', 'dev', 'stop'], { cwd: root, stdio: 'ignore' }); } catch { /* already stopped */ }
  fake.close();
}
assert.equal(readFileSync(logPath, 'utf8'), original, 'log.json is restored');
console.log('subscribers: owner page, send guards, one-draft-one-send and the sign-up popup passed');
