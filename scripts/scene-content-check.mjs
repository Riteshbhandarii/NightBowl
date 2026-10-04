import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { session, sleep } from './lib/chrome.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const copyPath = join(root, 'src/content/site.json');
const original = readFileSync(copyPath, 'utf8');
const copy = JSON.parse(original);
const text = 'Literal </ScRiPt><script>window.__nightbowlInjected=true</script> < & " नेपाली';
const build = () => execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
const port = 42000 + Math.floor(Math.random() * 10000);
let server;

try {
  copy.site.name = text;
  copy.scene.mainSignLine = text;
  copy.chatter.cook[0] = text;
  writeFileSync(copyPath, `${JSON.stringify(copy, null, 2)}\n`);
  build();
  server = spawn(process.execPath, ['scripts/serve.mjs'], {
    cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) }, stdio: 'ignore',
  });
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    try { ready = (await fetch(`http://127.0.0.1:${port}/`)).ok; } catch { /* booting */ }
    if (!ready) await sleep(100);
  }
  assert.ok(ready, 'fixture server starts');
  await session({}, async ctx => {
    await ctx.send('Page.navigate', { url: `http://127.0.0.1:${port}/?nbtest=1` });
    for (let i = 0; i < 100; i++) {
      if (await ctx.evaluate("document.readyState==='complete' && !!window.__nightbowl")) break;
      await sleep(100);
    }
    const result = await ctx.evaluate(`({injected:!!window.__nightbowlInjected, json:document.getElementById('nbSceneContent').textContent, ready:!!window.__nightbowl})`);
    console.log(`Scene content fixture: injected=${result.injected}, ready=${result.ready}`);
    assert.equal(result.injected, false, 'CMS text cannot terminate the data script and execute');
    const data = JSON.parse(result.json);
    assert.equal(data.labels.siteName, text);
    assert.equal(data.labels.mainSignLine, text);
    assert.equal(data.chatter.cook[0], text);
    assert.ok(result.ready, 'scene boots with literal script-like text');
    assert.deepEqual(ctx.errors, []);
  });
} finally {
  server?.kill('SIGTERM');
  writeFileSync(copyPath, original);
  build();
}
assert.equal(readFileSync(copyPath, 'utf8'), original, 'owner copy is restored');
console.log('scene content: script boundaries stay safe and literal Unicode/HTML-like text round trips');
