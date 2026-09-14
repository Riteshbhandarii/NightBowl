/* ============================================================
   nightbowl performance baseline

   Measures the production build in a real browser and writes the raw numbers
   to docs/baseline.md. Nothing here is estimated: every figure printed comes
   from a measurement, and anything that could not be measured is printed as
   "not measurable" with the reason rather than filled in.

   What it measures, per viewport and CPU throttle:
     frame rate    median, 1% low (the worst 1% of frame times), worst frame
     startup       time to the first interactive frame
     memory        peak JS heap, and growth over a long run after forced GC
     scene cost    draw calls, triangles, texture count
     transfer      first-party bytes over the wire
     layout        horizontal overflow

   Usage:
     node scripts/perf-baseline.mjs --url http://localhost:4321 [options]
       --fps-seconds N    sampling window per configuration (default 30)
       --leak-minutes N   duration of the leak run (default 5, 0 skips it)
       --quick            short sampling, for a smoke-level sanity check
       --out FILE         markdown destination (default docs/baseline.md)
       --json FILE        also write the raw measurements

   Env: CHROME_PATH, SMOKE_FLAGS
   ============================================================ */
import { writeFileSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { session, openScene, sleep, softwareRenderer } from './lib/chrome.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(n);
const URL_ = arg('--url', 'http://localhost:4321');
const QUICK = has('--quick');
const FPS_SECONDS = Number(arg('--fps-seconds', QUICK ? 5 : 30));
const LEAK_MINUTES = Number(arg('--leak-minutes', QUICK ? 0 : 5));
const OUT = arg('--out', 'docs/baseline.md');
const JSON_OUT = arg('--json', '');

/* Portrait shapes get their landscape rotation too; the desktop shapes are
   already landscape and are not rotated into a portrait no one uses. */
const VIEWPORTS = [
  { name: 'phone 390x844', w: 390, h: 844, mobile: true },
  { name: 'phone landscape 844x390', w: 844, h: 390, mobile: true },
  { name: 'tablet 768x1024', w: 768, h: 1024, mobile: true },
  { name: 'tablet landscape 1024x768', w: 1024, h: 768, mobile: true },
  { name: 'laptop 1440x900', w: 1440, h: 900, mobile: false },
  { name: 'monitor 2560x1440', w: 2560, h: 1440, mobile: false },
];
const THROTTLES = [1, 4, 6];

/* ---------- in-page frame recorder ---------- */
// Records raw frame deltas from rAF. Frame *times* are what matters: an average
// FPS hides the stalls, and the stalls are what a visitor notices.
const RECORDER = `(() => {
  window.__fps = { deltas: [], last: 0, on: false };
  const tick = (t) => {
    if (window.__fps.on) {
      if (window.__fps.last) window.__fps.deltas.push(t - window.__fps.last);
      window.__fps.last = t;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
})()`;

const stats = (deltas) => {
  if (!deltas.length) return null;
  const sorted = [...deltas].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];
  const medianMs = at(0.5);
  // "1% low" = the worst 1% of frame times, expressed as the fps that implies.
  const p99Ms = at(0.99);
  const worstMs = sorted[sorted.length - 1];
  return {
    frames: sorted.length,
    medianFps: +(1000 / medianMs).toFixed(1),
    onePercentLowFps: +(1000 / p99Ms).toFixed(1),
    worstFrameMs: +worstMs.toFixed(1),
    medianFrameMs: +medianMs.toFixed(2),
  };
};

/* ---------- bundle size from the built output ---------- */
function bundleSize() {
  const client = 'dist/client';
  if (!existsSync(client)) return { error: 'dist/client not found; run npm run build first' };
  let js = 0, css = 0, total = 0, files = 0;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      const size = statSync(p).size;
      total += size; files++;
      if (e.name.endsWith('.js')) js += size;
      if (e.name.endsWith('.css')) css += size;
    }
  };
  walk(client);
  return { jsBytes: js, cssBytes: css, totalBytes: total, files };
}

const kib = (b) => (b / 1024).toFixed(1) + ' KiB';

