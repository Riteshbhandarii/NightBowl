# What CI does, and what it protects you from

This explains every automatic check that runs when you open a pull request: what
it does, what breakage it is there to catch, what it means when it goes red, and
how to run the same thing on your own machine.

If a failure message ever sends you here and this page does not answer it, that
is a bug in this page. Say so.

---

## The short version

Five jobs run. Four of them test something; the fifth just reports how long it
all took.

| job | one-line purpose |
|---|---|
| **build** | the code compiles, every page is generated, the download stays small |
| **scene** | the 3D stall starts, nobody's hand is inside the counter, it works on phones |
| **interactions** | menu content/focus, repeat meals and planted walking remain correct |
| **cms** | you can still log into `/admin` and publish |
| **summary** | how long CI took |

`build` runs first. `scene`, `interactions` and `cms` then run at the same time,
reusing that same build. The longer meal lifecycle tests don't consume the scene
job's time allowance, and every suite still runs before merge.

---

## Job 1: build

**What it catches:** code that no longer compiles, a page that silently stops
being generated, and a JavaScript download that has quietly grown.

It runs the type check, builds the site, tests publication/launch fixtures,
then checks generated routes and payload size.

`npm run check:projects` temporarily gives a draft extended Markdown and private
structured fields. It verifies those stay out of public pages, publishes the
fixture to exercise headings, lists, code and images, then restores and rebuilds
the real content. `npm run check:launch` tests approved/unapproved email,
missing/non-PDF CV rejection, configured and unconfigured canonical/share
metadata, image dimensions and sitemap exclusions. Its temporary blank PDF is
deleted and site copy restored before the artifact is uploaded. These checks
must not run against a build that a browser suite is currently using.

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

The interactions job also runs `npm run audit:access` with JavaScript disabled
and with the scene bundle held, including native reading links, narrow layouts,
hash/history navigation and modifier clicks. `npm run audit:pause` verifies
keyboard activation, saved and blocked storage, static ordering, paired rendered
frames, service/departure clock continuity, reduced motion and WebGL fallback.
Both audits accept `-- --url http://127.0.0.1:4321 --out /tmp/nightbowl-review`.

---

## Job 2: scene

**What it catches:** the 3D stall failing to start, a character posed somewhere
physically impossible, and the site breaking on a phone.

It starts the real production server, then runs browser, NPC and IK suites.

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
- the navigation pins stay on the objects they label, do not land on top of
  each other, and are only hidden when their anchor really is off screen
- the walk-in intro takes the same wall-clock time on a starved machine as on
  an idle one
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

### Navigation pins

The four pins floating over the stall are HTML buttons, not part of the 3D
scene. Every frame their screen position is recalculated from a point in the
scene, so they can slide off the thing they label without anything erroring.

The check measures where each pin actually is and where its object actually is,
both in screen coordinates, at eleven viewport shapes from 280x653 to
1920x1080, including the 1440x900 and 390x844 the performance budgets are
written against. It fails if a pin stops
overlapping its object, if two pins land on top of each other so one cannot be
clicked, or if a pin hides while its anchor is plainly on screen.

One pin does not pass today: **The Bill** floats between 3 and 35 pixels above
the tip box depending on viewport. It is listed by name in `PIN_DRIFT` in
`scripts/smoke.mjs` and tracked by issue #45, so the other three cannot quietly
join it. When #45 is fixed, delete that entry.

### The walk-in intro under load

The walk-in is driven by the wall clock rather than by counting frames, so a
slow machine drops frames instead of stretching the animation out. That is easy
to break by accident and impossible to notice on a fast machine.

Throttling the CPU is not enough to test it — the intro is cheap, and 6x
throttling barely moved the frame rate on a machine with a GPU (30.1fps either
way). So the check also burns 80ms of every frame on the main thread, which
does bite. Measured, against a nominal 6000ms:

| where | frame rate | worst single frame | intro took | overshoot | if frame-counted |
|---|---|---|---|---|---|
| laptop GPU, idle | 30.0fps | 52ms | 6028ms | 28ms | 4000ms |
| laptop GPU, 6x CPU throttle | 30.1fps | 48ms | 6038ms | 38ms | 3987ms |
| laptop GPU, 6x + starved frames | 11.8fps | 97ms | 6176ms | 176ms | 10169ms |
| laptop software renderer, idle | 8.3fps | 462ms | 6034ms | 34ms | 14481ms |
| laptop software renderer, 6x + starved | 7.1fps | 587ms | 6211ms | 211ms | 16940ms |
| **CI runner, idle** | **0.8fps** | **4241ms** | **8328ms** | **2328ms** | **142767ms** |
| **CI runner, 6x CPU throttle** | **0.7fps** | **4845ms** | **8704ms** | **2704ms** | **174070ms** |
| **CI runner, 6x + starved frames** | **0.9fps** | **2210ms** | **6357ms** | **357ms** | **127146ms** |

The runner is worth looking at. With no GPU and a shared virtual machine it
draws this intro at under one frame per second, with single frames over four
seconds long. The intro still finishes within one frame of its deadline. A
frame-counted version would have taken over two minutes.

The runner rows move between runs — a second run of the same commit gave
8640ms, 9171ms and 7590ms with worst frames of 4259ms, 5110ms and 1487ms. Both
runs pass, because the allowance moves with the frame time rather than being a
fixed number. That is the point of bounding by one frame.

**The bound is one frame, not a percentage.** An animation driven by the wall
clock finishes on the first frame at or after its deadline, so it can overshoot
by about one frame and no more. On the laptop that is tens of milliseconds; on
the runner it is seconds. Any fixed percentage would either be meaningless on
the laptop or permanently red on the runner. The check allows one worst-case
frame plus 750ms for the poll interval and the 80ms the test itself burns.

