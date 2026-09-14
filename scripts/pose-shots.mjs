/* ============================================================
   nightbowl pose shots

   `npm run audit:npc` reports pose defects as numbers: which limb, how many
   millimetres into which piece of furniture. That is enough to gate CI and not
   enough to fix anything. This photographs them.

   It re-runs the audit to find the worst sample of each defect, freezes the
   scene at exactly that pose, points the camera at the character and captures
   a frame. One picture per issue by default, or every distinct defect with
   --all. The pictures and an index naming them are written to a directory.

   Usage:  node scripts/pose-shots.mjs [--url http://localhost:4321]
                                       [--out docs/pose-shots] [--all]
   Env:    CHROME_PATH   explicit browser binary
   ============================================================ */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { session, openScene, sleep } from './lib/chrome.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const URL_ = arg('--url', 'http://localhost:4321');
const OUT = arg('--out', join(here, '..', 'docs', 'pose-shots'));
const ALL = process.argv.includes('--all');

const accepted = JSON.parse(readFileSync(join(here, 'npc-audit-accepted.json'), 'utf8'));

// The audit already knows how to find and rank defects. Rather than grow a
// second copy of that logic which could disagree with the one CI runs, shell
// out to it and read its JSON.
const findingsPath = join(process.env.TMPDIR || '/tmp', `nightbowl-findings-${process.pid}.json`);
const { spawnSync } = await import('node:child_process');
const audit = spawnSync(process.execPath,
  [join(here, 'npc-audit.mjs'), '--url', URL_, '--json', findingsPath],
  { encoding: 'utf8' });
// Exit code 1 just means there are defects not on the accepted list, which is
// exactly what this tool is for. Only a missing report is fatal.
let report;
try {
  report = JSON.parse(readFileSync(findingsPath, 'utf8'));
} catch {
  console.error('\nFAILED: the audit produced no findings file, so there is nothing to photograph.');
  console.error(audit.stdout || '');
  console.error(audit.stderr || '');
  process.exit(1);
}
rmSync(findingsPath, { force: true });

// Pick what to photograph: the worst sample of every defect, or with one shot
// per owning issue, the worst defect that issue owns.
const owner = new Map(accepted.accepted.map((a) => [a.id, a.issue]));
let shots;
if (ALL) {
  shots = report.findings;
} else {
  const best = new Map();
  for (const f of report.findings) {
    const key = owner.get(f.id) || 'unfiled';
    const cur = best.get(key);
    if (!cur || f.score > cur.score) best.set(key, f);
  }
  shots = [...best.values()];
}
shots.sort((a, b) => b.score - a.score);

if (!shots.length) {
  console.log('\nno pose defects to photograph\n');
  process.exit(0);
}

// The audit does not carry the limb name as its own field, but its ids are
// built from it: clip:<subject>:<act>:<part>:<furniture>. Contact misses name
// the prop instead, and a joint-limit finding has no box of its own, so those
// fall back to the whole body.
const CONTACT_PART = {
  'chopsticks-mouth': 'heldChopsticks',
  'cloth-counter': 'cloth',
  'ladle-pot': 'ladle',
};
function partOf(id) {
  const bits = id.split(':');
  if (bits[0] === 'clip' && bits.length >= 5) return bits[3];
  if (bits[0] === 'contact') return CONTACT_PART[bits[3]] || 'body';
  return 'body';
}

mkdirSync(OUT, { recursive: true });
const written = [];

