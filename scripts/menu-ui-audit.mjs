/* Regressions for #88–#93: semantic resize, closed-dialog access, race safety,
   descendant text bounds, reading/control separation and real preview hits. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { session, openScene, sleep } from './lib/chrome.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const url = arg('--url', 'http://localhost:4321');
const out = arg('--out', '');
if (out) mkdirSync(out, { recursive: true });
const screenshot = async (ctx, name) => {
  if (!out) return;
  await ctx.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const r = await ctx.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(out, `${name}.png`), Buffer.from(r.result.data, 'base64'));
};
const size = async (ctx, width, height) => {
  await ctx.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 860 });
  // Media-query change events are delivered with rendering, not after a fixed
  // 150ms deadline. A software-rendered frame can take longer than that.
  await ctx.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
};
const key = async (ctx, name, code, text = '', modifiers = 0) => {
  await ctx.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: code, ...(text ? { text, unmodifiedText: text } : {}), modifiers });
  await ctx.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code, modifiers });
};
async function closedAccess(ctx) {
  assert.equal(await ctx.evaluate("document.getElementById('book').inert"), true);
  for (let i = 0; i < 25; i++) {
    await key(ctx, 'Tab', 9);
    assert.equal(await ctx.evaluate("!!document.activeElement.closest('#book')"), false, 'native Tab never enters a closed book');
  }
  const ax = (await ctx.send('Accessibility.getFullAXTree')).result.nodes;
  const label = await ctx.evaluate("document.getElementById('book').getAttribute('aria-label')");
  assert.equal(ax.some((n) => !n.ignored && n.role?.value === 'dialog' && n.name?.value === label), false, 'closed dialog absent from accessibility tree');
}
const content = async (ctx) => ctx.evaluate(`(() => ({
  text:[...document.querySelectorAll('.book-inner > .page')].filter(p=>getComputedStyle(p).display!=='none').map(p=>p.textContent).join('').replace(/\\s/g,''),
  tab:document.querySelector('#tabs .active').dataset.tab,
  control:document.querySelector('#pageRight .pageflip-hint')?.textContent
}))()`);

await session({ flags: ['--force-prefers-reduced-motion'] }, async (ctx) => {
  await size(ctx, 1366, 768);
  assert.ok(await openScene(ctx, url));
  await sleep(750);
  await closedAccess(ctx);
  await ctx.evaluate("document.querySelector('.topbar [data-open=menu]').click()");
  await sleep(300);
  for (const section of ['menu', 'guide', 'log', 'bill']) {
    for (let page = 0; page < (section === 'menu' ? 2 : 1); page++) {
      await size(ctx, 1366, 768);
      await ctx.evaluate(`document.querySelector('#tabs [data-tab=${section}]').click()`);
      if (page) await ctx.evaluate("document.querySelector('.pageflip-hint').click()");
      const before = await content(ctx);
      await size(ctx, 390, 844);
      assert.deepEqual(await content(ctx), before, `${section}/${page}: desktop -> phone retains section and page content`);
      if (section === 'menu' && !page) await screenshot(ctx, 'resize-mobile-content');
      await size(ctx, 1366, 768);
      assert.deepEqual(await content(ctx), before, `${section}/${page}: phone -> desktop restores both pages`);
      if (section === 'menu' && !page) await screenshot(ctx, 'resize-desktop-content');
    }
  }
  console.log('PASS breakpoint changes retain every section and both Menu spreads');
  await size(ctx, 1440, 900);
  for (const section of ['menu', 'guide', 'log', 'bill']) {
    await ctx.evaluate(`document.querySelector('#tabs [data-tab=${section}]').click()`);
    for (let page = 0; page < (section === 'menu' ? 2 : 1); page++) {
      if (page) await ctx.evaluate("document.querySelector('.pageflip-hint').click()");
      assert.ok(await ctx.evaluate("[...document.querySelectorAll('.book-inner > .page')].every(p=>p.scrollHeight<=p.clientHeight+1)"), `${section}/${page}: desktop spread still fits without scrolling`);
    }
  }
  await size(ctx, 1366, 768);
  await ctx.evaluate("document.getElementById('bookClose').click(); document.querySelector('.topbar [data-open=menu]').focus(); document.querySelector('.topbar [data-open=menu]').click()");
  await sleep(300);
  await size(ctx, 390, 844);
  await ctx.evaluate("document.getElementById('bookClose').click()");
  assert.ok(await ctx.evaluate("document.activeElement===document.querySelector('.menu-toggle')"), 'resize then close restores focus to the visible phone opener');
  await ctx.evaluate("document.querySelector('.menu-toggle').click()");
  await sleep(300);
  for (const [width, height] of [[280, 640], [320, 568], [390, 844], [844, 390]]) {
    await size(ctx, width, height);
    for (const section of ['menu', 'bill']) {
      await ctx.evaluate(`document.querySelector('#tabs [data-tab=${section}]').click()`);
      for (let page = 0; page < (section === 'menu' ? 2 : 1); page++) {
        if (page) await ctx.evaluate("document.querySelector('.pageflip-hint').click()");
        const clipping = await ctx.evaluate(`(() => {
          const p=document.getElementById('pageRight'), r=p.getBoundingClientRect(), css=getComputedStyle(p);
          const left=r.left+parseFloat(css.paddingLeft),right=r.left+p.clientWidth-parseFloat(css.paddingRight);
          return [...p.querySelectorAll('.name,.tag,.bill a')].map(e=>({text:e.textContent,rect:e.getBoundingClientRect().toJSON()}))
            .filter(e=>e.rect.left<left-1 || e.rect.right>right+1);
        })()`);
        assert.deepEqual(clipping, [], `${width}px ${section}/${page}: text bounds fit visible content`);
        for (const fraction of [0, 0.5, 1]) {
          await ctx.evaluate(`document.getElementById('pageRight').scrollTop=(document.getElementById('pageRight').scrollHeight-document.getElementById('pageRight').clientHeight)*${fraction}`);
          const overlaps = await ctx.evaluate(`(() => {
            const page=document.getElementById('pageRight'),control=page.querySelector('.pageflip-hint');if(!control)return[];
            const b=control.getBoundingClientRect(),walk=document.createTreeWalker(page,NodeFilter.SHOW_TEXT),hits=[];
            while(walk.nextNode()){
              const n=walk.currentNode;if(!n.textContent.trim()||control.contains(n))continue;
              const range=document.createRange();range.selectNodeContents(n);
              if([...range.getClientRects()].some(r=>r.left<b.right && r.right>b.left && r.top<b.bottom && r.bottom>b.top))hits.push(n.textContent.trim());
            }return hits;
          })()`);
          assert.deepEqual(overlaps, [], `${width}px ${section}/${page}: page control never covers reading text`);
        }
        if (width === 280 || width === 390) await screenshot(ctx, `${width}-${section}-${page}-bottom`);
      }
    }
  }
  console.log('PASS narrow descendant text fits; page controls never overlap reading text');
  await ctx.evaluate("document.getElementById('bookClose').click()");
  await closedAccess(ctx);
  assert.deepEqual(ctx.errors, []);
  console.log('PASS closed book excluded from native Tab and accessibility tree before/after use');
});

await session({}, async (ctx) => {
  await size(ctx, 1366, 768);
  assert.ok(await openScene(ctx, url));
  await sleep(750);
  for (const delay of [0, 60, 180, 250]) {
    await ctx.evaluate("document.querySelector('.topbar [data-open=menu]').focus()");
    await key(ctx, 'Enter', 13, '\r');
    await sleep(delay);
    await key(ctx, 'Escape', 27);
    await sleep(1450);
    assert.ok(await ctx.evaluate(`!document.getElementById('book').classList.contains('open')
      && !document.getElementById('book').classList.contains('flipped')
      && document.getElementById('book').inert
      && document.activeElement===document.querySelector('.topbar [data-open=menu]')`), `Escape at ${delay}ms leaves closed state and opener focus`);
  }
  await screenshot(ctx, 'quick-close-focus-restored');
  assert.deepEqual(ctx.errors, []);
  console.log('PASS native Enter/Escape races at 0/60/180/250ms cancel opening callbacks');
});

await session({ flags: ['--force-prefers-reduced-motion'] }, async (ctx) => {
  for (const [width, height] of [[280, 640], [320, 568], [390, 844], [844, 390]]) {
    await size(ctx, width, height);
    assert.ok(await openScene(ctx, url, '?nbtest=1&preview=menu'));
    await sleep(800);
    for (const section of ['menu', 'guide', 'log', 'bill']) {
      const point = await ctx.evaluate(`(() => {const b=document.querySelector('#tabs [data-tab=${section}]'),r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,clear:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b}})()`);
      assert.ok(point.clear, `${width}px preview ${section}: real centre hit reaches tab`);
      await ctx.send('Input.dispatchMouseEvent', { type:'mousePressed', x:point.x, y:point.y, button:'left', clickCount:1 });
      await ctx.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:point.x, y:point.y, button:'left', clickCount:1 });
      assert.equal(await ctx.evaluate("document.querySelector('#tabs .active').dataset.tab"), section);
    }
    await screenshot(ctx, `${width}-preview-tabs`);
    const close = await ctx.evaluate(`(() => {const r=document.getElementById('bookClose').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await ctx.send('Input.dispatchMouseEvent', { type:'mousePressed', ...close, button:'left', clickCount:1 });
    await ctx.send('Input.dispatchMouseEvent', { type:'mouseReleased', ...close, button:'left', clickCount:1 });
    assert.ok(await ctx.evaluate(`!document.getElementById('book').classList.contains('open') && (()=>{const b=document.querySelector('.menu-toggle'),r=b.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b})()`), 'preview can close and reopen through unobstructed Open menu');
    assert.ok(await ctx.evaluate(`(()=>{const a=document.querySelector('#previewBanner a'),r=a.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===a})()`), 'Back to admin remains unobstructed');
  }
  assert.deepEqual(ctx.errors, []);
  console.log('PASS real preview-tab clicks, close/reopen and Back to admin at all phone sizes');
});
console.log('PASS menu UI regressions #88–#93');