*Red means:* the intro took longer than one frame past its deadline, which
means something is driving it by counting frames rather than reading the clock.
The failure prints the overshoot, what one frame allows, and what a
frame-counted version would have taken, so the three are directly comparable.
There is also a separate check that the starvation really did slow the frames
down, so this cannot pass by failing to load the machine.

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

*To see what a finding actually looks like:*
```
npm run audit:visual
```
That freezes the scene at the worst moment of each defect, points the camera at
the limb in question and writes photographs to `docs/pose-shots/`, one per
issue, from two angles. A measurement in millimetres is enough to fail a build
and not enough to fix a pose.

*If the new pose is actually correct* and the audit is the thing that is wrong,
add the printed `id` to `scripts/npc-audit-accepted.json` along with the issue
that owns it. Everything on that list is reported but does not fail the build.
That file is the list of defects we know about and have decided not to fix yet —
it should get shorter over time, not longer.

### Object-derived IK targets

The scene job also moves a bowl, a mouth, the pot and the counter, then checks
that the chopstick tip, cup rim, ladle scoop and wiping hand follow their live
transforms. It scales a diner and checks mouth and hand-to-chopstick contact.
The pose audit separately checks that a drinking hand grips the mug handle and
the rim reaches the mouth. Neither check relies on copied scene coordinates.

*Reproduce it:*
```
npm run build
npm run preview        # one terminal
npm run audit:ik       # another
```

---

## Job 3: interactions

### Menu accessibility and responsive interactions

`npm run audit:menu` covers the states missed by the original layout smoke checks:
an open book crossing the 860px breakpoint in either direction, all sections and
both Menu spreads retaining their content, native Tab traversal and accessibility
tree exclusion while closed, and rapid Enter/Escape races preserving opener focus.
It also measures descendant text bounds and reading-text/control overlap at
280/320/390/844px, then uses real pointer clicks on the draft-preview tabs and
checks that Close, Open menu and Back to admin stay reachable.

Use `npm run audit:menu -- --out /tmp/nightbowl-menu-review` for screenshots.
Zero document overflow alone does not certify readable, unclipped child content.

### Visitor meal interaction

`npm run audit:visitor` exercises House → Veggie and Veggie → Veggie through
seating, cook delivery and repeated bites until each bowl is empty. It checks
Eat again/Done, Just browsing and recoverable Order food, native held Enter/Space,
busy-service/turnover queues, hand-to-bowl contact and portfolio access throughout.
Five reduced-motion layouts get static immediate delivery without falsely claiming
the full bowl has been eaten. The visitor stays separate from diner AI/turnover.

Use `npm run audit:visitor -- --out /tmp/nightbowl-visitor-review` to capture live
choice, carry, placement, bite and completion frames for visual review.

The existing cost gates remain unchanged: 250 startup draw calls and 50,000
triangles in the reduced-motion phone-landscape view. Animated peaks are printed
separately, not passed off as meeting that static-view cap; the pre-feature live
animated scene already exceeds it. Physical phone performance remains #34.

### Grounded locomotion and sparse frames

`npm run audit:locomotion` measures world-space stance-foot drift on both diner
departure directions, an arriving customer and the serving cook. Precise shoe
mesh bounds also reject soles below the ground or floating above it; checking
only the shoe origin misses ankle rotation driving the sole through the floor.
It compares
actual street-root travel with gait distance under normal and starved frames,
checks a cook displacement over half a metre after a skipped render, verifies
service ordering and ensures reduced-motion walkers stay still. Sparse walker
checks keep actual rendering. No-GPU contact checks suppress continuous raster
while the real director/pose/gait loop keeps updating, so a walk cannot finish
before enough stance intervals are observable. The rendered scene is still
covered by smoke; screenshots explicitly draw the live pose. This is not an FPS gate.

Use `npm run audit:locomotion -- --out /tmp/nightbowl-locomotion-review` for live
full-body screenshots and a JSON measurement report. These photos preserve the
running gait pose; the frozen NPC pose sweep alone cannot prove walking contact.

---

## Job 4: cms

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
npm run preview                       # production build on 4321
npm run smoke:cms -- --mode production

npm run dev -- --port 4322            # dev server on its own port
npm run smoke:cms -- --url http://127.0.0.1:4322 --mode local
```

The port matters. `npm run dev` defaults to 4321, which `npm run preview` is
already using, so without `--port 4322` Astro quietly picks the next free port
and the smoke test then measures whatever is still on 4322 — possibly a server
left running from an hour ago. CI gives each server its own port for the same
reason. If a check passes or fails in a way that makes no sense, confirm what
is actually listening before believing the result:

```
lsof -nP -iTCP:4321 -sTCP:LISTEN
lsof -nP -iTCP:4322 -sTCP:LISTEN
```

---

## Job 5: summary

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
scene cost across six viewport shapes and three CPU speeds. Each configuration
is sampled for thirty seconds. The heap gate waits for the seated phase, warms
the scene for sixty seconds, then measures five minutes after forced garbage
collection. Growth above 10% or an unmeasurable run fails the command.

To repeat just the heap gate in three independent browsers, without the frame
matrix, run `npm run baseline -- --memory-only`. Optional
`--heap-snapshots /tmp/nightbowl-heap` captures before/after retained-object
snapshots. This writes `docs/heap-retention.md`; use `--out` to choose another
report path. See that report for the corrected measurement and issue #33's
startup-cache diagnosis.

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
npm run audit:visual   # photograph the poses the audit flags -> docs/pose-shots/
npm run smoke:cms -- --mode production

npm run baseline       # frame rates and memory, ~15 min, hardware only
```

If Chrome is not found, set `CHROME_PATH` to your browser binary.
