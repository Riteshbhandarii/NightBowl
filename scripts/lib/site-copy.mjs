// The owner's site copy lives in one JSON file per admin section, under src/content/site/.
// These helpers read, write and restore that set as one object, the shape the site reads.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Top-level key of the site copy -> file that holds it.
const FILES = {
  site: 'identity',
  home: 'home',
  navigation: 'navigation',
  menu: 'menu',
  guide: 'guide',
  specials: 'specials',
  bill: 'bill',
  log: 'log',
  scene: null, // split between sceneSigns and visitorOrder
  chatter: 'chatter',
};
const isVisitor = (key) => /^order|^newsletter/.test(key) || key === 'youLabel';
const pathOf = (root, name) => join(root, 'src/content/site', `${name}.json`);

export function snapshotSiteCopy(root) {
  const names = [...new Set(Object.values(FILES).filter(Boolean)), 'sceneSigns', 'visitorOrder'];
  return Object.fromEntries(names.map(name => [pathOf(root, name), readFileSync(pathOf(root, name), 'utf8')]));
}

export function restoreSiteCopy(snapshot) {
  for (const [path, text] of Object.entries(snapshot)) writeFileSync(path, text);
}

export function readSiteCopy(root) {
  const read = name => JSON.parse(readFileSync(pathOf(root, name), 'utf8'));
  const copy = {};
  for (const [key, name] of Object.entries(FILES)) if (name) copy[key] = read(name);
  copy.scene = { ...read('sceneSigns'), ...read('visitorOrder') };
  return copy;
}

export function writeSiteCopy(root, copy) {
  const write = (name, value) => writeFileSync(pathOf(root, name), `${JSON.stringify(value, null, 2)}\n`);
  for (const [key, name] of Object.entries(FILES)) if (name) write(name, copy[key]);
  write('sceneSigns', Object.fromEntries(Object.entries(copy.scene).filter(([k]) => !isVisitor(k))));
  write('visitorOrder', Object.fromEntries(Object.entries(copy.scene).filter(([k]) => isVisitor(k))));
}
