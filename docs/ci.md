# What CI does, and what it protects you from

This explains every automatic check that runs when you open a pull request: what
it does, what breakage it is there to catch, what it means when it goes red, and
how to run the same thing on your own machine.

If a failure message ever sends you here and this page does not answer it, that
is a bug in this page. Say so.

---

## The short version

Four jobs run. Three of them test something; the fourth just reports how long it
all took.

| job | one-line purpose |
|---|---|
| **build** | the code compiles, every page is generated, the download stays small |
| **scene** | the 3D stall starts, nobody's hand is inside the counter, it works on phones |
| **cms** | you can still log into `/admin` and publish |
| **summary** | how long CI took |

`build` runs first. `scene` and `cms` then run at the same time, reusing the
build rather than each doing their own. That is why the whole thing finishes in
a few minutes rather than three times that.

---

## Job 1: build

**What it catches:** code that no longer compiles, a page that silently stops
being generated, and a JavaScript download that has quietly grown.

It runs four checks in order.

### Type check
Reads every TypeScript and Astro file and confirms the types line up.

*Red means:* something is being used in a way that does not match its
definition, for example reading a field on a content entry that the schema does
not have.

*Reproduce it:*
```
npm run check
```

### Build
Produces the real production site into `dist/`.

*Red means:* the site cannot be built at all. Everything else is blocked.

*Reproduce it:*
```
npm run build
```

### Every expected route was generated
Confirms the pages that should exist actually came out of the build: the home
page, the Kitchen Log index, each published post, the admin.

*Red means:* a page vanished. The usual cause is a content file with broken
frontmatter, so the build skips it without complaining.

*Reproduce it:*
```
npm run build
npm run check:build
```

### JavaScript payload is within budget
Adds up the JavaScript the home page has to download before it works, and fails
if it is over the limit.

*Red means:* something got imported into the page that drags in far more than it
looks like. This is the check that stops the site getting slowly heavier without
anyone noticing.

*Reproduce it:*
```
npm run build
npm run check:perf
```

The limit itself is in `scripts/perf-budget.mjs`.

---

## Job 2: scene

**What it catches:** the 3D stall failing to start, a character posed somewhere
physically impossible, and the site breaking on a phone.

It starts the real production server, then runs two suites against it.

### Browser smoke test

Drives a real browser and checks the things that break without throwing an
error, which are the ones you would otherwise find out about from a visitor:

- the scene starts at all, and shows a readable message instead of a blank
  screen if WebGL is unavailable
- the cook, the diners and the street walkers all exist
- nobody's rig has picked up a broken number, which renders as a person who has
  vanished or turned inside out and logs nothing
- the walk-in intro actually finishes, so the site becomes usable
- every viewport from a 280px phone to a 1920px monitor: nothing overflows
  sideways, the navigation and the menu book stay reachable
- touch drag and two-finger pinch work and do not scroll the page underneath
- reduced-motion is honoured
- the menu still opens when the 3D scene is switched off entirely
- on a throttled 4G connection: how long until the menu is usable, and how many
  bytes actually crossed the wire

*Red means:* the log names the failing check on a line starting with `FAIL`,
followed by what was expected and what was measured. Read that line first.

*Reproduce it:*
```
npm run build
npm run preview        # leave this running in one terminal
npm run smoke          # in another terminal
```

### NPC pose audit

This one is worth understanding, because it is the check that stops the
characters drifting back into nonsense.

It freezes the scene, then forces every character through every action they can
perform — eating, drinking, pausing, talking, listening, looking up, stirring,
wiping, serving — sampling each action at many points across its timeline. At
each sample it measures where the hands, forearms, pelvis and held props
actually are in the world, and compares them against the furniture that is
really in the scene.

It fails if:

- a hand or forearm is inside the counter, the pot or the shelf
- a character's pelvis is inside the stool they are sitting on
- two characters occupy the same space
- a reach never arrives: chopsticks that stop short of the mouth, a cloth
  hovering above the counter it is supposedly wiping, a ladle that is not in
  the pot
- a joint bends past what a human joint does, for example an elbow bending
  backwards

The furniture positions are read from the scene at runtime, not copied into the
test. Move the counter and the test moves with it.

*Red means:* a change has put a limb somewhere it cannot be. The log names the
character, which action, how far into that action, and how deep into the
furniture the limb went. For example:

```
FAIL  geometry interpenetration
      what:  forearmL is 0.161m inside the pot
      where: cook0 performing "stir" at t=2s
      id:    clip:cook0:stir:forearmL:pot
```

*Reproduce it:*
```
npm run build
npm run preview        # one terminal
npm run audit:npc      # another
```

*If the new pose is actually correct* and the audit is the thing that is wrong,
add the printed `id` to `scripts/npc-audit-accepted.json` along with the issue
that owns it. Everything on that list is reported but does not fail the build.
That file is the list of defects we know about and have decided not to fix yet —
it should get shorter over time, not longer.

---

## Job 3: cms

**What it catches:** the admin losing its GitHub login, or publishing breaking.

Two checks:

**Production admin requires a real login.** Confirms the built site sends you to
GitHub to sign in. The failure that matters here is the opposite: a compiled
production site exposing the unauthenticated local-file editing API, which would
let anyone edit the site.

**Local editing works.** Starts the development server and confirms you can
actually open `/admin`, edit, and save.

*Reproduce them:*
```
npm run build
npm run preview
npm run smoke:cms -- --mode production

npm run dev
npm run smoke:cms -- --url http://127.0.0.1:4322 --mode local
```

---

## Job 4: summary

Prints a table of how long each job took and the total wall clock, into the run
summary page on GitHub. It does not test anything. It exists so the cost of
waiting for CI stays visible.

---

## The honest limitation: CI cannot measure speed

The machine that runs CI has no graphics card. Chrome falls back to rendering
the 3D scene in software, on the CPU.

That works — the scene runs, and everything above genuinely gets tested. But any
frame rate measured there describes a software renderer on a shared virtual
machine. It is not what a phone does, not what a laptop does, and not a number
worth blocking a merge on. Wiring up a "60fps ✓" badge from that measurement
would be a green check that means nothing.

**So CI does not check frame rate at all.** What it checks instead:

- **geometry cost** — draw calls and triangle count, asserted in the smoke test.
  These are the things that actually determine whether the scene is expensive,
  and they are identical with or without a GPU.
- **pose correctness** — the NPC audit above, which is pure geometry and equally
  deterministic.
- **download size** — the payload budget, and the measured bytes over a
  throttled connection.

**Real frame rates come from running it yourself, on hardware:**

```
npm run build
npm run preview
npm run baseline
```

That writes `docs/baseline.md` with frame rates, startup time, memory growth and
scene cost across six viewport shapes and three CPU speeds. It takes about
fifteen minutes because it measures each configuration for a full thirty seconds
and then watches memory for five more.

`docs/baseline.md` records what the current numbers are, and is explicit about
what they do and do not prove — in particular that CPU throttling slows the
processor but leaves the graphics card alone, so none of those rows describe a
real phone. A genuine mobile number needs a real phone.

---

## Reproducing anything locally, in one place

```
npm ci                 # install exactly what CI installs
npm run check          # types
npm run build          # production build
npm run check:build    # every page generated
npm run check:perf     # payload budget

npm run preview        # serve the production build, leave running

npm run smoke          # browser suite, all viewports
npm run audit:npc      # character pose audit
npm run smoke:cms -- --mode production

npm run baseline       # frame rates and memory, ~15 min, hardware only
```

If Chrome is not found, set `CHROME_PATH` to your browser binary.
