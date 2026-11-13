/* ------------------------------------------------------------------ */
/* Layout: sheets, editor column, zoom                                 */
/* ------------------------------------------------------------------ */
function applyLayout(n) {
  pageCount = n;
  const g = geometry(tpl), dom = editor.view.dom;
  dom.style.left = g.maxL + 'px';
  dom.style.top = g.mt + 'px';
  dom.style.width = g.colW + 'px';
  dom.style.minHeight = Math.max(0, (n - 1) * g.P + g.H - g.mb - g.mt) + 'px';
  // the header/footer being edited is kept open (and highlighted) when the pages are drawn again
  let reopen = null;
  if (hfOpen) {
    const { kind, v } = hfOpen;
    for (const ed of hfEds) tpl[kind][v][ed._cell] = ed.getJSON();
    hfRenderCache();
    reopen = { kind, v, cell: hfEd && hfEd._cell, focus: hfEds.some(e => e.isFocused) };
  }
  const before = pagesEl.firstChild;
  renderSheets(pagesEl, n, tpl, $('#docTitle').value);
  if (reopen && (pagesEl.firstChild !== before || !hfOpen.box.isConnected)) {
    for (const ed of hfEds) ed.destroy();
    hfEds.length = 0; hfOpen = null; hfEd = null;
    editHF(reopen.kind, reopen.v, reopen);
  }
  hfRules();
  const stackW = Math.max(g.sheetX(0), g.sheetX(1)) + g.W;
  stack.style.width = stackW + 'px';
  stack.style.height = (n * g.P - GAP) + 'px';
  applyZoom();
  drawShadeBands($('#shadeLayer'), dom, stack, scale, y => Math.floor(y / g.P));
  updateOverlays();
  thumbsSoon();
  marksSoon();
  pinsSoon();
  drawComments();
  statsSoon();
}
/* ---- freely placed pictures / tables: their place on the page, and the text kept clear of them ---- */
let pinRaf = 0, pinPrev = '', pinRounds = 0, pinInputs = '', docVersion = 0, pinLast = [], pinTurns = 0, pinBurstAt = 0, pinSettleT = 0;
/** The text line at height y (screen coordinates): {pos, top} – the line start in the document. Pinned
 *  elements, tables and the spacers are left out; works also for parts of the document that are not on screen. */
