# Heap retention

Issue #33 was a startup measurement failure, not a demonstrated continuing leak.
The old harness sampled three seconds after clicking the stool, halfway through
the six-second walk-in. The seated view then initialized resources outside the
starting frame. The new gate waits for the seated phase, warms it for 60 seconds,
and measures retained JS heap for five minutes. The 10% budget is unchanged.

## Measured result

Measured 2026-10-03 against the production scene at commit `7558c94`, on Chrome
154 with the Apple M5 hardware renderer. Each row used a fresh browser. The
endpoint is the last timed minute's forced-GC sample; an immediate second sample
would count the harness's state-query overhead rather than elapsed retention.

| run | start after GC (bytes) | five-minute endpoint (bytes) | growth | result |
|---|---|---|---|---|
| A, with snapshots | 9,130,388 | 8,965,416 | -1.81% | pass |
| B | 9,201,364 | 9,074,296 | -1.38% | pass |
| C | 9,256,644 | 9,014,712 | -2.61% | pass |
| final harness verification | 9,163,468 | 9,171,244 | +0.08% | pass |

The final run held 303 renderer geometries and 16 textures throughout all five
minutes; speech bubbles were zero or one. These are resource counts, not GPU
memory bytes. Runs A/B/C were collected before the redundant final sample was
removed; their last timed samples are reported here using the corrected endpoint.

## Snapshot findings

Three earlier cold five-minute runs reproduced a 21–23% increase from the
premature baseline, in both audit mode and an ordinary visit. Most of it arrived
in the first minute; subsequent post-GC samples were flat or lower.

The cold start/end snapshots showed initial renderer setup: approximately 412–420
additional WebGL buffers, 129–131 vertex-array objects, and compiled V8 code.
The warmed start/end snapshots showed **no further WebGL buffer, texture, or
vertex-array growth**. Their largest positive differences were V8 code/cache
entries; ordinary object/array changes were small. Together with the repeated
time series, this does not support the original claim of an ongoing scene leak.

Local raw evidence is in `/private/tmp/nightbowl-33-evidence` (cold snapshots),
`/private/tmp/nightbowl-33-warm-snapshots` (warmed snapshots), and
`/private/tmp/nightbowl-33-{warm,warm2,warm3,final}.json` (measurements).
These scratch artifacts are not required by the repository or future runs.

## Reproduce

Build and serve the production site, then run:

```sh
npm run baseline -- --memory-only --url http://127.0.0.1:4321 \
  --heap-snapshots /tmp/nightbowl-heap-snapshots \
  --json /tmp/nightbowl-heap.json
```

Memory-only mode runs three independent browsers sequentially by default and
skips the frame-rate matrix. Each run adds 60 seconds of warmup plus five minutes
of measurement. `--leak-runs 1` selects one run. Ordinary baseline mode retains
its frame-rate matrix and defaults to one heap run. `--quick` skips the heap run;
it cannot certify retention.

The script reports every run and compares its unrounded growth with 10%. An
over-budget or unmeasurable run causes a nonzero exit. A deliberately unreachable
server was checked: both requested runs were reported as unmeasurable and the
command exited with code 1. This is desktop JS retention evidence; physical
iPhone and Android measurements in issue #34 remain outstanding.
