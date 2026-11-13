/* ------------------------------------------------------------------ */
/* Overlays drawn outside the text: picture frame, table selectors     */
/* (they sit above the page, so they can never move any text)          */
/* ------------------------------------------------------------------ */
function updateOverlays(mode) {
  if (mode === 'moving') { imgMoving = true; $('#imgFrame').hidden = true; return; }
  imgMoving = false;
  if (ovRaf) return;
  ovRaf = requestAnimationFrame(() => { ovRaf = 0; drawImgFrame(); drawTableHandles(); drawMathCaret(); });
}
// visible text cursor right before / after a formula (browsers often hide it there)
function drawMathCaret() {
  const c = $('#fcaret'), v = editor.view, sel = editor.state.selection;
  const $p = sel.$from;
  const near = sel.empty && v.hasFocus() && ((($p.nodeBefore && $p.nodeBefore.type.name === 'math') || ($p.nodeAfter && $p.nodeAfter.type.name === 'math')));
  if (!near) { c.hidden = true; return; }
  try {
    const k = v.coordsAtPos(sel.from, $p.nodeAfter && $p.nodeAfter.type.name === 'math' ? 1 : -1);
    const sr = stack.getBoundingClientRect();
    Object.assign(c.style, { left: (k.left - sr.left) / scale + 'px', top: (k.top - sr.top) / scale + 'px', height: (k.bottom - k.top) / scale + 'px', borderLeftWidth: 1.5 / scale + 'px' });
    c.hidden = false;
  } catch (e) { c.hidden = true; }
}
const toStack = r => { const sr = stack.getBoundingClientRect(); return { x: (r.left - sr.left) / scale, y: (r.top - sr.top) / scale, w: r.width / scale, h: r.height / scale }; };
function selectedImageDom() {
  const sel = editor.state.selection;
  if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'image') return null;
  const d = editor.view.nodeDOM(sel.from);
  return d && d._kv ? d : null;
}
function drawImgFrame() {
  const f = $('#imgFrame'), d = imgMoving ? null : selectedImageDom();
  if (!d) { f.hidden = true; return; }
  const r = toStack(d.getBoundingClientRect());   // the visible part of the picture (follows the cropping while dragging)
  Object.assign(f.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  const w0 = d._kv.node().attrs.wrap, w = w0 === 'wr' ? 'wl' : w0;
  void w;
  f.hidden = false;
}
$('#imgFrame').addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();
  const d = selectedImageDom(); if (!d) return;
  const h = e.target.dataset && e.target.dataset.h;
  if (cropMode) { if (h) d._kv.cropDrag(e, h); return; }            // cropping: the handles cut the picture
  if (h) d._kv.resize(e, h, $('#imgFrame .isize')); else d._kv.move(e);
});
/* picture row under the ribbon: crop, original picture, opacity, placement, replace, delete */
let cropMode = false;
const selImgDom = () => { const sel = editor.state.selection; return sel.node && sel.node.type.name === 'image' ? editor.view.nodeDOM(sel.from) : null; };
function updateImgBar() {
  const d = selImgDom(); $('#imgBar').hidden = !d;
  if (!d) { if (cropMode) { cropMode = false; $('#imgFrame').classList.remove('cropping'); } return; }
  const a = d._kv.node().attrs;
  $('#imgCrop').classList.toggle('on', cropMode); $('#imgUncrop').disabled = !a.crop;
  const op = Math.round((a.opacity ?? 1) * 100);
  if (document.activeElement !== $('#imgOpN')) $('#imgOpN').value = op;
  $('#imgOpR').value = op;
  const rd = Math.round(a.radius || 0);
  if (document.activeElement !== $('#imgRadN')) $('#imgRadN').value = rd;
  $('#imgRadR').value = rd;
  $('#imgWrapSel').value = a.wrap === 'wr' ? 'wl' : (a.wrap || 'wl');
  $('#imgCap').classList.toggle('on', !!(a.capTop || a.capBot));
}
const endCrop = () => { cropMode = false; $('#imgFrame').classList.remove('cropping'); updateImgBar(); updateOverlays(); };
$('#imgCrop').addEventListener('click', () => { if (cropMode) return endCrop(); if (!selImgDom()) return; cropMode = true; $('#imgFrame').classList.add('cropping'); updateImgBar(); updateOverlays(); });
$('#imgUncrop').addEventListener('click', () => { const d = selImgDom(); if (d) { d._kv.uncrop(); endCrop(); } });
const setOp = v => { const d = selImgDom(); if (d && Number.isFinite(v)) d._kv.setOpacity(v / 100); };
$('#imgOpR').addEventListener('input', e => { $('#imgOpN').value = e.target.value; const d = selImgDom(); if (d) d.querySelector('img').style.opacity = e.target.value / 100; });
$('#imgOpR').addEventListener('change', e => setOp(+e.target.value));
$('#imgOpN').addEventListener('change', e => setOp(+e.target.value));
const setRad = v => { const d = selImgDom(); if (d && Number.isFinite(v)) d._kv.setRadius(Math.min(50, Math.max(0, v))); };
$('#imgRadR').addEventListener('input', e => { $('#imgRadN').value = e.target.value; const d = selImgDom(); if (d) d.style.borderRadius = e.target.value + '%'; });
$('#imgRadR').addEventListener('change', e => setRad(+e.target.value));
$('#imgRadN').addEventListener('change', e => setRad(+e.target.value));
$('#imgWrapSel').addEventListener('change', e => { const d = selImgDom(); if (d) d._kv.setWrap(e.target.value); });
/* captions: a text above and / or below the picture (centred to it, moving with it; their look is in the template) */
$('#imgCap').addEventListener('mousedown', e => e.preventDefault());       // the picture stays selected
$('#imgCap').addEventListener('click', e => showPop('popImgCap', e.currentTarget));
$('#popImgCap').onopen = () => { const d = selImgDom(), a = d ? d._kv.node().attrs : {}; $('#capTopIn').value = a.capTop || ''; $('#capBotIn').value = a.capBot || ''; setTimeout(() => $('#capTopIn').focus(), 0); };
function setCaptions() {   // applied with the OK button (or Enter)
  const sel = editor.state.selection; if (!(sel.node && sel.node.type.name === 'image')) return;
  const capTop = $('#capTopIn').value.trim(), capBot = $('#capBotIn').value.trim();
  if (capTop === (sel.node.attrs.capTop || '') && capBot === (sel.node.attrs.capBot || '')) return;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(sel.from, undefined, { ...sel.node.attrs, capTop, capBot }));
}
for (const id of ['#capTopIn', '#capBotIn']) $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); setCaptions(); closePops(); } });
$('#capOk').addEventListener('click', () => { setCaptions(); closePops(); });
/* links: set on the selection (or the URL itself as the text); Ctrl/⌘ + click opens one */
$('#popLink').onopen = () => { $('#linkIn').value = editor.getAttributes('link').href || ''; $('#linkDel').disabled = !editor.isActive('link'); setTimeout(() => { $('#linkIn').focus(); $('#linkIn').select(); }, 0); };
function applyLink() {
  let href = $('#linkIn').value.trim(); closePops();
  if (!href) { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) href = (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(href) ? 'mailto:' : 'https://') + href;
  const c = editor.chain().focus();
  if (editor.state.selection.empty && !editor.isActive('link')) c.insertContent({ type: 'text', text: href.replace(/^mailto:/, ''), marks: [{ type: 'link', attrs: { href } }] }).run();
  else c.extendMarkRange('link').setLink({ href }).run();
}
$('#linkOk').addEventListener('click', applyLink);
$('#linkDel').addEventListener('click', () => { closePops(); editor.chain().focus().extendMarkRange('link').unsetLink().run(); });
$('#linkIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); } });
editor.view.dom.addEventListener('click', e => {
  const a = (e.ctrlKey || e.metaKey) && e.target.closest && e.target.closest('a[href]');
  if (a && editor.view.dom.contains(a)) { e.preventDefault(); openLink(a.getAttribute('href')); }
});
$('#capCancel').addEventListener('click', () => closePops());
$('#imgReplace').addEventListener('click', () => { const d = selImgDom(); if (d) pickImage(1600, url => d._kv.replace(url)); });
$('#imgDel').addEventListener('click', () => { const d = selImgDom(); if (d) d._kv.remove(); });
addEventListener('keydown', e => { if (cropMode && (e.key === 'Escape' || e.key === 'Enter')) { e.preventDefault(); endCrop(); } }, true);

function drawTableHandles() {
  const layer = $('#tblHandles');
  const c = tableContext(editor.state);
  if (!c) { if (layer.innerHTML) layer.innerHTML = ''; layer._key = ''; return; }
  const wrap = editor.view.nodeDOM(c.pos); if (!wrap) return;
  const tbl = wrap.tagName === 'TABLE' ? wrap : wrap.querySelector('table'); if (!tbl) return;
  const { map, start, table } = c;
  const tr = toStack(tbl.getBoundingClientRect());
  const cols = [];
  for (let col = 0; col < map.width; col++) {
    let rr = null;
    for (let row = 0; row < map.height && !rr; row++) {
      const rel = map.map[row * map.width + col], n = table.nodeAt(rel);
      if (n && n.attrs.colspan === 1) { const dom = editor.view.nodeDOM(start + rel); if (dom) rr = toStack(dom.getBoundingClientRect()); }
    }
    cols.push(rr);
  }
  const rows = [];
  table.forEach((row, off) => { const dom = editor.view.nodeDOM(start + off); rows.push(dom ? toStack(dom.getBoundingClientRect()) : null); });
  const sel = editor.state.selection, cs = sel instanceof CellSelection;
  const rect = c.rect;
  const colOn = i => cs && sel.isColSelection() && i >= rect.left && i < rect.right;
  const rowOn = i => cs && sel.isRowSelection() && i >= rect.top && i < rect.bottom;
  const allOn = cs && sel.isColSelection() && sel.isRowSelection();
  const inv = 1 / scale, gapY = 18 * inv, gapX = 18 * inv;
  let h = `<button class="th-btn${allOn ? ' on' : ''}" data-ts="all" title="A teljes táblázat kijelölése" style="left:${tr.x - gapX}px;top:${tr.y - gapY}px">◢</button>`;
  cols.forEach((r, i) => { if (r) h += `<button class="th-btn${colOn(i) ? ' on' : ''}" data-ts="col" data-i="${i}" title="Oszlop kijelölése" style="left:${r.x + r.w / 2 - 8 * inv}px;top:${tr.y - gapY}px">▼</button>`; });
  rows.forEach((r, i) => { if (r && r.h > 0) h += `<button class="th-btn row${rowOn(i) ? ' on' : ''}" data-ts="row" data-i="${i}" title="Sor kijelölése" style="left:${tr.x - gapX}px;top:${r.y + r.h / 2 - 8 * inv}px">▶</button>`; });
  if (table.attrs.pin) {
    const wr = toStack(wrap.getBoundingClientRect());
    h += `<div class="tbl-frame" style="left:${wr.x - 3 * inv}px;top:${wr.y - 3 * inv}px;width:${wr.w + 6 * inv}px;height:${wr.h + 6 * inv}px"></div>`
      + `<button class="th-btn mv" data-ts="move" title="A táblázat áthelyezése (húzd)" style="left:${wr.x + wr.w / 2 - 12 * inv}px;top:${wr.y - gapY - 32 * inv}px">${svg('move')}</button>`;   // above the column selectors
  }
  if (layer._key !== h) { layer.innerHTML = h; layer._key = h; }
}
function selectTableRange(r0, c0, r1, c1) {
  const c = tableContext(editor.state); if (!c) return;
  const { map, start, table } = c;
  const pa = start + map.positionAt(r0, c0, table), pb = start + map.positionAt(r1, c1, table);
  editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, pa, pb)));
  if (!editor.view.hasFocus()) editor.view.dom.focus({ preventScroll: true });
}
/* dragging a freely placed table by its ✥ handle: it moves on its own layer, inside the page margins */
$('#tblHandles').addEventListener('pointerdown', e => {
  const b = e.target.closest('[data-ts="move"]'); if (!b || e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();
  const c = tableContext(editor.state); if (!c) return;
  const wrap = editor.view.nodeDOM(c.pos); if (!wrap) return;
  const r0 = wrap.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
  const l0 = parseFloat(wrap.style.left) || 0, t0 = parseFloat(wrap.style.top) || 0;
  let last = { l: r0.left, t: r0.top };
  const mv = ev => {
    let gx = r0.left + ev.clientX - sx, gy = r0.top + ev.clientY - sy;
    const bx = editor.extensionManager.extensions.find(x => x.name === 'image').options.pageBox(ev.clientY);
    if (bx) { gx = Math.min(Math.max(gx, bx.left), bx.right - r0.width); gy = Math.min(Math.max(gy, bx.top), bx.bottom - r0.height); }
    last = { l: gx, t: gy };
    wrap.style.left = l0 + (gx - r0.left) / scale + 'px'; wrap.style.top = t0 + (gy - r0.top) / scale + 'px';
    updateOverlays();
  };
  const up = () => {
    removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    const bx = editor.extensionManager.extensions.find(x => x.name === 'image').options.pageBox(last.t + 1); if (!bx) return;
    const c2 = tableContext(editor.state); if (!c2) return;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(c2.pos, undefined, { ...c2.table.attrs, pin: true, pg: bx.page, px: Math.round((last.l - bx.left) / scale * 10) / 10, py: Math.round((last.t - bx.top) / scale * 10) / 10 }));
    pinsSoon();
  };
  addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
}, true);
/* free placement of a table on / off (table toolbar) */
queueMicrotask(() => $('#tblPin').addEventListener('click', () => { toggleTablePin(); updateToolbar(); }));
function toggleTablePin() {
  const c = tableContext(editor.state); if (!c) return;
  const wrap = editor.view.nodeDOM(c.pos);
  if (c.table.attrs.pin) { editor.view.dispatch(editor.state.tr.setNodeMarkup(c.pos, undefined, { ...c.table.attrs, pin: false })); return; }
  const r = wrap.getBoundingClientRect(), bx = editor.extensionManager.extensions.find(x => x.name === 'image').options.pageBox(r.top + 1); if (!bx) return;
  // a free table gets a width of its own (60 % unless it has one), so it can move and text can wrap beside it
  editor.view.dispatch(editor.state.tr.setNodeMarkup(c.pos, undefined, { ...c.table.attrs, width: c.table.attrs.width && c.table.attrs.width < 100 ? c.table.attrs.width : 60, pin: true, pg: bx.page, px: Math.max(0, Math.round((r.left - bx.left) / scale)), py: Math.max(0, Math.round((r.top - bx.top) / scale)) }));
  toast('A táblázat szabadon mozgatható: húzd a keret tetején középen lévő fogóval. A szöveg körbefut rajta.');
}
$('#tblHandles').addEventListener('mousedown', e => {
  const b = e.target.closest('.th-btn'); if (!b || e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();
  const c = tableContext(editor.state); if (!c) return;
  const { map } = c, i = +b.dataset.i;
  const sel = editor.state.selection, ext = e.shiftKey && sel instanceof CellSelection;
  if (b.dataset.ts === 'all') return selectTableRange(0, 0, map.height - 1, map.width - 1);
  if (b.dataset.ts === 'col') {
    const a = ext && sel.isColSelection() ? Math.min(c.rect.left, i) : i, z = ext && sel.isColSelection() ? Math.max(c.rect.right - 1, i) : i;
    return selectTableRange(0, a, map.height - 1, z);
  }
  const a = ext && sel.isRowSelection() ? Math.min(c.rect.top, i) : i, z = ext && sel.isRowSelection() ? Math.max(c.rect.bottom - 1, i) : i;
  selectTableRange(a, 0, z, map.width - 1);
});