/** The paragraphs and headings of the text (not in tables or free objects) with their boxes, measured once. */
function textBlocks() {
  const out = [];
  for (const b of editor.view.dom.querySelectorAll('p,h1,h2,h3')) { if (b.closest('.pinned,td,th')) continue; out.push({ b, br: b.getBoundingClientRect() }); }
  return out;
}
function lineAtY(y, skipEl, list) {
  const view = editor.view;
  for (const { b, br } of list || textBlocks()) {       // `list`: the boxes measured once for many questions (long documents)
    if (skipEl && skipEl.contains(b)) continue;
    if (br.bottom <= y || !br.height) continue;
    const pt = parseFloat(getComputedStyle(b).paddingTop) || 0;
    if (br.top + pt >= y) { try { return { pos: view.posAtDOM(b, 0), top: br.top + pt }; } catch (e) { return null; } }
    // inside this paragraph: the first character whose line reaches below y
    const tw = document.createTreeWalker(b, NodeFilter.SHOW_TEXT, { acceptNode: t => t.parentElement.closest('.lm,.math,.pin-sp,.pg-sp,.imgw') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });   // a picture's captions are not lines of the text
    const rg = document.createRange();
    while (tw.nextNode()) {
      const t = tw.currentNode; if (!t.data.length) continue;
      // a line "reaches below y" when the lower quarter of its glyph box does: the glyph boxes of a font can be taller than
      // the line pitch, so a box's bottom already lies inside the next line
      const below = q => q.bottom - q.height * 0.25 > y;
      rg.selectNodeContents(t); const tq = rg.getClientRects(); if (!tq.length || !below(tq[tq.length - 1])) continue;
      let lo = 0, hi = t.data.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; rg.setStart(t, mid); rg.setEnd(t, mid + 1); const q = rg.getClientRects(); const cr = q[q.length - 1]; if (cr && below(cr)) hi = mid; else lo = mid + 1; }
      // back to the start of that line
      rg.setStart(t, lo); rg.setEnd(t, lo + 1); const top0 = rg.getBoundingClientRect().top;
      let s0 = lo, tn = t; while (s0 > 0) { rg.setStart(tn, s0 - 1); rg.setEnd(tn, s0); if (Math.abs(rg.getBoundingClientRect().top - top0) > 2) break; s0--; }
      // the line may begin in an earlier text piece (marks, spell-check underlines split the text)
      if (s0 === 0) {
        const back = document.createTreeWalker(b, NodeFilter.SHOW_TEXT, { acceptNode: x => x.parentElement.closest('.lm,.math,.pin-sp,.pg-sp,.imgw') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
        back.currentNode = tn;
        while (back.previousNode()) {
          const pt = back.currentNode; if (!pt.data.length) continue;
          rg.setStart(pt, pt.data.length - 1); rg.setEnd(pt, pt.data.length);
          if (Math.abs(rg.getBoundingClientRect().top - top0) > 2) break;
          tn = pt; s0 = pt.data.length - 1;
          while (s0 > 0) { rg.setStart(tn, s0 - 1); rg.setEnd(tn, s0); if (Math.abs(rg.getBoundingClientRect().top - top0) > 2) break; s0--; }
          if (s0 > 0) break;
        }
      }
      try { return { pos: view.posAtDOM(tn, s0), top: top0 }; } catch (e) { return null; }
    }
    try { return { pos: view.posAtDOM(b, 0), top: br.top + pt }; } catch (e) { return null; }
  }
  return null;
}
function pinsSoon() { if (!pinRaf) pinRaf = requestAnimationFrame(() => { pinRaf = 0; updatePins(); }); }
function updatePins() {
  const dom = editor.view.dom, g = geometry(tpl), er = dom.getBoundingClientRect();
  // 0. pictures wrapped the older way (anchored in the text) become freely placed where they are
  const legacy = [...dom.querySelectorAll('.imgw.wl, .imgw.wr, .imgw.over')].filter(el => el._kv && !el.classList.contains('pinned'));
  if (legacy.length) { for (const el of legacy) el._kv.pinHere(); return; }       // the change brings us back here
  // pictures fixed to a page (0.8.7 – 0.9.4): from now on they move with the paragraph they are in
  const fixed = [...dom.querySelectorAll('.imgw.pinned')].filter(el => el._kv && !el.dataset.rel);
  if (fixed.length) { for (const el of fixed) el._kv.makeRel(); return; }
  const els = [...dom.querySelectorAll('.pinned')];
  // 1. exact place: correct for whatever box the element is measured from
  for (const el of els) {
    const pg = +el.dataset.pg || 0, px = +el.dataset.px || 0, py = +el.dataset.py || 0;
    const wantL = er.left + px * scale;
    let wantT = er.top + (pg * g.P + py) * scale;
    if (el.dataset.rel) {                 // moves with its paragraph; kept inside the text area of that page
      const host = el.parentElement && el.parentElement.closest('p,h1,h2,h3');
      if (host) {
        wantT = host.getBoundingClientRect().top + py * scale;
        const sr1 = stack.getBoundingClientRect(), i = Math.max(0, Math.min(pageCount - 1, Math.floor((host.getBoundingClientRect().top - sr1.top) / scale / g.P)));
        const capT = (+el.dataset.capT || 0) * scale, capB = (+el.dataset.capB || 0) * scale;       // captions above / below a picture
        const cTop = sr1.top + g.contentTop(i) * scale + capT, cBot = sr1.top + g.contentBottom(i) * scale - capB, h = el.getBoundingClientRect().height;
        wantT = Math.min(Math.max(wantT, cTop), Math.max(cTop, cBot - h));
      }
    }
    const r = el.getBoundingClientRect();
    if (Math.abs(r.left - wantL) > 0.5) el.style.left = (parseFloat(el.style.left) || 0) + (wantL - r.left) / scale + 'px';
    if (Math.abs(r.top - wantT) > 0.5) el.style.top = (parseFloat(el.style.top) || 0) + (wantT - r.top) / scale + 'px';
  }
  // the floats are worked out again only when the text or a pinned element changed (at most twice per change) –
  // their own effect on the layout must not start a new round
  const inputs = editor.state.doc.toJSON ? (editor.state.doc.content.size + ':' + els.map(e => [e.dataset.pg, e.dataset.px, e.dataset.py, Math.round(e.getBoundingClientRect().top), Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height), e.dataset.capT || 0, e.dataset.capB || 0].join(',')).join('|') + ':' + docVersion + ':' + pageCount + ':' + Math.round(dom.scrollHeight / 4)) : '';   // also when the layout changed (fonts, formulas drawn later)
  if (inputs === pinInputs && pinRounds >= 3) return;                // at most three rounds per change: their own effect on the layout must not start new rounds
  // the page breaks and the floats shape each other and can keep changing each other: after a few quick turns the
  // present state stays, and one more round comes when things are quiet (so the final state is always worked out)
  const nowT = performance.now();
  if (nowT - pinBurstAt > 600) pinTurns = 0;
  pinBurstAt = nowT;
  if (pinTurns >= 4) { clearTimeout(pinSettleT); pinSettleT = setTimeout(() => { pinTurns = 0; pinBurstAt = 0; pinInputs = ''; pinsSoon(); }, 700); return; }
  if (inputs !== pinInputs) { pinInputs = inputs; pinRounds = 0; pinLast = []; }
  pinRounds++;
  // 2. invisible floats in the text beside them (text on the side with more room) – measured on the text without the
  //    present floats (they would move the very lines they are anchored to). Objects lying on each other count as
  //    one (their outer outline, one margin); only the lines beside them make room, whatever the paragraph indents.
  const gap = (tpl.imgGap ?? 4) * MM, specs = [];
  const old = [];   // measured with the present floats: each paragraph's float only covers its own lines, so they do not chain
  const boxes = els.filter(el => !el.classList.contains('over') && !el.classList.contains('under')).map(el => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top - (+el.dataset.capT || 0) * scale, r: r.right, b: r.bottom + (+el.dataset.capB || 0) * scale, el }; }).filter(x => x.r > x.l && x.b > x.t);
  const groups = [];
  for (const bx of boxes.sort((p, q) => p.t - q.t)) {
    const gp = gap * scale, hit = groups.find(G => bx.l < G.r + gp && bx.r > G.l - gp && bx.t < G.b + gp && bx.b > G.t - gp);
    if (hit) { hit.l = Math.min(hit.l, bx.l); hit.r = Math.max(hit.r, bx.r); hit.t = Math.min(hit.t, bx.t); hit.b = Math.max(hit.b, bx.b); hit.els.push(bx.el); }
    else groups.push({ ...bx, els: [bx.el] });
  }
  const sr0 = stack.getBoundingClientRect();
  // every paragraph is measured once for all the objects (this used to be done again for every object and every line
  // beside it – seconds in a long document with many pictures)
  const TB = groups.length ? textBlocks() : [], rectOf = new Map(TB.map(x => [x.b, x.br]));
  for (const [ei, G0] of groups.entries()) {
    // the margin around an object: the set value at the sides, half of it below – none above: a line that ends above
    // the object is not beside it (a margin there pushed the last line of the paragraph before the object aside,
    // made that paragraph a line longer, and the layout could swing between two states)
    const vg = gap * scale * 0.5, G = { ...G0, t: G0.t, b: G0.b + vg };
    const keepOld = () => { if (pinRounds > 1 && pinLast[ei]) specs.push(...pinLast[ei]); };   // a second round never takes floats away
    const textLeft = (G.l - er.left) >= (er.right - G.r);
    const side = textLeft ? 'right' : 'left';
    // the paragraphs with lines beside the object: each gets its own invisible float, only over its own lines
    const blocks = TB.filter(({ br: r0 }) => r0.height > 0 && r0.top < G.b && r0.bottom > G.t).map(x => x.b);
    if (!blocks.length) { keepOld(); continue; }
    // indents beside the object: the outermost paragraph starts right at the object's margin, the others keep only
    // the difference of their indents (first-line and hanging indents do not count there)
    const edgeL = b0 => rectOf.get(b0).left, edgeR = b0 => rectOf.get(b0).right;
    const outerL = Math.min(...blocks.map(edgeL)), outerR = Math.max(...blocks.map(edgeR));
    const mine = [];
    // room a paragraph's list symbols need left of its text (a same-line inner list carries the outer symbols too)
    const liRoom = blk => {
      const li = blk.closest('li'); if (!li || li.firstElementChild !== blk) return 0;
      const pad = (parseFloat(getComputedStyle(li).paddingLeft) || 0) * scale;
      const ups = [...blk.querySelectorAll(':scope > .lm')].map(m => (+m.style.getPropertyValue('--up') || 0) + 1);
      return pad * Math.max(1, ...ups);
    };
    let shift = 0;
    if (!textLeft) for (const blk of blocks) {
      const br0 = rectOf.get(blk), f0 = lineAtY(Math.max(G.t, br0.top) + 1, null, TB);
      if (f0 && Math.abs(f0.top - (br0.top + (parseFloat(getComputedStyle(blk).paddingTop) || 0) * scale)) < 3) shift = Math.max(shift, liRoom(blk) - (edgeL(blk) - outerL));
    }
    blocks.forEach((blk, bi) => {
      const br = rectOf.get(blk), bcs = getComputedStyle(blk);
      const found = lineAtY(Math.max(G.t, br.top) + 1, null, TB);
      if (!found) return;
      let pos = found.pos; const lineTop = found.top;
      try { const d = editor.view.domAtPos(pos), host = (d.node.nodeType === 1 ? d.node : d.node.parentElement).closest('p,h1,h2,h3'); if (host !== blk) pos = editor.view.posAtDOM(blk, 0); } catch (e) { return; }
      if (lineTop >= G.b) return;
      const padL = parseFloat(bcs.paddingLeft) || 0, padR = parseFloat(bcs.paddingRight) || 0;
      const cbL = br.left + padL * scale, cbR = br.right - padR * scale;
      // the first line beside the object: no first-line / hanging indent there; a list symbol on such a line keeps its room
      const firstLine = Math.abs(lineTop - (br.top + (parseFloat(bcs.paddingTop) || 0) * scale)) < 3;
      // a float placed right before a line's first character goes onto the line before it (that is where the browser
      // still is when it meets it), pushing that line aside instead: inside a paragraph it goes after the first character
      if (!firstLine) { const $p = editor.state.doc.resolve(pos), nx = $p.nodeAfter; if (nx && $p.parent.isTextblock && pos + 1 < $p.end()) pos += 1; }
      const li = blk.closest('li'), symbolHere = !!li && firstLine && li.firstElementChild === blk;
      // a list symbol on a line beside the object keeps its room – the same shift for every paragraph there, so list
      // levels keep their alignment to each other
      void symbolHere; const markRoom = shift;
      const flat = firstLine && ((parseFloat(bcs.textIndent) || 0) < 0 || blk.hasAttribute('data-hang'));   // a hanging indent is dropped there (a first-line indent stays)
      const wPx = textLeft
        ? cbR - (G.l - gap * scale) - (outerR - edgeR(blk))
        : (G.r + gap * scale) + (edgeL(blk) - outerL) + markRoom - (flat ? br.left : cbL);
      if (wPx <= 1) return;
      const last = bi === blocks.length - 1;
      // a float ends a little before the next paragraph starts: two floats must never touch (they would stand side by side)
      const nextTop = last ? Infinity : rectOf.get(blocks[bi + 1]).top;
      const top = Math.max(G.t, lineTop), bottom = last ? G.b : Math.min(G.b, br.bottom, nextTop) - 2;
      const dy = Math.max(0, (G.t - lineTop) / scale), h = (bottom - top) / scale;
      if (h <= 0) return;
      const pgOf = Math.floor((lineTop - sr0.top) / scale / g.P);
      const atPageTop = (lineTop - (sr0.top + g.contentTop(pgOf) * scale)) / scale < 24;
      mine.push({ pos, side, after: atPageTop, flat: flat ? editor.view.posAtDOM(blk, 0) - 1 : null, w: Math.round(wPx / scale), h: Math.round(h), dy: Math.round(dy), key: `pin${side}${atPageTop ? 'a' : 'b'}${Math.round(wPx / scale)}x${Math.round(h)}+${Math.round(dy)}` });   // the key has no position: a float that only moved along with the text keeps its element
    });
    if (!mine.length) { keepOld(); continue; }
    specs.push(...mine); pinLast[ei] = mine; 
  }
  for (const o of old) o.style.display = '';
  const sig = JSON.stringify(specs);
  if (sig === pinPrev) return;
  pinPrev = sig;
  setPinSpacers(editor.view, specs);
  // settle right away, before anything is painted: the next rounds run now (the layout is up to date after the
  // dispatch), so the text does not visibly jump through the intermediate states
  if (!pinNested) { pinNested = true; try { for (let k = 0; k < 2; k++) { const before = pinPrev; updatePins(); if (pinPrev === before) break; } } finally { pinNested = false; } pinTurns++; relayout(0); }
}
let pinNested = false;
setPinTop((pg, py) => pg * geometry(tpl).P + py);
// eye mode in tables: the column of the cursor only
setCellFilter(td => {
  const c = tableContext(editor.state); if (!c) return false;
  const tbl = editor.view.nodeDOM(c.pos); if (!tbl || !tbl.contains(td)) return false;
  const $f = editor.state.selection.$from; let cellDom = null;
  for (let d = $f.depth; d > 0; d--) if (/^table(Cell|Header)$/.test($f.node(d).type.name)) { cellDom = editor.view.nodeDOM($f.before(d)); break; }
  if (!cellDom) return false;
  const a = cellDom.getBoundingClientRect(), b = td.getBoundingClientRect();
  return Math.abs(a.left - b.left) < 1 && Math.abs(a.right - b.right) < 1;
});
setStyleTabs(b => { const k = /^H[123]$/.test(b.tagName) ? b.tagName.toLowerCase() : 'p'; return (tpl.styles[k] || {}).tabs || null; });
editor.view.dom.addEventListener('kv-pin', pinsSoon);
/* formatting marks (eye button) */
let showMarks = load('matekosdoksi.marks') === '1', marksRaf = 0;
function marksSoon() {
  if (marksRaf) return;
  marksRaf = requestAnimationFrame(() => { marksRaf = 0; const l = $('#marksLayer'); if (!showMarks) { l.innerHTML = ''; return; } drawMarks(l, editor.view.dom, stack, scale, tpl.styles, (css => { const f = familyFromCSS(css); return f ? familyLabel(f).replace(/ \(.*\)$/, '') : css.split(',')[0].replace(/['"]/g, ''); }), tpl.preset === 'ures'); });
}
function applyZoom() {
  const g = geometry(tpl);
  const stackW = Math.max(g.sheetX(0), g.sheetX(1)) + g.W;
  scale = zoomMode === 'auto' ? Math.min(1, (ws.clientWidth - 24) / stackW) : (+zoomMode / 100);
  if (!(scale > 0)) scale = 1;
  stack.style.transform = `scale(${scale})`;
  outer.style.width = stackW * scale + 'px';
  outer.style.height = (parseFloat(stack.style.height) || g.H) * scale + 'px';
  for (const el of [$('#imgFrame'), $('#tblHandles')]) el.style.setProperty('--inv', 1 / scale);
  updateOverlays();
}
/** CSS of the paragraph styles of the template (Normál, Főcím, Cím, Alcím). Paragraph-level settings of a
 *  single paragraph (attributes) still win, because they are inline styles. */
function styleCSS() {
  const fam = f => f ? `${familyCSS(f)}, var(--doc-font)` : 'var(--doc-font)';
  const type = s => `font-family:${fam(s.font)};font-size:${+s.size}pt;color:${s.color};font-weight:${s.bold ? 700 : 400};font-style:${s.italic ? 'italic' : 'normal'};text-decoration:${s.underline ? 'underline' : 'none'};letter-spacing:${+s.letter ? s.letter + 'pt' : 'normal'};`;
  const para = s => `${s.shade ? `--style-shade:${s.shade};` : ''}text-align:${s.align || 'left'};line-height:${+s.line || 1.25};--sb:${+s.spaceBefore || 0}pt;--sa:${+s.spaceAfter || 0}pt;`
    + `margin-left:${+s.indentLeft || 0}cm;margin-right:${+s.indentRight || 0}cm;text-indent:${+s.firstLine || 0}cm;`;
  const st = tpl.styles;
  let css = `.docbody p{${type(st.p)}}\n.docbody > p{${para(st.p)}}\n.docbody li > p{text-align:${st.p.align || 'left'};line-height:${+st.p.line || 1.25};}\n`;
  for (const k of ['h1', 'h2', 'h3']) css += `.docbody ${k}{${type(st[k])}${para(st[k])}}\n`;
  css += `.docbody .own-shade{background-color:transparent !important}\n`;   // its own line shading is drawn instead
  // "no space between paragraphs of the same style" – stronger than the spacing set on a paragraph
  for (const tag of ['p', 'h1', 'h2', 'h3']) {
    const on = st[tag].contextual ? ':not([data-ctx="0"])' : '[data-ctx="1"]';      // style setting, or set on the paragraph
    css += `.docbody > ${tag} + ${tag}${on}{--sb:0pt !important}\n.docbody > ${tag}${on}:has(+ ${tag}){--sa:0pt !important}\n`;
  }
  const lon = tpl.lists.contextual ? ':not([data-ctx="0"])' : '[data-ctx="1"]';
  // the end of a list: the space after it is the normal text's (or what is set on that last item itself)
  css += `.docbody li > p${lon}:not([data-sb]):not([data-sa]){--sb:0pt !important;--sa:0pt !important}\n.docbody > :is(ul,ol) > li:last-child > p:last-child:not([data-sa]){--sa:${+st.p.spaceAfter || 0}pt !important}\n`;
  return css;
}
/** Redraw formulas whose look (font, bold – from marks or the paragraph style) changed; all of them when forced. */
function repaintMath(all) {
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name !== 'math') return;
    const m = editor.view.nodeDOM(pos);
    if (!m) return;
    const lk = lookOf(n, m), key = lk.font + '|' + lk.bold;
    if (!all && m._lk === key) return;
    m._lk = key;
    renderInto(m, n.attrs.tex, n.attrs.display, () => relayout(60), lk.bold, n.attrs.wrap, lk.font);
  });
}
function applyTpl(rerenderMath) {
  setFirstPage(tpl.startPage);
  const dom = editor.view.dom, P = tpl.styles.p;
  dom.style.fontSize = P.size + 'pt';
  dom.style.color = P.color;
  dom.style.lineHeight = String(P.line);
  dom.style.setProperty('--after', (+P.spaceAfter || 0) + 'pt');
  dom.style.setProperty('--img-gap', (tpl.imgGap ?? 4) + 'mm');
  const cap = tpl.cap || {};                                           // the look of the picture captions
  dom.style.setProperty('--cap-size', (+cap.size || 9) + 'pt'); dom.style.setProperty('--cap-color', cap.color || '#59616b');
  dom.style.setProperty('--cap-style', cap.italic ? 'italic' : 'normal'); dom.style.setProperty('--cap-weight', cap.bold ? '700' : '400');
  dom.style.setProperty('--cap-deco', cap.underline ? 'underline' : 'none');
  if (cap.font) dom.style.setProperty('--cap-font', `'MP ${cap.font}', var(--doc-font)`); else dom.style.removeProperty('--cap-font');
  queueMicrotask(syncHyphenation);
  // font set of the template: text font + its matching math font
  const fs = fontSet(tpl.font);
  document.documentElement.style.setProperty('--doc-font', fs.text === 'bonum' ? "'TeX Gyre Bonum', Georgia, serif" : `${familyCSS(fs.text)}, 'TeX Gyre Bonum', Georgia, serif`);
  if (fs.text !== 'bonum') loadTextFamily(fs.text).then(() => relayout(30));
  for (const k of ['p', 'h1', 'h2', 'h3']) if (tpl.styles[k].font) loadTextFamily(tpl.styles[k].font).then(() => relayout(30));
  if (setDocMathFont(fs.math)) rerenderMath = true;
  let sheet = document.getElementById('tplStyles');
  if (!sheet) { sheet = document.createElement('style'); sheet.id = 'tplStyles'; document.head.appendChild(sheet); }
  const css = styleCSS(); if (sheet.textContent !== css) sheet.textContent = css;
  // default list symbol / numbering
  if (listDefaults.bullet !== tpl.lists.bullet || listDefaults.num !== tpl.lists.num) {
    listDefaults.bullet = tpl.lists.bullet; listDefaults.num = tpl.lists.num;
    listDefaults.img = tpl.lists.bullet === 'matekos' ? MATEKOS_BULLET : null;
    editor.view.dispatch(editor.state.tr.setMeta('listDefaults', true).setMeta('addToHistory', false));
  }
  hfRenderCache();
  if (mathOpts.hunTrig !== tpl.hunTrig || mathOpts.decComma !== tpl.decComma || mathOpts.displayInline !== tpl.displayInline || rerenderMath) {
    mathOpts.hunTrig = tpl.hunTrig; mathOpts.decComma = tpl.decComma; mathOpts.displayInline = tpl.displayInline; clearMathCache();
    repaintMath(true);
  } else requestAnimationFrame(() => repaintMath(false));    // a style's font / weight may have changed
  applyLayout(pageCount);
  relayout(0);
}

