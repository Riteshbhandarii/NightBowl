/* ============================================================
   nightbowl NPC realism audit

   Steps the scene deterministically, forces every action in SEATED_ACTS and
   COOK_ACTS across its timeline for every character, and checks where the
   joints and props actually ended up against the furniture that is in the
   scene. Catches the failures that render as "something looks wrong" and throw
   nothing at all:

     - a hand or forearm inside the counter, the pot or a stool
     - two characters occupying the same space
     - a reach that never arrives: chopsticks short of the mouth, a cloth
       hovering above the counter it is supposedly wiping, a ladle outside
       the pot
     - a joint outside human range

   Findings already known and accepted are listed in npc-audit-accepted.json
   with the issue that owns them. Anything not on that list fails the run, so a
   change that puts a new hand through the counter cannot land quietly.

   Usage:  node scripts/npc-audit.mjs [--url http://localhost:4321] [--json out.json]
   Env:    CHROME_PATH, SMOKE_FLAGS
   ============================================================ */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { session, openScene, sleep } from './lib/chrome.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const URL_ = arg('--url', 'http://localhost:4321');
const JSON_OUT = arg('--json', '');

const accepted = JSON.parse(readFileSync(join(here, 'npc-audit-accepted.json'), 'utf8'));
const acceptedIds = new Set(accepted.accepted.map((a) => a.id));

/* ---------- geometry helpers ---------- */

// Overlap depth of two axis-aligned boxes: positive means they interpenetrate.
// Surfaces that merely touch produce ~0 and are not reported.
function overlap(a, b) {
  if (!a || !b) return null;
  const d = ['x', 'y', 'z'].map((k) => Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]));
  return Math.min(...d);
}
// Shortest gap between two boxes on each axis; 0 when they overlap on that axis.
function gap(a, b) {
  if (!a || !b) return null;
  let sum = 0;
  for (const k of ['x', 'y', 'z']) {
    const d = Math.max(a.min[k] - b.max[k], b.min[k] - a.max[k], 0);
    sum += d * d;
  }
  return Math.sqrt(sum);
}
function pointGap(a, b) {
  if (!a || !b) return null;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
const round = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);

/* ---------- limits ----------
   Angles are radians on the rig's own axes. The elbow hinge is negative when
   flexed, so any positive value past a few degrees is the joint bending the
   wrong way. Ranges are deliberately generous: this is for "no human does
   that", not for posture critique. */
const LIMITS = {
  elbowMin: -2.45,   // ~140 degrees of flexion
  elbowMax: 0.02,    // effectively straight; positive is backwards
  shoulderFlexMin: -3.05,
  shoulderFlexMax: 0.90,
  shoulderAbdMax: 1.60,
  headMax: 1.40,     // ~80 degrees
};
const CLIP_TOL = 0.005;      // 5mm, below this counts as surfaces touching
const CONTACT_TOL = 0.02;    // a reach closer than 2cm counts as contact

/* ---------- sampling plan ---------- */
// `eat` is driven by its bite clock rather than the action timeline, so it is
// swept across the full bite (reach, hold at the mouth, return).
const SWEEPS = {
  eat: [0, 0.35, 0.7, 1.0, 1.35, 1.6, 1.75, 1.95, 2.15, 2.4, 2.6, 2.8, 3.0, 3.2, 3.4, 3.6, 3.8, 4.1],
  default: [0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.4, 2.8, 3.2],
};

const findings = [];
const record = (id, check, subject, act, tl, detail, measure) => {
  findings.push({ id, check, subject, act, tl: round(tl), detail, measure });
};

