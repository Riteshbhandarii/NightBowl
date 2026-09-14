# Performance baseline

Every number here was measured by `scripts/perf-baseline.mjs` against the
production build. Nothing is estimated. Where something could not be measured,
it says so and why.

- measured: 2026-09-15, **before** the pose fixes in this branch, so it records
  the state the audit was run against
- renderer: `ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version)`
- rasteriser: hardware GPU
- frame sampling window: 30s per configuration
- command: `node scripts/perf-baseline.mjs --url <production build>`

## What the columns mean

- **median fps** — the middle frame time over the window, expressed as a rate.
- **1% low fps** — the worst 1% of frame times, expressed as a rate. This is the
  number that corresponds to visible stutter; an average hides it.
- **worst frame** — the single longest frame in the window, in milliseconds.
- **first interactive** — milliseconds from navigation start to the scene handle
  existing with a frame presented.
- **overflow x** — horizontal scroll in CSS pixels. Anything above 0 is a defect.

## Frame rate, startup and scene cost

| viewport | CPU | median fps | 1% low fps | worst frame ms | first interactive ms | draw calls | triangles | overflow x |
|---|---|---|---|---|---|---|---|---|
| phone 390x844 | 1x | 59.9 | 59.5 | 16.8 | 260 | 171 | 29594 | 0 |
| phone 390x844 | 4x | 59.9 | 59.5 | 16.8 | 399 | 160 | 27738 | 0 |
| phone 390x844 | 6x | 59.9 | 59.5 | 16.8 | 589 | 158 | 27682 | 0 |
| phone landscape 844x390 | 1x | 59.9 | 59.5 | 16.8 | 255 | 279 | 50846 | 0 |
| phone landscape 844x390 | 4x | 59.9 | 59.5 | 16.8 | 378 | 268 | 48948 | 0 |
| phone landscape 844x390 | 6x | 59.9 | 59.5 | 16.8 | 534 | 262 | 49656 | 0 |
| tablet 768x1024 | 1x | 59.9 | 59.5 | 33.4 | 256 | 244 | 43490 | 0 |
| tablet 768x1024 | 4x | 59.9 | 59.5 | 16.8 | 373 | 229 | 41004 | 0 |
| tablet 768x1024 | 6x | 59.9 | 59.5 | 16.8 | 510 | 230 | 41882 | 0 |
| tablet landscape 1024x768 | 1x | 59.9 | 59.5 | 16.8 | 254 | 255 | 45066 | 0 |
| tablet landscape 1024x768 | 4x | 59.9 | 59.5 | 16.8 | 376 | 249 | 44082 | 0 |
| tablet landscape 1024x768 | 6x | 59.9 | 59.5 | 66.7 | 529 | 244 | 43156 | 0 |
| laptop 1440x900 | 1x | 59.9 | 59.5 | 16.8 | 258 | 231 | 41386 | 0 |
| laptop 1440x900 | 4x | 59.9 | 59.5 | 16.8 | 389 | 250 | 44084 | 0 |
| laptop 1440x900 | 6x | 59.9 | 59.5 | 16.8 | 584 | 241 | 43168 | 0 |
| monitor 2560x1440 | 1x | 59.9 | 59.5 | 16.8 | 257 | 237 | 42438 | 0 |
| monitor 2560x1440 | 4x | 59.9 | 59.5 | 16.8 | 387 | 248 | 43862 | 0 |
| monitor 2560x1440 | 6x | 59.9 | 59.5 | 16.8 | 522 | 237 | 43418 | 0 |

## Memory

Measured over 5 minutes at 1440x900, seated, with garbage collection forced over the
DevTools protocol before the first and last sample so the figure reflects
retention rather than allocation noise.

| measurement | value |
|---|---|
| heap after GC at start | 9336.1 KiB |
| heap after GC at end | 10368.5 KiB |
| peak heap during the run | 12797.2 KiB |
| growth over 5 min | **11.1%** |

