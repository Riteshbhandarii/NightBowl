import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { session, openScene, sleep } from './lib/chrome.mjs';

const arg=(name,fallback)=>{const index=process.argv.indexOf(name);return index<0?fallback:process.argv[index+1]};
const url=arg('--url','http://127.0.0.1:4321');
const out=arg('--out','/tmp/nightbowl-scene-motion');
mkdirSync(out,{recursive:true});
async function wait(ctx,expression,label,attempts=180) {
  for(let i=0;i<attempts;i++) {if(await ctx.evaluate(expression))return;await sleep(100)}
  throw new Error(`Timed out: ${label}`);
}
const click=ctx=>ctx.evaluate("document.getElementById('sceneMotionControl').click()");
const check=ctx=>ctx.evaluate('window.__nightbowl.selfCheck()');
const pose=ctx=>ctx.evaluate(`(() => {const api=window.__nightbowl,s=api.selfCheck();return {time:s.sceneTime,visitor:s.visitorOrder,service:s.service,turnover:s.turnover,diners:s.dinerActions,walkers:[0,1].map(i=>api.auditLocomotion('walker',i)),cook:api.auditLocomotion('cook'),diner:api.auditLocomotion('diner',0)}})()`);
async function photograph(ctx,name) {
  const response=await ctx.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  writeFileSync(join(out,`${name}.png`),Buffer.from(response.result.data,'base64'));
  return response.result.data;
}
async function frozen(ctx,label) {
  // Loading and control affordances may finish their CSS transitions without
  // changing the scene. Compare only after the loading fade has settled.
  await sleep(1000);
  const before=await pose(ctx);
  const imageBefore=await photograph(ctx,`${label}-before`);
  await sleep(1600);
  assert.deepEqual(await pose(ctx),before,`${label}: clocks, actors and props stay frozen`);
  const imageAfter=await photograph(ctx,`${label}-after`);
  assert.ok(imageAfter===imageBefore,`${label}: rendered frame is static (see before/after screenshots)`);
  return before;
}

await session({width:1400,height:900},async ctx=>{
  assert.ok(await openScene(ctx,url));
  await ctx.evaluate("document.getElementById('sceneMotionControl').focus()");
  await ctx.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await ctx.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  assert.equal((await check(ctx)).motion.manualPaused,true);
  assert.equal(await ctx.evaluate("localStorage.getItem('nightbowl:scene-motion')"),'paused');
  await frozen(ctx,'street-pause');
  await ctx.evaluate("document.querySelector('.seat-pin').click()");
  assert.equal((await check(ctx)).phase,'seated','static mode can take a seat');
  await ctx.evaluate("document.querySelector('[data-visitor-dish=house]').click()");
  assert.equal((await check(ctx)).visitorOrder.status,'done','paused ordering is served without an animation');
  assert.equal((await check(ctx)).visitorOrder.fill,1,'paused ordering does not claim the bowl was eaten');
  await ctx.send('Page.reload');
  await wait(ctx,'!!window.__nightbowl','saved preference reload');
  assert.equal((await check(ctx)).motion.manualPaused,true,'paused preference survives reload');
  assert.equal((await check(ctx)).phase,'seated','saved static mode skips entrance motion');
  await click(ctx);
  assert.equal((await check(ctx)).motion.paused,false);
  await ctx.evaluate('window.__nightbowl.testTurnover(0)');
  await wait(ctx,"window.__nightbowl.selfCheck().turnover?.phase==='leave'",'departure');
  await click(ctx);
  const before=await frozen(ctx,'departure-pause');
  await click(ctx);
  await sleep(450);
  const after=await check(ctx);
  assert.equal(after.turnover?.phase,'leave','resuming does not skip departure');
  assert.ok(after.sceneTime-before.time<0.8,'paused wall time is excluded');
  assert.notEqual(after.turnover.x,before.turnover.x,'departure resumes');
  assert.equal(await ctx.evaluate("localStorage.getItem('nightbowl:scene-motion')"),'playing');
  assert.deepEqual(ctx.errors,[]);
});

await session({width:1400,height:900},async ctx=>{
  assert.ok(await openScene(ctx,url));
  await click(ctx);
  await ctx.evaluate("document.querySelector('.seat-pin').click()");
  await click(ctx);
  await ctx.evaluate("document.querySelector('[data-visitor-dish=house]').click()");
  await wait(ctx,'!!window.__nightbowl.selfCheck().visitorOrder.carrying','visitor bowl carry');
  await click(ctx);
  const before=await frozen(ctx,'serving-pause');
  await ctx.evaluate("document.querySelector('.topbar [data-open=menu]').click()");
  await sleep(300);
  assert.equal(await ctx.evaluate("document.getElementById('book').classList.contains('open')"),true,'portfolio remains usable during pause');
  await ctx.evaluate("document.getElementById('bookClose').click()");
  await click(ctx);
  await sleep(250);
  const after=await check(ctx);
  assert.equal(after.visitorOrder.status,'serving','resume preserves serving phase');
  assert.ok(after.sceneTime-before.time<0.7,'service excludes paused and reading time');
  await wait(ctx,"window.__nightbowl.selfCheck().visitorOrder.status==='eating'",'service completion after resume');
  assert.equal((await check(ctx)).visitorOrder.dish,'house','no duplicate or lost order');
  assert.deepEqual(ctx.errors,[]);
});

await session({width:390,height:844},async ctx=>{
  await ctx.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.ok(await openScene(ctx,url));
  assert.equal((await check(ctx)).motion.systemReduced,true);
  assert.equal(await ctx.evaluate("document.getElementById('sceneMotionControl').disabled"),true,'system preference cannot be overridden accidentally');
  await frozen(ctx,'system-reduced-phone');
  assert.deepEqual(ctx.errors,[]);
});
await session({width:800,height:600,flags:['--disable-webgl']},async ctx=>{
  await ctx.send('Page.navigate',{url});
  await wait(ctx,"document.getElementById('loading')?.classList.contains('failed')",'WebGL fallback');
  assert.equal(await ctx.evaluate("document.getElementById('sceneMotionControl').dataset.state"),'unavailable');
  assert.equal(await ctx.evaluate("document.getElementById('sceneMotionControl').disabled"),true);
  await ctx.evaluate("document.querySelector('.menu-toggle').click()");
  assert.equal(await ctx.evaluate("document.getElementById('book').classList.contains('open')"),true,'fallback content remains accessible');
});
await session({width:390,height:844},async ctx=>{
  await ctx.send('Page.addScriptToEvaluateOnNewDocument',{source:"Storage.prototype.getItem=Storage.prototype.setItem=function(){throw new DOMException('Blocked storage','SecurityError')}"});
  assert.ok(await openScene(ctx,url));
  await click(ctx);
  assert.equal((await check(ctx)).motion.manualPaused,true,'pause works when browser storage is blocked');
  assert.ok(await ctx.evaluate("document.getElementById('sceneMotionControl').title.includes('this visit only')"));
  await photograph(ctx,'blocked-storage-phone');
  assert.deepEqual(ctx.errors,[]);
});
console.log('scene motion: rendered pause, exact pose/clock continuity, ordering, reload, reading, system preference and WebGL fallback passed');
