/* Capture the permanent-night navigation on desktop and phone localhost. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { session, openScene, sleep } from './lib/chrome.mjs';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const url = arg('--url', 'http://localhost:4321');
const out = arg('--out', '/tmp/nightbowl-header-review');
mkdirSync(out, { recursive: true });

async function capture(width, height, name, openMenu = false) {
  await session({ width, height }, async (ctx) => {
    if (!await openScene(ctx, url)) throw new Error('Scene did not boot');
    await sleep(700);
    const state = await ctx.evaluate(`(() => ({
      wordmark: !!document.querySelector('.wordmark'),
      theme: !!document.getElementById('themeBtn'),
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      desktopItems: [...document.querySelectorAll('.nav [data-open]')].map((item) => item.textContent.trim()),
      mobileVisible: getComputedStyle(document.querySelector('.menu-toggle')).display !== 'none'
    }))()`);
    if (state.wordmark || state.theme || state.colorScheme !== 'dark'
      || state.desktopItems.length !== 4 || state.mobileVisible !== (width <= 860)) {
      throw new Error(`Unexpected header state: ${JSON.stringify(state)}`);
    }
    if (openMenu) {
      await ctx.evaluate(`document.querySelector('.menu-toggle').click()`);
      await sleep(250);
    }
    const reply = await ctx.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(out, `${name}.png`), Buffer.from(reply.result.data, 'base64'));
  });
}

await capture(1440, 900, '01-desktop-clean-navigation');
await capture(390, 844, '02-phone-clean-navigation');
await capture(390, 844, '03-phone-menu-navigation', true);
console.log(out);
