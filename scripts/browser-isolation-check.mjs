import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Every session gets the same random value: random-range allocation used to
// reuse a port across independent script processes. Private profile discovery
// and OS port allocation must be independent of randomness or suite ordering.
const driverIndex = process.argv.indexOf('--driver');
const driver = driverIndex < 0 ? new URL('./lib/chrome.mjs', import.meta.url).href : pathToFileURL(resolve(process.argv[driverIndex + 1])).href;
const execute = promisify(execFile);
const results = await Promise.allSettled(Array.from({ length: 6 }, (_, index) => execute(process.execPath, ['--input-type=module', '-e', `
  import assert from 'node:assert/strict';
  Math.random = () => 0;
  const { session, sleep } = await import(${JSON.stringify(driver)});
  await session({}, async ctx => {
    async function evaluate(expression) {
      let timer;
      try {
        return await Promise.race([ctx.evaluate(expression), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Lost owned browser channel')), 5000);
        })]);
      } finally { clearTimeout(timer); }
    }
    await evaluate('window.__auditOwner = ${index}');
    await sleep(750);
    assert.equal(await evaluate('window.__auditOwner'), ${index}, 'browser belongs to its process');
    assert.deepEqual(ctx.errors, []);
  });
`], { timeout: 60000 })));
assert.deepEqual(results.filter(result => result.status === 'rejected').map(result => result.reason.message), [], 'independent processes cannot share a Chrome target');
console.log('browser isolation: six concurrent private Chrome targets remain independent');