await session({ width: 1200, height: 900 }, async (ctx) => {
  const { evaluate, send } = ctx;
  if (!await openScene(ctx, URL_)) {
    console.error('\nFAILED: the scene did not boot, so no pose could be captured.');
    console.error('What to do: run `npm run preview` and open the URL by hand to see the error.\n');
    process.exit(1);
  }
  await sleep(400);
  await evaluate('window.__nightbowl.auditBegin()');

  // Hide the DOM shell. The topbar, the seat prompt and the footer are all
  // fixed overlays that would otherwise sit across the pose being documented.
  // visibility rather than display, so nothing reflows and resizes the canvas.
  await evaluate(`(() => {
    const canvas = document.getElementById('scene');
    for (const el of document.querySelectorAll('body *')) {
      if (el !== canvas && !el.contains(canvas)) el.style.visibility = 'hidden';
    }
  })()`);

  const subjects = await evaluate('window.__nightbowl.auditSubjects()');

  for (const f of shots) {
    const m = /^(diner|cook)(\d+)$/.exec(f.subject);
    if (!m) continue;
    const kind = m[1], index = Number(m[2]);
    const subject = subjects.find((s) => s.kind === kind && s.index === index);
    if (!subject) continue;

    // Put the character in the exact pose the audit measured.
    const sample = await evaluate(
      `window.__nightbowl.auditPose(${JSON.stringify(kind)}, ${index}, ${JSON.stringify(f.act)}, ${f.tl})`);
    if (!sample) continue;

    // Frame on the limb that is actually at fault, which the audit encodes in
    // the finding id (clip:<subject>:<act>:<part>:<furniture>). A shot of the
    // whole stall would not show a 40mm interpenetration.
    const box = sample.boxes?.[partOf(f.id)] || sample.boxes?.body;
    const target = box
      ? { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2, z: (box.min.z + box.max.z) / 2 }
      : { x: subject.x, y: 1.3, z: subject.z };

    // Shoot from the side of the counter the character faces, or their body
    // blocks the very limb being documented. Diners sit on the customer side
    // facing -z, the cook stands behind it facing +z.
    const front = kind === 'cook' ? 0.35 : Math.PI + 0.35;
    // Two angles: three-quarter and near-side-on, because a limb inside the
    // counter top reads as nothing at all from one and as a clear overlap from
    // the other.
    for (const [suffix, azimuth, radius] of [['', front, 1.15], ['-side', front + 1.1, 1.15]]) {
      await evaluate(`window.__nightbowl.auditFrame(${JSON.stringify({
        target, azimuth, elevation: 0.10, radius,
      })})`);
      const name = `${f.id.replace(/[^a-z0-9]+/gi, '-')}${suffix}.png`;
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      if (!shot.result?.data) continue;
      writeFileSync(join(OUT, name), Buffer.from(shot.result.data, 'base64'));
      if (!suffix) written.push({ ...f, name, issue: owner.get(f.id) || null });
      else written[written.length - 1].side = name;
    }
  }
  await evaluate('window.__nightbowl.auditEnd()');
});

const lines = [
  '# Pose defects, photographed',
  '',
  'Generated by `npm run audit:visual`. Each entry is the worst sample of one',
  'defect that `npm run audit:npc` reports, with the scene frozen at that exact',
  'moment of that exact action. Two angles per defect: a three-quarter view and',
  'a side view, because a limb inside the counter is invisible from the front.',
  '',
  'Regenerate after changing a pose. The measurements come from the audit, so',
  'they are the same numbers CI asserts on.',
  '',
  'One shot per owning issue is committed here. `npm run audit:visual -- --all`',
  'photographs every distinct defect instead, which is the one to use when',
  'working through a single issue.',
  '',
];
for (const w of written) {
  lines.push(`## ${w.check}${w.issue ? ` — ${w.issue}` : ''}`, '');
  lines.push(`**${w.detail}**`, '');
  lines.push(`${w.subject} performing \`${w.act}\` at t=${w.tl}s · id \`${w.id}\``, '');
  lines.push(`![${w.id}](${w.name})`);
  if (w.side) lines.push('', `![${w.id} from the side](${w.side})`);
  lines.push('');
}
writeFileSync(join(OUT, 'README.md'), lines.join('\n'));

console.log(`\nwrote ${written.length} pose shot(s) to ${OUT}`);
for (const w of written) console.log(`  ${w.issue || 'unfiled'}  ${w.id}  →  ${w.name}`);
console.log('');
