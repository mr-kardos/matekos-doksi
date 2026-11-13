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
  await page.fill('#findIn', 'Fejlecproba');
  await page.waitForFunction(() => /ebből 1/.test(document.querySelector('#findInfo').textContent), null, { timeout: 3000 }).catch(() => {});
  assert.match(await page.textContent('#findInfo'), /1 találat \(ebből 1/);
  await page.press('#findIn', 'Enter'); await page.waitForTimeout(400);
  assert.match(await page.textContent('#findInfo'), /élőfejben/);
  noErrors('features');
});

test('alignment menu, "more" menu, table of contents, panel switch', async () => {
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const ed = window.mdoksi.editor; ed.commands.setTextSelection(3); ed.view.focus(); });
  await click('#bAlign'); await page.waitForTimeout(150);
  await click('#popAlign [data-align="center"]'); await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.querySelector('#bAlign').dataset.al), 'center', 'the button shows the alignment in effect');
  await click('[data-pop="popMore"]'); await page.waitForTimeout(150);
  assert.ok(await page.evaluate(() => document.querySelectorAll('#popMore .cico svg').length >= 4), 'more menu with icons');
  await click('#popMore [data-more="toc"]'); await page.waitForTimeout(150);
  assert.ok(await visible('#popToc'));
  await page.evaluate(() => window.mdoksi.editor.commands.setTextSelection(1));
  await click('#tocAdd'); await page.waitForTimeout(1500);
  const toc = () => page.evaluate(() => { const out = []; window.mdoksi.editor.state.doc.forEach(n => { if (n.attrs && n.attrs.toc) out.push(n.attrs.indentLeft); }); return out; });
  const lines = await toc();
  assert.ok(lines.length >= 2, 'table of contents inserted'); assert.ok(lines.every(v => !v), 'no indent by default');
  await click('[data-pop="popMore"]'); await click('#popMore [data-more="toc"]'); await page.waitForTimeout(150);
  await page.check('#tocIndent'); await page.waitForTimeout(300);
  assert.ok((await toc()).some(v => v > 0), 'indent by level applied');
  await page.keyboard.press('Escape');
  await click('#navToggle'); await page.waitForTimeout(200);
  assert.equal(await page.textContent('#navLabel'), 'Címsorok'); assert.ok(await visible('#hlist'));
  await click('#navToggle'); await page.waitForTimeout(200);
  assert.equal(await page.textContent('#navLabel'), 'Oldalak');
  noErrors('menus and table of contents');
});

test('two pages side by side at a small zoom; a click goes back to editing there', async () => {
  await page.evaluate(() => { const ed = window.mdoksi.editor; const j = ed.getJSON(); ed.commands.setContent({ type: 'doc', content: [...j.content, ...j.content, ...j.content] }); });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.mdoksi.setZoomAt(40)); await page.waitForTimeout(1500);
  assert.ok(await page.evaluate(() => document.querySelector('#ws').classList.contains('spreadmode')), 'two-page view');
  assert.equal(await page.evaluate(() => document.querySelectorAll('#spread .spage[data-i]').length), await page.evaluate(() => window.mdoksi.pages));
  const box = await (await page.$('#spread .spage[data-i="1"]')).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3); await page.waitForTimeout(800);
  assert.ok(!(await page.evaluate(() => document.querySelector('#ws').classList.contains('spreadmode'))), 'one page in a row again');
  noErrors('two-page view');
});

test('text never runs into a freely placed picture (with and without captions)', async () => {
  const setA = a => page.evaluate(a => { const ed = window.mdoksi.editor; let at = null; ed.state.doc.descendants((n, pos) => { if (at == null && n.type.name === 'image') at = { pos, n }; }); ed.view.dispatch(ed.state.tr.setNodeMarkup(at.pos, undefined, { ...at.n.attrs, ...a })); }, a);
  const overlaps = () => page.evaluate(() => {
    const D = window.mdoksi.editor.view.dom, img = D.querySelector('.imgw.pinned'), r = img.getBoundingClientRect(), k = D.getBoundingClientRect().width / D.offsetWidth;
    const ct = img.querySelector('.icap.top:not([hidden])'), cb = img.querySelector('.icap.bot:not([hidden])');
    const box = { l: r.left, r: r.right, t: ct ? ct.getBoundingClientRect().top : r.top, b: cb ? cb.getBoundingClientRect().bottom : r.bottom };
    const tw = document.createTreeWalker(D, NodeFilter.SHOW_TEXT, { acceptNode: t => t.parentElement.closest('.imgw,.pin-sp,.lm') ? 2 : 1 }), rg = document.createRange(), out = [];
    for (let t = tw.nextNode(); t; t = tw.nextNode()) {
      const lh = parseFloat(getComputedStyle(t.parentElement.closest('p,h1,h2,h3') || t.parentElement).lineHeight) * k;
      for (let i = 0; i < t.data.length; i++) {
        if (!t.data[i].trim()) continue;
        rg.setStart(t, i); rg.setEnd(t, i + 1); const q = rg.getBoundingClientRect(); if (!q.width) continue;
        const m = (q.top + q.bottom) / 2, h = Math.min(q.height, lh || q.height) / 2;
        if (Math.min(q.right, box.r) - Math.max(q.left, box.l) > 0.5 && Math.min(m + h, box.b) - Math.max(m - h, box.t) > 0.5) { out.push(t.data.slice(i, i + 12)); break; }
      }
    }
    return out;
  });
  await page.evaluate(() => window.mdoksi.setZoomAt(100)); await page.waitForTimeout(800);
  for (const a of [{ px: 0, py: -24 }, { px: 470, py: 12, capTop: 'Felső felirat', capBot: 'Forrás' }, { px: 470, py: 16 }, { px: 0, py: 30, capTop: '', capBot: 'Forrás: saját ábra' }]) {
    await setA(a); await page.waitForTimeout(1800);
    assert.deepEqual(await overlaps(), [], JSON.stringify(a));
  }
  noErrors('text wrap');
});

test('narrow window: every top-bar button stays on screen', async () => {
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 600, height: 760 }); await page.waitForTimeout(400);
  const off = await page.evaluate(() => [...document.querySelectorAll('.bar1 button')].filter(x => x.offsetParent).filter(x => { const r = x.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1; }).length);
  assert.equal(off, 0);
  noErrors('narrow window');
});