Per-minute samples (not post-GC, so these include ordinary allocation churn):

| minute | heap |
|---|---|
| 1 | 12506.3 KiB |
| 2 | 11913.8 KiB |
| 3 | 12797.2 KiB |
| 4 | 11884.9 KiB |
| 5 | 11446.9 KiB |

## Payload

Built output in `dist/client`, uncompressed on disk:

| measurement | value |
|---|---|
| JavaScript | 3564.7 KiB |
| CSS | 16.4 KiB |
| all client files | 3618.1 KiB |
| file count | 15 |

Over the wire, first-party only, cache disabled (the server applies gzip):

| viewport | transferred | requests |
|---|---|---|
| phone 390x844 | 174.8 KiB | 4 |
| phone landscape 844x390 | 174.8 KiB | 4 |
| tablet 768x1024 | 174.8 KiB | 4 |
| tablet landscape 1024x768 | 174.8 KiB | 4 |
| laptop 1440x900 | 174.8 KiB | 4 |
| monitor 2560x1440 | 174.8 KiB | 4 |

## Texture memory

**Count only, bytes not measurable.** WebGL exposes no query for texture memory,
and `renderer.info.memory` reports the number of allocated objects rather than
their size. Inventing a megabyte figure from texture dimensions would be a guess
presented as a measurement, so it is left out.

| measurement | value |
|---|---|
| textures allocated | 12 |
| geometries allocated | 206 |

## What these numbers are not

The GPU here is a desktop part. CPU throttling slows the main thread but
leaves the GPU untouched, so the 4x and 6x rows describe a fast GPU behind a
slow CPU, not a phone. **A real mobile frame rate cannot be obtained from this
harness** and needs a physical device.


## Verdict against the starting budgets

| budget | target | measured | |
|---|---|---|---|
| desktop 1440x900 median | >= 55 fps | 59.9 fps | pass |
| desktop 1440x900 1% low | >= 30 fps | 59.5 fps | pass |
| mobile 390x844 @4x CPU median | >= 30 fps | 59.9 fps | pass, see caveat below |
| mobile 390x844 @4x CPU 1% low | >= 20 fps | 59.5 fps | pass, see caveat below |
| first interactive, throttled mobile | <= 2.5 s | 0.399 s at 4x, 0.589 s at 6x | pass |
| heap growth over 5 min, post GC | <= 10% | **11.1%** | **fail** |
| horizontal scroll at any width >= 360px | none | 0 at every viewport | pass |
| bundle size | record current | see Payload above | recorded |

One budget fails: heap growth, at 11.1% against 10%. Per the instruction not to
chase a budget the scene already misses, it is recorded rather than fixed, and
issue #33 owns closing it. That issue also notes this is a single sample and
should be repeated before being called a leak.

The frame rate rows pass everywhere, at every viewport and every CPU throttle,
with the same numbers each time. That flatness is itself the finding: on this
hardware the scene never approaches the frame budget, so the harness cannot
tell the configurations apart. It does not mean the mobile budget is met. See
the caveat below and issue #34.

## Scene cost is unchanged by the pose fixes in this branch

Re-measured after the fixes with the same 30 second window, so the comparison is
like for like:

| measurement | largest change across all 18 configurations |
|---|---|
| draw calls | 24 |
| triangles | 3826 |

The changes scatter in both directions and average near zero, so this is
sampling spread rather than a regression: draw calls and triangle count are read
at a single instant, and how much of the street is inside the view frustum
depends on where the walkers happen to be standing.

That spread is worth knowing on its own. A budget on triangle count needs
roughly 4000 triangles of headroom to avoid failing on sampling luck, which is
part of what issue #35 covers.

An earlier comparison using a 5 second window appeared to show triangles rising
by 33%. That was the sampling window, not the scene: with a shorter window the
reading is taken at a different moment in the walk cycle. It is recorded here
because the wrong conclusion was available and cheap to reach.