/* ---------- one configuration ---------- */
async function measure(viewport, cpuThrottle) {
  return session({ width: viewport.w, height: viewport.h }, async (ctx) => {
    const { send, evaluate, errors } = ctx;
    await send('Emulation.setDeviceMetricsOverride', {
      width: viewport.w, height: viewport.h,
      deviceScaleFactor: 1, mobile: viewport.mobile,
    });
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    if (cpuThrottle > 1) await send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });

    const t0 = Date.now();
    const booted = await openScene(ctx, URL_);
    if (!booted) return { viewport: viewport.name, cpuThrottle, error: 'scene did not boot' };

    // First interactive frame: the scene handle exists and a frame has been
    // presented. performance.now() is relative to navigation start.
    const startup = await evaluate(`(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      return {
        firstInteractiveMs: performance.now(),
        fcpMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0,
        domContentLoadedMs: nav ? nav.domContentLoadedEventEnd : 0,
      };
    })()`);

    await evaluate(RECORDER);
    // Sit down so the measurement covers the interactive scene, not the intro.
    await evaluate(`document.querySelector('.seat-pin')?.click()`);
    for (let i = 0; i < 40; i++) {
      if ((await evaluate('window.__nightbowl.selfCheck().phase')) === 'seated') break;
      await sleep(250);
    }

    await evaluate('window.__fps.on = true; window.__fps.last = 0; window.__fps.deltas.length = 0;');
    await sleep(FPS_SECONDS * 1000);
    await evaluate('window.__fps.on = false');
    const deltas = await evaluate('window.__fps.deltas');

    const sc = await evaluate('window.__nightbowl.selfCheck()');
    const scene = await evaluate(`(() => {
      const t = performance.getEntriesByType('resource')
        .filter((e) => { try { return new URL(e.name).origin === location.origin; } catch { return false; } });
      return {
        transferredBytes: t.reduce((s, e) => s + (e.transferSize || 0), 0),
        requests: t.length,
        heapUsed: performance.memory ? performance.memory.usedJSHeapSize : null,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    })()`);

    // renderer.info.memory counts objects, not bytes. Texture *bytes* have no
    // WebGL query, so the count is reported and the bytes are not guessed.
    const mem = { textures: sc.textures ?? null, geometries: sc.geometries ?? null };

    return {
      viewport: viewport.name, width: viewport.w, height: viewport.h, cpuThrottle,
      startup, fps: stats(deltas), scene,
      drawCalls: sc.renderCalls, triangles: sc.triangles,
      textures: mem ? mem.textures : null,
      geometries: mem ? mem.geometries : null,
      errors: errors.slice(0, 3),
    };
  });
}

/* ---------- leak run ---------- */
async function leakRun(minutes) {
  if (!minutes) return { skipped: 'leak run disabled (--leak-minutes 0)' };
  return session({ width: 1440, height: 900, flags: ['--enable-precise-memory-info'] }, async (ctx) => {
    const { send, evaluate } = ctx;
    if (!await openScene(ctx, URL_)) return { error: 'scene did not boot' };
    await evaluate(`document.querySelector('.seat-pin')?.click()`);
    await sleep(3000);

    const sample = async () => {
      // Force collection over the protocol: without it the number is allocation
      // noise rather than retention, and a leak verdict would be meaningless.
      await send('HeapProfiler.enable');
      await send('HeapProfiler.collectGarbage');
      await sleep(600);
      return evaluate('performance.memory ? performance.memory.usedJSHeapSize : null');
    };

    const start = await sample();
    if (start == null) {
      return { error: 'performance.memory is unavailable in this browser build, so heap growth could not be measured' };
    }
    let peak = start;
    const marks = [];
    for (let i = 1; i <= minutes; i++) {
      await sleep(60000);
      const now = await evaluate('performance.memory.usedJSHeapSize');
      peak = Math.max(peak, now);
      marks.push({ minute: i, heapUsed: now });
    }
    const end = await sample();
    return {
      minutes, startHeapPostGc: start, endHeapPostGc: end, peakHeap: peak,
      growthPercent: +(((end - start) / start) * 100).toFixed(1),
      marks,
    };
  });
}

/* ---------- run ---------- */
console.log(`\nnightbowl performance baseline → ${URL_}`);
console.log(`frame window ${FPS_SECONDS}s per configuration, leak run ${LEAK_MINUTES} min\n`);

const renderer = await session({ width: 800, height: 600 }, async (ctx) => {
  await openScene(ctx, URL_);
  return ctx.evaluate(`(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return 'no webgl';
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'renderer string unavailable';
  })()`);
});
console.log(`renderer: ${renderer}\n`);

const results = [];
for (const v of VIEWPORTS) {
  for (const t of THROTTLES) {
    process.stdout.write(`  ${v.name} @ ${t}x CPU ... `);
    const r = await measure(v, t);
    results.push(r);
    if (r.error) console.log(`ERROR: ${r.error}`);
    else console.log(`median ${r.fps?.medianFps} fps, 1% low ${r.fps?.onePercentLowFps} fps, worst frame ${r.fps?.worstFrameMs} ms`);
  }
}

