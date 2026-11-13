// The whole app in a real (headless) Chrome: it starts without errors, every button and popup of the ribbon
// works, and a few features are tried end to end. Run with:  npm run test:app
// (it builds the app first; the first time:  npx playwright install chromium   – or set CHROME_PATH to a Chrome)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { preview } from 'vite';
import { chromium } from 'playwright';

let server, browser, page, url;
const errors = [];
before(async () => {
  server = await preview({ preview: { port: 0, strictPort: false, open: false }, logLevel: 'silent' });
  url = server.resolvedUrls.local[0];
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => errors.push(String(e.stack || e)));
});
after(async () => { await browser?.close(); await new Promise(r => server?.httpServer.close(r)); });
const noErrors = what => assert.deepEqual(errors.splice(0), [], `errors after: ${what}`);
const click = sel => page.evaluate(s => document.querySelector(s).click(), sel);
const visible = sel => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.hidden && e.getClientRects().length > 0; }, sel);

test('starts without errors and opens the sample document', async () => {
  await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(1500);
  noErrors('start');
  assert.ok(await visible('#homeNew'), 'home screen');
  await page.click('#homeResume'); await page.waitForTimeout(2500);
  noErrors('opening the sample');
  assert.ok(await page.evaluate(() => window.mdoksi.pages >= 1));
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('[data-icon]')].filter(b => !b.querySelector('svg')).length), 0, 'every button has its icon');
});

test('every ribbon command and popup works', async () => {
  const cmds = await page.evaluate(() => [...new Set([...document.querySelectorAll('.ribbon [data-cmd]')].map(b => b.dataset.cmd))]);
  for (const c of cmds) {
    if (c === 'image') continue;                       // opens the system's file dialog
    await page.mouse.click(700, 420);
    await page.evaluate(c => document.querySelector(`[data-cmd="${c}"]`).click(), c); await page.waitForTimeout(150);
    await page.keyboard.press('Escape');
    noErrors('command ' + c);
  }
  const pops = await page.evaluate(() => [...new Set([...document.querySelectorAll('.ribbon [data-pop], .bar1 [data-pop]')].map(b => b.dataset.pop))]);
  for (const id of pops) {
    await page.mouse.click(700, 420);
    await page.evaluate(id => document.querySelector(`[data-pop="${id}"]`).click(), id); await page.waitForTimeout(150);
    assert.ok(await visible('#' + id), 'popup ' + id);
    await page.keyboard.press('Escape'); await page.evaluate(() => document.body.click());
    noErrors('popup ' + id);
  }
});

test('menus and the template panel', async () => {
  await click('#bFile'); await page.waitForTimeout(150);
  assert.ok(await page.evaluate(() => document.querySelectorAll('#popFile .cico svg').length >= 5), 'File menu icons');
  await page.keyboard.press('Escape'); await page.evaluate(() => document.body.click());
  await page.mouse.click(700, 600, { button: 'right' }); await page.waitForTimeout(200);
  assert.ok(await visible('#ctxMenu'), 'right-click menu');
  assert.ok(await page.evaluate(() => document.querySelectorAll('#ctxMenu .cico svg').length > 3), 'right-click menu icons');
  await page.keyboard.press('Escape'); await page.evaluate(() => document.body.click());
  assert.ok(await page.evaluate(() => !!document.querySelector('[data-style="cap"]')), 'caption style card');
  noErrors('menus');
});

test('non-breaking space, link, find in the header', async () => {
  await page.evaluate(() => { const ed = window.mdoksi.editor; ed.commands.setTextSelection(3); ed.view.focus(); });
  await page.keyboard.press('Control+Shift+Space');
  assert.ok(await page.evaluate(() => window.mdoksi.editor.state.doc.textContent.includes('\u00a0')), 'non-breaking space');
  await page.evaluate(() => { const ed = window.mdoksi.editor; ed.commands.setTextSelection({ from: 3, to: 8 }); });
  await page.keyboard.press('Control+k'); await page.waitForTimeout(150);
  assert.ok(await visible('#popLink'));
  await page.fill('#linkIn', 'example.com'); await page.press('#linkIn', 'Enter');
  assert.equal(await page.evaluate(() => window.mdoksi.editor.view.dom.querySelector('a[href]')?.getAttribute('href')), 'https://example.com');
  // a word in the header
  await page.evaluate(() => window.mdoksi.editHF('header', 'odd')); await page.waitForTimeout(300);
  await page.keyboard.type(' Fejlecproba'); await page.evaluate(() => window.mdoksi.closeHF()); await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('[data-pop="popFind"]').click());
  await page.fill('#findIn', 'Fejlecproba'); await page.waitForTimeout(400);
  assert.match(await page.textContent('#findInfo'), /1 találat \(ebből 1/);
  await page.press('#findIn', 'Enter'); await page.waitForTimeout(400);
  assert.match(await page.textContent('#findInfo'), /élőfejben/);
  noErrors('features');
});

test('narrow window: every top-bar button stays on screen', async () => {
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 600, height: 760 }); await page.waitForTimeout(400);
  const off = await page.evaluate(() => [...document.querySelectorAll('.bar1 button')].filter(x => x.offsetParent).filter(x => { const r = x.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1; }).length);
  assert.equal(off, 0);
  noErrors('narrow window');
});