await session({ width: 1440, height: 900 }, async (ctx) => {
  const { evaluate, errors } = ctx;
  if (!await openScene(ctx, URL_)) {
    console.error('\nFAILED: the scene did not boot, so no pose could be sampled.');
    console.error('What to do: run `npm run preview` and open the URL by hand to see the error.\n');
    process.exit(1);
  }
  await sleep(400);
  await evaluate('window.__nightbowl.auditBegin()');

  const furniture = await evaluate('window.__nightbowl.auditFurniture()');
  const subjects = await evaluate('window.__nightbowl.auditSubjects()');
  const acts = await evaluate('window.__nightbowl.auditActs()');

  const solids = [
    ['counter top', furniture.counterTop],
    ['counter front', furniture.counterFront],
    ['counter shelf', furniture.counterShelf],
    ['pot', furniture.pot],
  ].filter(([, b]) => b);

  const bodies = {};   // subject key -> body box at rest, for character/character overlap

  // One round trip for the whole sweep: per-sample CDP calls dominated runtime.
  const samples = await evaluate(`window.__nightbowl.auditSweep(${JSON.stringify(SWEEPS)})`);

  for (const s of samples) {
    const sub = { kind: s.kind, index: s.index, x: s.subjectX };
    const key = `${s.kind}${s.index}`;
    const act = s.act;
    const tl = s.tl;
    const stool = furniture.stools.find((st) => Math.abs(st.seatX - sub.x) < 0.01);
    if (!bodies[key]) bodies[key] = s.boxes.body;

    /* --- limbs inside solid furniture --- */
    for (const [name, box] of solids) {
      for (const part of ['handL', 'handR', 'forearmL', 'forearmR']) {
        const d = overlap(s.boxes[part], box);
        if (d !== null && d > CLIP_TOL) {
          record(`clip:${key}:${act}:${part}:${name.replace(/ /g, '-')}`,
            'geometry interpenetration', key, act, tl,
            `${part} is ${round(d)}m inside the ${name}`, { depth: round(d) });
        }
      }
    }

    /* --- seat not carrying the body: the pelvis, not the whole bounding box,
           which would trivially enclose the stool --- */
    if (stool?.box && s.boxes.pelvis) {
      const d = overlap(s.boxes.pelvis, stool.box);
      if (d !== null && d > CLIP_TOL) {
        record(`clip:${key}:stool`, 'geometry interpenetration', key, act, tl,
          `pelvis is ${round(d)}m inside the stool seat`
          + ` (seat top y=${round(stool.box.max.y)}, pelvis bottom y=${round(s.boxes.pelvis.min.y)})`,
          { depth: round(d), seatTopY: round(stool.box.max.y), pelvisMinY: round(s.boxes.pelvis.min.y) });
      }
    }

    /* --- joints outside human range --- */
    const a = s.angles;
    const jointChecks = [
      ['left elbow', a.lElX, LIMITS.elbowMin, LIMITS.elbowMax],
      ['right elbow', a.rElX, LIMITS.elbowMin, LIMITS.elbowMax],
      ['left shoulder flexion', a.lShX, LIMITS.shoulderFlexMin, LIMITS.shoulderFlexMax],
      ['right shoulder flexion', a.rShX, LIMITS.shoulderFlexMin, LIMITS.shoulderFlexMax],
      ['left shoulder abduction', a.lShZ, -LIMITS.shoulderAbdMax, LIMITS.shoulderAbdMax],
      ['right shoulder abduction', a.rShZ, -LIMITS.shoulderAbdMax, LIMITS.shoulderAbdMax],
      ['head pitch', a.headX, -LIMITS.headMax, LIMITS.headMax],
      ['head yaw', a.headY, -LIMITS.headMax, LIMITS.headMax],
    ];
    for (const [name, value, lo, hi] of jointChecks) {
      if (!Number.isFinite(value)) {
        record(`joint:${key}:${act}:${name.replace(/ /g, '-')}:nonfinite`,
          'impossible joint', key, act, tl, `${name} is ${value}`, { value });
      } else if (value < lo || value > hi) {
        record(`joint:${key}:${act}:${name.replace(/ /g, '-')}`,
          'impossible joint', key, act, tl,
          `${name} is ${round(value)} rad, outside [${lo}, ${hi}]`, { value: round(value) });
      }
    }

    /* --- reaches that never arrive --- */
    if (act === 'eat' && tl >= 2.15 && tl <= 3.0 && s.boxes.heldChopsticks) {
      const g = gap(s.boxes.heldChopsticks, headBox(s));
      if (g !== null && g > CONTACT_TOL) {
        record(`contact:${key}:eat:chopsticks-mouth`, 'contact miss', key, act, tl,
          `chopsticks stop ${round(g)}m short of the face at the top of the bite`,
          { gap: round(g) });
      }
    }
    if (act === 'eat' && s.boxes.handL && s.boxes.ownBowl) {
      const d = overlap(s.boxes.handL, s.boxes.ownBowl);
      if (d !== null && d > CLIP_TOL) {
        record(`clip:${key}:eat:free-hand:own-bowl`, 'geometry interpenetration', key, act, tl,
          `free hand is ${round(d)}m inside its own bowl`, { depth: round(d) });
      }
    }
    if (act === 'eat' && tl >= 2.15 && tl <= 3.0 && s.joints.handR && s.joints.head) {
      const rise = s.joints.handR.y - s.joints.head.y;
      if (rise > 0.04) {
        record(`pose:${key}:eat:hand-above-head`, 'impossible pose', key, act, tl,
          `chopstick hand is ${round(rise)}m above the head centre`, { gap: round(rise) });
      }
    }
    if (act === 'wipe' && s.boxes.cloth && furniture.counterTop) {
      const g = gap(s.boxes.cloth, furniture.counterTop);
      if (g !== null && g > CONTACT_TOL) {
        record(`contact:${key}:wipe:cloth-counter`, 'contact miss', key, act, tl,
          `cloth hovers ${round(g)}m above the counter it is wiping`, { gap: round(g) });
      }
    }
    if (act === 'stir' && s.boxes.ladle && furniture.pot) {
      const d = overlap(s.boxes.ladle, furniture.pot);
      if (d === null || d <= CLIP_TOL) {
        record(`contact:${key}:stir:ladle-pot`, 'contact miss', key, act, tl,
          'ladle is not inside the pot while stirring', { depth: round(d) });
      }
    }
    if (act === 'stir' && s.joints.toolGrip && s.joints.toolHand) {
      const g = pointGap(s.joints.toolGrip, s.joints.toolHand);
      if (g !== null && g > CONTACT_TOL) {
        record(`contact:${key}:stir:hand-ladle-grip`, 'contact miss', key, act, tl,
          `ladle grip is ${round(g)}m away from the hand`, { gap: round(g) });
      }
    }
  }

  /* --- two characters in the same space --- */
  const keys = Object.keys(bodies);
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const d = overlap(bodies[keys[i]], bodies[keys[j]]);
      if (d !== null && d > CLIP_TOL) {
        record(`clip:${keys[i]}:${keys[j]}`, 'geometry interpenetration', `${keys[i]}+${keys[j]}`,
          'rest', 0, `${keys[i]} and ${keys[j]} overlap by ${round(d)}m`, { depth: round(d) });
      }
    }
  }

  await evaluate('window.__nightbowl.auditEnd()');
  if (errors.length) {
    record('runtime:exception', 'runtime error', 'page', '-', 0, errors[0], {});
  }

  // head box is not returned directly; rebuild it from the head joint and the
  // head radius the rig uses, so the contact test has something to measure to.
  function headBox(s) {
    const h = s.joints.head;
    if (!h) return null;
    const r = 0.12;
    return { min: { x: h.x - r, y: h.y - r, z: h.z - r }, max: { x: h.x + r, y: h.y + r, z: h.z + r } };
  }
});