console.log('\n  leak run ...');
const leak = await leakRun(LEAK_MINUTES);
console.log(`  ${JSON.stringify(leak.growthPercent ?? leak.error ?? leak.skipped)}\n`);

const bundle = bundleSize();

/* ---------- write the report ---------- */
const software = softwareRenderer();
const row = (r) => r.error
  ? `| ${r.viewport} | ${r.cpuThrottle}x | not measured | | | | | | ${r.error} |`
  : `| ${r.viewport} | ${r.cpuThrottle}x | ${r.fps?.medianFps ?? '-'} | ${r.fps?.onePercentLowFps ?? '-'} | ${r.fps?.worstFrameMs ?? '-'} | ${Math.round(r.startup.firstInteractiveMs)} | ${r.drawCalls} | ${r.triangles} | ${r.scene.overflowX} |`;

const md = `# Performance baseline

Every number here was measured by \`scripts/perf-baseline.mjs\` against the
production build. Nothing is estimated. Where something could not be measured,
it says so and why.

- measured: ${new Date().toISOString().slice(0, 10)}
- renderer: \`${renderer}\`
- rasteriser: ${software ? '**software (swiftshader)** — frame rates are not representative of any real device' : 'hardware GPU'}
- frame sampling window: ${FPS_SECONDS}s per configuration
- command: \`node scripts/perf-baseline.mjs --url <production build>\`

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
${results.map(row).join('\n')}

## Memory

${leak.error ? `Heap growth: **not measurable** — ${leak.error}`
    : leak.skipped ? `Heap growth: **not measured** — ${leak.skipped}`
      : `Measured over ${leak.minutes} minutes at 1440x900, seated, with garbage collection forced over the
DevTools protocol before the first and last sample so the figure reflects
retention rather than allocation noise.

| measurement | value |
|---|---|
| heap after GC at start | ${kib(leak.startHeapPostGc)} |
| heap after GC at end | ${kib(leak.endHeapPostGc)} |
| peak heap during the run | ${kib(leak.peakHeap)} |
| growth over ${leak.minutes} min | **${leak.growthPercent}%** |

Per-minute samples (not post-GC, so these include ordinary allocation churn):

| minute | heap |
|---|---|
${leak.marks.map((m) => `| ${m.minute} | ${kib(m.heapUsed)} |`).join('\n')}`}

## Payload

${bundle.error ? `**not measurable** — ${bundle.error}` : `Built output in \`dist/client\`, uncompressed on disk:

| measurement | value |
|---|---|
| JavaScript | ${kib(bundle.jsBytes)} |
| CSS | ${kib(bundle.cssBytes)} |
| all client files | ${kib(bundle.totalBytes)} |
| file count | ${bundle.files} |

Over the wire, first-party only, cache disabled (the server applies gzip):

| viewport | transferred | requests |
|---|---|---|
${results.filter((r) => !r.error && r.cpuThrottle === 1).map((r) => `| ${r.viewport} | ${kib(r.scene.transferredBytes)} | ${r.scene.requests} |`).join('\n')}`}

## Texture memory

**Count only, bytes not measurable.** WebGL exposes no query for texture memory,
and \`renderer.info.memory\` reports the number of allocated objects rather than
their size. Inventing a megabyte figure from texture dimensions would be a guess
presented as a measurement, so it is left out.

| measurement | value |
|---|---|
| textures allocated | ${results.find((r) => !r.error)?.textures ?? 'not measured'} |
| geometries allocated | ${results.find((r) => !r.error)?.geometries ?? 'not measured'} |

## What these numbers are not

${software
    ? `This run used the software rasteriser, so the frame rates describe a CPU
rendering pipeline and not any real device. They are useful only as a
regression signal against other software-rendered runs.`
    : `The GPU here is a desktop part. CPU throttling slows the main thread but
leaves the GPU untouched, so the 4x and 6x rows describe a fast GPU behind a
slow CPU, not a phone. **A real mobile frame rate cannot be obtained from this
harness** and needs a physical device.`}
`;

writeFileSync(OUT, md);
console.log(`wrote ${OUT}`);
if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ renderer, software, results, leak, bundle }, null, 2));
  console.log(`wrote ${JSON_OUT}`);
}
console.log('');
