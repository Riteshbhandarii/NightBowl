import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { session, sleep } from './lib/chrome.mjs';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const base = arg('--url', 'http://127.0.0.1:4321');
const out = arg('--out', '/tmp/nightbowl-content-access');
mkdirSync(out, { recursive:true });
async function wait(ctx, expression, label) {
  for (let i=0; i<120; i++) {
    if (await ctx.evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error(`Timed out: ${label}`);
}
async function click(ctx, selector) {
  const point = await ctx.evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await ctx.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
  await ctx.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}
async function photograph(ctx, name) {
  const response=await ctx.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  writeFileSync(join(out,`${name}.png`),Buffer.from(response.result.data,'base64'));
}

for (const route of ['/menu/','/guide/','/log/','/bill/']) {
  assert.equal((await fetch(new URL(route,base))).status,200,`${route}: ordinary HTML route`);
}
for (const [width,height] of [[1400,900],[390,844],[280,640]]) {
  await session({width,height},async ctx=>{
    await ctx.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    assert.equal(await ctx.evaluate('innerWidth'),width,'test uses the requested viewport, not Chrome window minimum');
    await ctx.send('Emulation.setScriptExecutionDisabled',{value:true});
    await ctx.send('Page.navigate',{url:base});
    await wait(ctx,"!!document.querySelector('.plain-access')",'no-script entrance');
    assert.equal(await ctx.evaluate("getComputedStyle(document.getElementById('loading')).display"),'none','no-script loader is hidden');
    assert.equal(await ctx.evaluate("document.querySelectorAll('.plain-access a[href]').length"),4,'real no-script destinations');
    await photograph(ctx,`no-script-${width}-entrance`);
    await click(ctx,'.plain-access a[href="/menu/"]');
    await wait(ctx,"location.pathname==='/menu/' && !!document.querySelector('.project-list')",'native no-script Menu link');
    assert.ok(await ctx.evaluate("document.body.innerText.includes('TEORIAT Chess Engine')"),'no-script Menu exposes real work');
    await photograph(ctx,`no-script-${width}-menu`);
    for (const [route,heading] of [['/guide/','The Guide'],['/bill/','The Bill'],['/log/','Kitchen Log']]) {
      await click(ctx,`.reading-header a[href="${route}"]`);
      await wait(ctx,`location.pathname===${JSON.stringify(route)} && document.querySelector('h1')?.textContent.trim()===${JSON.stringify(heading)}`,'native reading navigation');
      assert.ok(await ctx.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),`${route}: no overflow at ${width}`);
      if(route==='/bill/') await photograph(ctx,`no-script-${width}-bill`);
    }
    assert.deepEqual(ctx.errors,[]);
  });
}

await session({width:1400,height:900},async ctx=>{
  await ctx.send('Network.enable');
  await ctx.send('Network.setBlockedURLs',{urls:['*/_astro/*.js']});
  await ctx.send('Page.navigate',{url:base});
  await wait(ctx,"document.readyState!=='loading' && !!document.querySelector('.topbar [data-open=menu]') && !!document.getElementById('sectionData')",'parsed HTML menu before scene modules');
  await click(ctx,'.topbar [data-open=menu]');
  await wait(ctx,"document.getElementById('book')?.classList.contains('open') && location.hash==='#menu'",'enhanced early menu');
  assert.equal(await ctx.evaluate('typeof window.__nightbowl'),'undefined','scene modules remain blocked');
  for(const section of ['guide','bill']) {
    await ctx.evaluate(`document.querySelector('#tabs [data-tab=${section}]').click()`);
    await wait(ctx,`location.hash==='#${section}' && document.querySelector('#tabs .active')?.dataset.tab==='${section}'`,'section URL');
  }
  let history=(await ctx.send('Page.getNavigationHistory')).result;
  assert.ok(history.entries.length>=4,'sections create browser history entries');
  await ctx.send('Page.navigateToHistoryEntry',{entryId:history.entries[history.currentIndex-1].id});
  await wait(ctx,"location.hash==='#guide' && document.querySelector('#tabs .active')?.dataset.tab==='guide'",'Back restores Guide');
  await ctx.send('Page.navigateToHistoryEntry',{entryId:history.entries[history.currentIndex].id});
  await wait(ctx,"location.hash==='#bill' && document.querySelector('#tabs .active')?.dataset.tab==='bill'",'Forward restores Bill');
  await ctx.send('Page.reload');
  await wait(ctx,"document.getElementById('book')?.classList.contains('open') && document.querySelector('#tabs .active')?.dataset.tab==='bill'",'reload restores Bill');
  await sleep(300);
  await click(ctx,'#bookClose');
  assert.equal(await ctx.evaluate('location.hash'),'','close restores entrance URL');
  assert.ok(await ctx.evaluate("document.activeElement===document.querySelector('.topbar [data-open=menu]')"),'deep-link close restores a visible opener');
  history=(await ctx.send('Page.getNavigationHistory')).result;
  await ctx.send('Page.navigateToHistoryEntry',{entryId:history.entries[history.currentIndex-1].id});
  await wait(ctx,"document.getElementById('book').classList.contains('open') && location.hash==='#bill'",'Back reopens closed Bill');
  await photograph(ctx,'shareable-bill-with-scene-held');
  await ctx.evaluate("document.getElementById('bookClose').click()");
  assert.equal(await ctx.evaluate(`(() => {const link=document.querySelector('.topbar [data-open=menu]'); const event=new MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true,button:0});link.dispatchEvent(event);return event.defaultPrevented})()`),false,'modifier clicks retain ordinary link behavior');
  assert.deepEqual(ctx.errors,[]);
});
console.log('content access: native no-JavaScript routes, narrow layouts, early enhancement, reload/history and modifier-click checks passed');