/* ---------- report ---------- */

// Collapse the sweep: one line per distinct defect, with its worst sample.
const byId = new Map();
for (const f of findings) {
  const cur = byId.get(f.id);
  const score = Math.abs(f.measure?.depth ?? f.measure?.gap ?? f.measure?.value ?? 0);
  if (!cur || score > cur.score) byId.set(f.id, { ...f, score, count: (cur?.count || 0) + 1 });
  else cur.count++;
}
const unique = [...byId.values()].sort((a, b) => b.score - a.score);
const fresh = unique.filter((f) => !acceptedIds.has(f.id));
const known = unique.filter((f) => acceptedIds.has(f.id));

console.log(`\nnightbowl NPC audit → ${URL_}\n`);
console.log(`sampled ${findings.length} violating poses, ${unique.length} distinct defects\n`);

if (known.length) {
  console.log('known and accepted (each owned by an issue):');
  for (const f of known) {
    const note = accepted.accepted.find((a) => a.id === f.id);
    console.log(`  · ${f.check}: ${f.detail}`);
    console.log(`      ${f.subject} / ${f.act}   owned by ${note.issue}`);
  }
  console.log('');
}

if (fresh.length) {
  console.log(`${fresh.length} NEW defect(s) — these are not on the accepted list:\n`);
  for (const f of fresh) {
    console.log(`  FAIL  ${f.check}`);
    console.log(`        what:  ${f.detail}`);
    console.log(`        where: ${f.subject} performing "${f.act}" at t=${f.tl}s`);
    console.log(`        id:    ${f.id}`);
    console.log('');
  }
  console.log('What to do:');
  console.log('  Reproduce locally:  npm run preview   then   npm run audit:npc');
  console.log('  Look at the pose:   npm run audit:visual');
  console.log('  If the change is deliberate and the new pose is correct, add the id above');
  console.log('  to scripts/npc-audit-accepted.json with the issue that owns it.\n');
} else {
  console.log('no new defects\n');
}

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ findings: unique, fresh: fresh.map((f) => f.id) }, null, 2));
  console.log(`wrote ${JSON_OUT}\n`);
}

process.exit(fresh.length ? 1 : 0);
