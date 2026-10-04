import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { expand } from 'brace-expansion';
import { parse, stringify, uneval } from 'devalue';
import uri from 'fast-uri';

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const minimums = {
  'brace-expansion': [5, 0, 12],
  devalue: [5, 9, 4],
  'fast-uri': [3, 1, 8],
  'http-cache-semantics': [4, 3, 0],
};

for (const [name, minimum] of Object.entries(minimums)) {
  test(`${name}: every locked copy retains the reviewed version floor`, () => {
    const copies = Object.entries(lock.packages).filter(([path]) => path.endsWith(`node_modules/${name}`));
    assert.ok(copies.length, `${name} is missing; review its replacement and security coverage`);
    for (const [path, entry] of copies) {
      assert.match(entry.version, /^\d+\.\d+\.\d+$/);
      const parts = entry.version.split('.').map(Number);
      const different = parts.findIndex((part, index) => part !== minimum[index]);
      assert.ok(different === -1 || parts[different] > minimum[different], `${path}: ${entry.version}`);
    }
  });
}

test('devalue: stringify and uneval serialize only the pooled Buffer view', () => {
  const bytes = Buffer.allocUnsafe(2);
  bytes.set([31, 41]);
  assert.ok(bytes.buffer.byteLength > bytes.byteLength, 'fixture must use a larger backing pool');
  const serialized = stringify(bytes);
  const expression = uneval(bytes);
  assert.ok(serialized.length < 160, 'stringify leaked the backing pool');
  assert.ok(expression.length < 160, 'uneval leaked the backing pool');
  assert.deepEqual([...parse(serialized)], [31, 41]);
  assert.deepEqual(Array.from(runInNewContext(expression, {}, { timeout: 1000 })), [31, 41]);
});

test('fast-uri: percent-encoded host case cannot bypass equality', () => {
  assert.equal(uri.parse('//%41.com').host, 'a.com');
  assert.equal(uri.equal('//%41.com', '//a.com'), true);
});

test('brace-expansion: deeply nested literal groups do not exhaust the stack', () => {
  const pattern = '{'.repeat(5000) + 'a,b' + '}'.repeat(5000);
  assert.deepEqual(expand(pattern), [pattern]);
  assert.deepEqual(expand('dish-{house,veggie}'), ['dish-house', 'dish-veggie']);
});
