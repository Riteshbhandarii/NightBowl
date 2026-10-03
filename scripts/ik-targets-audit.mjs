/* Prove semantic IK contacts follow live object transforms, not scene literals. */
import { session, openScene } from './lib/chrome.mjs';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const url = arg('--url', 'http://localhost:4321');
const failures = [];

const delta = (after, before) => ({
  x: after.x - before.x,
  y: after.y - before.y,
  z: after.z - before.z,
});
const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const maxAxisError = (actual, expected, axes = ['x', 'y', 'z']) =>
  Math.max(...axes.map((axis) => Math.abs(actual[axis] - expected[axis])));
const reverse = ({ x = 0, y = 0, z = 0 }) => ({ x: -x, y: -y, z: -z });

await session({ width: 1200, height: 900 }, async (ctx) => {
  const { evaluate, errors } = ctx;
  if (!await openScene(ctx, url)) throw new Error('Scene did not boot');
  await evaluate('window.__nightbowl.auditBegin()');

  const pose = (kind, index, act, tl) => evaluate(
    `window.__nightbowl.auditPose(${JSON.stringify(kind)}, ${index}, ${JSON.stringify(act)}, ${tl})`
  );
  const perturb = (target, index, movement) => evaluate(
    `window.__nightbowl.auditIKPerturb(${JSON.stringify(target)}, ${index}, ${JSON.stringify(movement)})`
  );

  const follows = async ({ name, target, index, movement, kind, act, tl, targetPoint, effector, axes, tolerance }) => {
    const before = await pose(kind, index, act, tl);
    if (!await perturb(target, index, movement)) throw new Error(`Could not perturb ${target}`);
    const after = await pose(kind, index, act, tl);
    await perturb(target, index, reverse(movement));
    const expected = delta(after.targets[targetPoint], before.targets[targetPoint]);
    const actual = delta(after.joints[effector], before.joints[effector]);
    const error = maxAxisError(actual, expected, axes);
    console.log(`${name}: max ${axes.join('/')} follow error ${error.toFixed(3)}m`);
    if (error > tolerance) failures.push(`${name} moved ${error.toFixed(3)}m away from its live target delta`);
    return after;
  };

  await follows({
    name: 'bowl → chopstick tip', target: 'bowl', index: 0,
    movement: { x: 0.08, y: 0.06, z: -0.05 }, kind: 'diner', act: 'eat', tl: 0,
    targetPoint: 'bowl', effector: 'chopstickTip', axes: ['x', 'y', 'z'], tolerance: 0.012,
  });
  const mouth = await follows({
    name: 'mouth → chopstick tip', target: 'mouth', index: 1,
    movement: { x: 0.06, y: 0.05, z: 0.04 }, kind: 'diner', act: 'eat', tl: 1.5,
    targetPoint: 'mouth', effector: 'chopstickTip', axes: ['x', 'y', 'z'], tolerance: 0.012,
  });
  if (gap(mouth.joints.handR, mouth.joints.chopstickGrip) > 0.02) {
    failures.push('chopstick grip left the hand after mouth perturbation');
  }
  const cup = await follows({
    name: 'mouth → cup rim', target: 'mouth', index: 2,
    movement: { x: 0.04, y: 0.03, z: 0.02 }, kind: 'diner', act: 'drink', tl: 1.5,
    targetPoint: 'mouth', effector: 'cupRim', axes: ['x', 'y', 'z'], tolerance: 0.012,
  });
  if (gap(cup.joints.handL, cup.joints.cupGrip) > 0.02) {
    failures.push('cup grip left the hand after mouth perturbation');
  }

  const pot = await follows({
    name: 'pot → ladle scoop', target: 'pot', index: 0,
    movement: { x: 0.10, y: 0.08, z: 0.06 }, kind: 'cook', act: 'stir', tl: 1.2,
    targetPoint: 'pot', effector: 'toolScoop', axes: ['x', 'y', 'z'], tolerance: 0.012,
  });
  if (gap(pot.joints.toolHand, pot.joints.toolGrip) > 0.02) {
    failures.push('ladle grip left the hand after pot perturbation');
  }

  await follows({
    name: 'counter → wiping hand', target: 'counter', index: 0,
    movement: { x: 0.07, y: 0.08, z: 0.05 }, kind: 'cook', act: 'wipe', tl: 1.2,
    targetPoint: 'counter', effector: 'handR', axes: ['y', 'z'], tolerance: 0.035,
  });

  const beforeScale = await pose('diner', 1, 'eat', 1.5);
  await evaluate(`window.__nightbowl.auditIKPerturb('body', 1, { scale: 1.15 })`);
  const afterScale = await pose('diner', 1, 'eat', 1.5);
  await evaluate(`window.__nightbowl.auditIKPerturb('body', 1, { scale: ${1 / 1.15} })`);
  const beforeContact = gap(beforeScale.joints.chopstickTip, beforeScale.targets.mouth);
  const afterContact = gap(afterScale.joints.chopstickTip, afterScale.targets.mouth);
  console.log(`body scale → mouth contact ${beforeContact.toFixed(3)}m / ${afterContact.toFixed(3)}m`);
  if (afterContact > 0.012 || gap(afterScale.joints.handR, afterScale.joints.chopstickGrip) > 0.02) {
    failures.push('scaled diner lost mouth or chopstick-grip contact');
  }

  await evaluate('window.__nightbowl.auditEnd()');
  if (errors.length) failures.push(`browser errors: ${errors.join(' | ')}`);
});

console.log(`\nnightbowl IK target audit → ${url}\n`);
if (failures.length) {
  for (const failure of failures) console.error(`FAIL  ${failure}`);
  process.exitCode = 1;
} else {
  console.log('all semantic targets followed their live transforms');
}
