import './styles.css';
import './doksi.css';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color, FontSize } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { ListItem } from '@tiptap/extension-list';
import { NodeSelection } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { drawShadeBands } from './shading.js';

import { loadFonts } from './fonts.js';
import { startMathJax, renderInto, opts as mathOpts, clearMathCache, mathReady } from './math.js';
import { DEFAULT_TPL, normalizeTpl, geometry, GAP, MM } from './template.js';
import { renderSheets, sheetHTML, esc } from './pages.js';
import { ParaFormat, KvBulletList, KvOrderedList, ListMarkers, KvTable, KvTableRow, KvTableCell, KvTableHeader, PageBreak, MathNode, KvImage, LineShade, tableContext, ListHang, LetterSpacing, TextCase } from './editor/extensions.js';
import { Pagination } from './editor/pagination.js';
import { buildPDF } from './pdf.js';
import { isTauri, saveDocument, openDocumentFile, openPathFile, watchOpenedFiles, savePdfBlob, printPdfBlob, setCurrentPath, getCurrentPath, currentFileName, titleOfFile, renameCurrentFile, currentFileExists, autosave, loadAutosave } from './files.js';
import { SAMPLE_HTML } from './sample.js';
import { svg } from './icons.js';
import APP_ICON from '../public/app-icon.png?inline';
import { openMathEditor, isMathEditorOpen, applyMathEditor } from './mathEditor.js';

const $ = s => document.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const APP_VERSION = __APP_VERSION__;
const LS_DOC = 'matekosdoksi.v2.doc', LS_TPL = 'matekosdoksi.v2.tpl';
const OLD_DOC = 'kiadvany.v2.doc', OLD_TPL = 'kiadvany.v2.tpl';   // earlier test versions
const store = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
const load = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };

let tpl = normalizeTpl(DEFAULT_TPL);
let zoomMode = 'auto', scale = 1, pageCount = 1;
let tblCtx = null;                 // table + selected cells, remembered while a table popover / size field is in use
let ovRaf = 0, imgMoving = false;  // overlay redraw state
const stack = $('#stack'), outer = $('#outer'), ws = $('#ws'), pagesEl = $('#pages');

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */
startMathJax();
const editor = new Editor({
  element: $('#editorHost'),
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] }, code: false, codeBlock: false, blockquote: false, horizontalRule: false,
      link: false, bulletList: false, orderedList: false, listItem: false,
      dropcursor: { color: '#2f6fdb', width: 2 }
    }),
    ListItem, KvBulletList, KvOrderedList, ListMarkers,
    TextStyle, Color, FontSize, LetterSpacing, TextCase, ListHang,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Subscript, Superscript,
    KvTable, KvTableRow, KvTableHeader, KvTableCell, LineShade,
    ParaFormat, PageBreak,
    MathNode.configure({
      onEdit: (pos, node) => openMath(pos, node),
      onRendered: () => relayout(60),
      onPreview: p => showPreview(p)
    }),
    KvImage.configure({ getScale: () => scale, onChange: m => updateOverlays(m) }),
    Pagination.configure({ getTpl: () => tpl, getScale: () => scale, onLayout: n => applyLayout(n) })
  ],
  content: '<p></p>',
  editorProps: {
    attributes: { spellcheck: 'true', lang: 'hu' },
    handleDOMEvents: {
      // no dragging of cell contents inside tables
      dragstart: (view, e) => { if (e.target && e.target.closest && (e.target.closest('td,th') || (e.target.parentElement && e.target.parentElement.closest('td,th')))) { e.preventDefault(); return true; } return false; },
      drop: (view, e) => { const t = e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement); if (t && t.closest('td,th') && !(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length)) { e.preventDefault(); return true; } return false; }
    },
    handlePaste(view, event) {
      const files = Array.from((event.clipboardData && event.clipboardData.files) || []).filter(f => f.type.startsWith('image/'));
      if (!files.length) return false;
      event.preventDefault();
      files.forEach(async f => insertImageFile(f));
      return true;
    },
    handleDrop(view, event, slice, moved) {
      if (moved) return false;
      const files = Array.from((event.dataTransfer && event.dataTransfer.files) || []).filter(f => f.type.startsWith('image/'));
      if (!files.length) return false;
      event.preventDefault();
      const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
      files.forEach(async f => insertImageFile(f, hit ? hit.pos : null));
      return true;
    }
  },
  onUpdate: () => { markDirty(); saveSoon(); },
  onSelectionUpdate: () => { if (editor.view.hasFocus()) tblCtx = null; updateToolbar(); },
  onFocus: () => updateOverlays(),
  onBlur: () => updateOverlays(),
  onTransaction: () => { updateToolbar(); updateOverlays(); }
});
const relayout = (d = 60) => editor.storage.pagination.relayout(d);

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
  renderSheets(pagesEl, n, tpl, $('#docTitle').value);
  const stackW = Math.max(g.sheetX(0), g.sheetX(1)) + g.W;
  stack.style.width = stackW + 'px';
  stack.style.height = (n * g.P - GAP) + 'px';
  applyZoom();
  drawShadeBands($('#shadeLayer'), dom, stack, scale, y => Math.floor(y / g.P));
  updateOverlays();
  thumbsSoon();
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
function applyTpl(rerenderMath) {
  const dom = editor.view.dom;
  dom.style.fontSize = tpl.size + 'pt';
  dom.style.color = tpl.color;
  dom.style.lineHeight = String(tpl.line);
  dom.style.setProperty('--after', tpl.after + 'pt');
  dom.style.setProperty('--img-gap', (tpl.imgGap ?? 4) + 'mm');
  for (const k of ['h1', 'h2', 'h3']) {
    const st = tpl.styles[k];
    dom.style.setProperty(`--${k}s`, st.size + 'pt'); dom.style.setProperty(`--${k}c`, st.color || 'inherit');
    dom.style.setProperty(`--${k}w`, st.bold ? '700' : '400'); dom.style.setProperty(`--${k}i`, st.italic ? 'italic' : 'normal');
    dom.style.setProperty(`--${k}u`, st.underline ? 'underline' : 'none');
  }
  if (mathOpts.hunTrig !== tpl.hunTrig || mathOpts.decComma !== tpl.decComma || mathOpts.displayInline !== tpl.displayInline || rerenderMath) {
    mathOpts.hunTrig = tpl.hunTrig; mathOpts.decComma = tpl.decComma; mathOpts.displayInline = tpl.displayInline; clearMathCache();
    // repaint every formula with its own look (bold, line breaking)
    editor.state.doc.descendants((n, pos) => {
      if (n.type.name !== 'math') return;
      const m = editor.view.nodeDOM(pos);
      if (m) renderInto(m, n.attrs.tex, n.attrs.display, () => relayout(60), n.marks.some(x => x.type.name === 'bold'), n.attrs.wrap);
    });
  }
  applyLayout(pageCount);
  relayout(0);
}

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
  const r = toStack(d._kv.img.getBoundingClientRect());
  Object.assign(f.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  const w = d._kv.node().attrs.wrap;
  for (const b of f.querySelectorAll('[data-wrap]')) b.classList.toggle('on', b.dataset.wrap === w);
  f.hidden = false;
}
$('#imgFrame').addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('.ibar')) return;
  e.preventDefault(); e.stopPropagation();
  const d = selectedImageDom(); if (!d) return;
  const h = e.target.dataset && e.target.dataset.h;
  if (h) d._kv.resize(e, h, $('#imgFrame .isize')); else d._kv.move(e);
});
$('#imgFrame .ibar').addEventListener('mousedown', e => e.preventDefault());
$('#imgFrame .ibar').addEventListener('click', e => {
  const b = e.target.closest('button'), d = selectedImageDom(); if (!b || !d) return;
  if (b.dataset.wrap) d._kv.setWrap(b.dataset.wrap); else if (b.dataset.act === 'del') d._kv.remove();
});

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
  if (layer._key !== h) { layer.innerHTML = h; layer._key = h; }
}
function selectTableRange(r0, c0, r1, c1) {
  const c = tableContext(editor.state); if (!c) return;
  const { map, start, table } = c;
  const pa = start + map.positionAt(r0, c0, table), pb = start + map.positionAt(r1, c1, table);
  editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, pa, pb)));
  if (!editor.view.hasFocus()) editor.view.dom.focus({ preventScroll: true });
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

/* ------------------------------------------------------------------ */
/* Toolbar (Matekos Prezi layout)                                      */
/* ------------------------------------------------------------------ */
for (const b of $$('[data-icon]')) b.insertAdjacentHTML('afterbegin', svg(b.dataset.icon));
for (const c of $$('.psec-h .chev')) c.innerHTML = svg('chev');
const ch = () => editor.chain().focus();
const isUpper = () => editor.getAttributes('textStyle').textTransform === 'uppercase';
const COMMANDS = {
  undo: () => ch().undo().run(),
  redo: () => ch().redo().run(),
  bold: () => ch().toggleBold().run(),
  italic: () => ch().toggleItalic().run(),
  underline: () => ch().toggleUnderline().run(),
  strike: () => ch().toggleStrike().run(),
  superscript: () => ch().toggleSuperscript().run(),
  subscript: () => ch().toggleSubscript().run(),
  upper: () => isUpper() ? ch().unsetUppercase().run() : ch().setUppercase().run(),
  clearFormat: () => ch().unsetAllMarks().run(),
  alignLeft: () => ch().setTextAlign('left').run(),
  alignCenter: () => ch().setTextAlign('center').run(),
  alignRight: () => ch().setTextAlign('right').run(),
  alignJustify: () => ch().setTextAlign('justify').run(),
  bulletList: () => ch().toggleBulletList().run(),
  orderedList: () => ch().toggleOrderedList().run(),
  indent: () => editor.isActive('listItem') ? ch().sinkListItem('listItem').run() : ch().shiftIndent(1).run(),
  outdent: () => editor.isActive('listItem') ? ch().liftListItem('listItem').run() : ch().shiftIndent(-1).run(),
  image: () => $('#fileIn').click(),
  pageBreak: () => ch().setPageBreak().run(),
  math: () => openMath(null, null)
};
const STATES = {
  bold: () => editor.isActive('bold'), italic: () => editor.isActive('italic'), underline: () => editor.isActive('underline'),
  strike: () => editor.isActive('strike'), superscript: () => editor.isActive('superscript'), subscript: () => editor.isActive('subscript'),
  upper: isUpper,
  alignLeft: () => editor.isActive({ textAlign: 'left' }), alignCenter: () => editor.isActive({ textAlign: 'center' }),
  alignRight: () => editor.isActive({ textAlign: 'right' }), alignJustify: () => editor.isActive({ textAlign: 'justify' }),
  bulletList: () => editor.isActive('bulletList'), orderedList: () => editor.isActive('orderedList')
};
let tbRaf = 0;
function updateToolbar() {
  if (tbRaf) return;
  tbRaf = requestAnimationFrame(() => {
    tbRaf = 0;
    for (const b of $$('#ribbon [data-state]')) b.classList.toggle('on', !!(STATES[b.dataset.state] && STATES[b.dataset.state]()));
    const { from } = editor.state.selection;
    let el = null;
    try { const d = editor.view.domAtPos(from); el = d.node.nodeType === 1 ? d.node : d.node.parentElement; } catch (e) { /* ignore */ }
    if (el && editor.view.dom.contains(el)) {
      const cs = getComputedStyle(el);
      if (document.activeElement !== $('#sizeIn')) $('#sizeIn').value = String(Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2).replace('.', ',');
      $('#colorBar').style.background = cs.color;
    }
    $('#styleSel').value = editor.isActive('heading', { level: 1 }) ? 'h1' : editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p';
    $('#tableBar').hidden = !editor.isActive('table');
    if (!$('#tableBar').hidden) fillTableFields();
    for (const b of $$('#tableBar [data-valign]')) b.classList.toggle('on', (editor.getAttributes('tableCell').vAlign || editor.getAttributes('tableHeader').vAlign || 'top') === b.dataset.valign);
  });
}
for (const bar of [$('#ribbon'), $('#tableBar'), $('.b1left')]) {
  bar.addEventListener('mousedown', e => { if (e.target.closest('button') && !e.target.closest('[data-pop="popFile"],[data-pop="popExport"],[data-pop="popSave"],#bSave')) e.preventDefault(); });
  bar.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.pop) return showPop(b.dataset.pop, b);
    if (b.dataset.cmd && COMMANDS[b.dataset.cmd]) return COMMANDS[b.dataset.cmd]();
    if (b.dataset.tbl) return editor.chain().focus()[b.dataset.tbl]().run();
    if (b.dataset.valign) return ch().setCellAttribute('vAlign', b.dataset.valign).run();
    if (b.dataset.talign) return setTableAttrs({ align: b.dataset.talign });
  });
}
$('#styleSel').addEventListener('change', e => {
  const v = e.target.value;
  if (v === 'p') ch().setParagraph().run(); else ch().setHeading({ level: +v[1] }).run();
});
const setSize = v => { const p = parseFloat(String(v).replace(',', '.')); if (p > 0 && p < 500) ch().setFontSize(p + 'pt').run(); };
$('#sizeIn').addEventListener('change', e => setSize(e.target.value));
$('#sizeIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); setSize(e.target.value); } });
const SIZES = [8, 9, 10, 10.5, 11, 12, 13, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 48, 60, 72];
$('#sizeGrid').innerHTML = SIZES.map(v => `<button class="pitem" data-size="${v}">${String(v).replace('.', ',')}</button>`).join('');
$('#popSize').onopen = () => { const c = parseFloat(String($('#sizeIn').value).replace(',', '.')); for (const b of $('#sizeGrid').children) b.classList.toggle('on', +b.dataset.size === c); };
$('#sizeGrid').addEventListener('click', e => { const b = e.target.closest('[data-size]'); if (!b) return; closePops(); $('#sizeIn').value = b.textContent; setSize(b.dataset.size); });

/* popovers */
let openPop = null, openAnchor = null;
function rememberTable() { if (tblCtx) return; const c = tableContext(editor.state); tblCtx = c ? { pos: c.pos, rect: c.rect } : null; }
function showPop(id, anchor) {
  const p = $('#' + id);
  if (/^pop(Borders|Cell)$/.test(id)) rememberTable();
  if (openPop === p) return closePops();
  closePops();
  if (p.onopen) p.onopen();
  p.hidden = false;
  const r = anchor.getBoundingClientRect();
  p.style.left = Math.max(8, Math.min(r.left, innerWidth - p.offsetWidth - 8)) + 'px';
  let top = r.bottom + 6; if (top + p.offsetHeight > innerHeight - 8) top = Math.max(8, innerHeight - p.offsetHeight - 8);
  p.style.top = top + 'px';
  openPop = p; openAnchor = anchor;
}
function closePops() { if (openPop) { openPop.hidden = true; openPop = null; openAnchor = null; } }
document.addEventListener('pointerdown', e => { if (openPop && !openPop.contains(e.target) && !(openAnchor && openAnchor.contains(e.target))) closePops(); }, true);
for (const p of $$('.pop')) p.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });

function swatches(box, colors, onPick, noneLabel) {
  box.innerHTML = colors.map(c => `<button class="sw" data-c="${c}" style="background:${c}" title="${c}" aria-label="${c}"></button>`).join('')
    + '<label class="sw custom" title="Egyéni szín"><input type="color" aria-label="Egyéni szín"></label>'
    + (noneLabel ? `<button class="sw none" data-c="none">${noneLabel}</button>` : '');
  box.addEventListener('click', e => { const b = e.target.closest('button[data-c]'); if (b) { onPick(b.dataset.c); closePops(); } });
  box.querySelector('input').addEventListener('change', e => { onPick(e.target.value); closePops(); });
}
swatches($('#swText'), ['#111111', '#5d6875', '#ffffff', '#da291c', '#c0392b', '#d35400', '#b7950b', '#1e8449', '#117a65', '#1f5f74', '#2e4a9e', '#7d3c98'], c => ch().setColor(c).run());
swatches($('#swHi'), ['#fff176', '#c5f0a4', '#b3ecf5', '#f8bbd0', '#ffd59e', '#e1bee7', '#e0e0e0'], c => c === 'none' ? ch().unsetHighlight().run() : ch().setHighlight({ color: c }).run(), 'Nincs kiemelés');
swatches($('#swShade'), ['#dbe9ee', '#e8eef5', '#eaf4e4', '#fdf3d7', '#f9e1e1', '#ece6f5', '#eeeeee'], c => {
  const empty = editor.state.selection.empty;
  if (c === 'none') return ch().unsetMark('lineShade').setParaAttrs({ shade: null }).run();
  if (empty) {                                                // cursor only: just the line the cursor is in
    const r = currentLineRange();
    if (r) editor.chain().focus().setTextSelection(r).setMark('lineShade', { color: c }).setTextSelection(editor.state.selection.from).run();
    else ch().setParaAttrs({ shade: c }).run();               // empty paragraph: shade its (single) line
  } else ch().setMark('lineShade', { color: c }).run();       // selection: exactly the lines it touches
}, 'Nincs árnyékolás');
swatches($('#swCell'), ['#e8eef5', '#eaf4e4', '#fdf3d7', '#f9e1e1', '#ece6f5', '#eeeeee', '#d6e4f0'], c => forCells('cells', () => ({ background: c === 'none' ? null : c })), 'Nincs kitöltés');

/* letter spacing (Prezi) */
const spR = $('#spacingR'), spN = $('#spacingIn');
function setSpacing(v, final) {
  if (!isFinite(v)) return;
  v = Math.round(v * 10) / 10;
  if (!final) return;
  (v ? editor.chain().focus().setLetterSpacing(v + 'pt') : editor.chain().focus().unsetLetterSpacing()).run();
}
spR.oninput = () => { spN.value = spR.value; };
spR.onchange = () => setSpacing(+spR.value, true);
spN.onchange = () => { const v = parseFloat(String(spN.value).replace(',', '.')); if (!isFinite(v)) return; spR.value = v; setSpacing(v, true); };
$('#popSpacing').onopen = () => { const ls = editor.getAttributes('textStyle').letterSpacing; spR.value = spN.value = ls ? parseFloat(ls) : 0; };

/* bullets, numbering */
const BUL = ['•', '◦', '▪', '–', '➤', '➔', '✓', '★', '◆', '❖', '☐', '→'];
$('#bulGrid').innerHTML = BUL.map(b => `<button data-bul="${b}" aria-label="${b}">${b}</button>`).join('');
function setBullet(attrs) {
  if (!editor.isActive('bulletList')) ch().toggleBulletList().run();
  ch().updateAttributes('bulletList', attrs).run();
}
$('#popBullet').addEventListener('click', e => {
  const b = e.target.closest('[data-bul]'); if (!b) return;
  closePops();
  if (b.dataset.bul === 'none') { if (editor.isActive('bulletList')) ch().toggleBulletList().run(); return; }
  setBullet({ bulletChar: b.dataset.bul, bulletImage: '' });
});
$('#popBullet').onopen = () => { const a = editor.isActive('bulletList') ? editor.getAttributes('bulletList') : null;
  for (const b of $$('#popBullet [data-bul]')) b.classList.toggle('on', !!a && !a.bulletImage && b.dataset.bul === (a.bulletChar || '')); };
$('#bulCustomBtn').addEventListener('click', () => { const v = $('#bulCustom').value.trim(); if (v) { closePops(); setBullet({ bulletChar: v, bulletImage: '' }); } });
$('#bulPicBtn').addEventListener('click', () => pickImage(512, url => { closePops(); setBullet({ bulletImage: url, bulletChar: '', bulletSize: +$('#bulPicSize').value || 0.9 }); }));
$('#bulPicSize').addEventListener('change', e => { if (editor.isActive('bulletList')) ch().updateAttributes('bulletList', { bulletSize: +e.target.value || 0.9 }).run(); });
$('#popNum').addEventListener('click', e => {
  const b = e.target.closest('[data-num]'); if (!b) return; closePops();
  if (!editor.isActive('orderedList')) ch().toggleOrderedList().run();
  ch().updateAttributes('orderedList', { numStyle: b.dataset.num }).run();
});
$('#popNum').onopen = () => { const st = editor.isActive('orderedList') ? (editor.getAttributes('orderedList').numStyle || 'decimal') : null;
  for (const b of $$('#popNum [data-num]')) b.classList.toggle('on', b.dataset.num === st); };

/* line spacing (Prezi: list + own value) */
const LH = [1, 1.15, 1.25, 1.5, 2, 2.5, 3];
$('#lineList').innerHTML = LH.map(v => `<button class="pitem" data-lh="${v}">${String(v).replace('.', ',')}</button>`).join('');
$('#popLine').onopen = () => {
  const a = editor.isActive('heading') ? editor.getAttributes('heading') : editor.getAttributes('paragraph');
  const v = a.lineHeight ? +a.lineHeight : tpl.line;
  for (const b of $('#lineList').children) b.classList.toggle('on', +b.dataset.lh === v);
  $('#lhIn').value = !LH.includes(v) ? String(v).replace('.', ',') : '';
};
$('#lineList').addEventListener('click', e => { const b = e.target.closest('[data-lh]'); if (!b) return; closePops(); ch().setParaAttrs({ lineHeight: +b.dataset.lh }).run(); });
$('#lhOk').onclick = () => { const v = parseFloat(String($('#lhIn').value).replace(',', '.')); if (!(v >= 0.5 && v <= 5)) return; closePops(); ch().setParaAttrs({ lineHeight: Math.round(v * 100) / 100 }).run(); };
$('#lhIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#lhOk').click(); } });

/* paragraph: indents, first line / hanging, spacing (Prezi) */
$('#popPara').onopen = () => {
  const a = editor.isActive('heading') ? editor.getAttributes('heading') : editor.getAttributes('paragraph');
  for (const inp of $$('#popPara [data-pf]')) {
    const k = inp.dataset.pf;
    if (inp.type === 'checkbox') inp.checked = !!a[k];
    else inp.value = a[k] ?? (k === 'spaceAfter' ? tpl.after : 0);
  }
  const hang = a.hang || (a.firstLine < 0 ? -a.firstLine : 0);
  $('#pfFirstKind').value = hang ? 'hang' : a.firstLine > 0 ? 'first' : 'none';
  $('#pfFirstVal').value = hang || a.firstLine || '';
};
function applyFirstLine() {
  const kind = $('#pfFirstKind').value, v = Math.max(0, parseFloat(String($('#pfFirstVal').value).replace(',', '.')) || 0);
  const { state } = editor, tr = state.tr, { from, to } = state.selection;
  state.doc.nodesBetween(from, to, (n, pos) => {
    if (n.type.name !== 'paragraph' && n.type.name !== 'heading') return;
    const inList = state.doc.resolve(pos).parent.type.name === 'listItem', a = n.attrs;
    const oldHang = a.firstLine < 0 ? -a.firstLine : 0, base = Math.max(0, (a.indentLeft || 0) - oldHang) || null;
    let na;
    if (kind === 'none' || !v) na = { firstLine: null, hang: null, indentLeft: base };
    else if (kind === 'first') na = { firstLine: v, hang: null, indentLeft: base };
    else if (inList && n.type.name === 'paragraph') na = { hang: v, firstLine: null, indentLeft: base };   // list: more room after the symbol
    else na = { firstLine: -v, hang: null, indentLeft: (base || 0) + v };
    tr.setNodeMarkup(pos, undefined, { ...a, ...na });
  });
  editor.view.dispatch(tr);
}
$('#pfFirstKind').addEventListener('change', applyFirstLine);
$('#pfFirstVal').addEventListener('change', applyFirstLine);
$('#popPara').addEventListener('change', e => {
  const k = e.target.dataset.pf; if (!k) return;
  const v = e.target.type === 'checkbox' ? e.target.checked : (e.target.value === '' ? null : +e.target.value);
  editor.chain().setParaAttrs({ [k]: v }).run();
});
const tg = $('#tgrid');
for (let r = 1; r <= 8; r++) for (let c = 1; c <= 8; c++) { const d = document.createElement('button'); d.className = 'tc'; d.dataset.r = r; d.dataset.c = c; d.setAttribute('aria-label', r + ' × ' + c); tg.appendChild(d); }
const hl = (r, c) => { for (const d of tg.children) d.classList.toggle('on', +d.dataset.r <= r && +d.dataset.c <= c); $('#tlabel').textContent = r ? r + ' × ' + c + ' táblázat' : 'Válassz méretet'; };
tg.addEventListener('pointerover', e => { const d = e.target.closest('.tc'); if (d) hl(+d.dataset.r, +d.dataset.c); });
tg.addEventListener('click', e => { const d = e.target.closest('.tc'); if (d) { closePops(); ch().insertTable({ rows: +d.dataset.r, cols: +d.dataset.c, withHeaderRow: false }).run(); } });
$('#popTable').onopen = () => hl(0, 0);
for (const id of ['#popTblIns', '#popTblDel']) $(id).addEventListener('click', e => {
  const b = e.target.closest('[data-tbl]'); if (!b) return;
  closePops();
  editor.chain().focus()[b.dataset.tbl]().run();
});

/** The document range of the visual line the cursor is in. */
function currentLineRange() {
  const v = editor.view, sel = editor.state.selection, $p = sel.$from;
  if (!$p.parent.isTextblock || !$p.parent.content.size) return null;
  const k = v.coordsAtPos(sel.from), y = (k.top + k.bottom) / 2;
  const blk = v.nodeDOM($p.before());
  if (!blk || !blk.getBoundingClientRect) return null;
  const br = blk.getBoundingClientRect();
  const a = v.posAtCoords({ left: br.left + 1, top: y }), b = v.posAtCoords({ left: br.right - 1, top: y });
  const lo = $p.start(), hi = $p.end();
  const from = Math.max(lo, Math.min(hi, a ? a.pos : lo)), to = Math.max(lo, Math.min(hi, b ? b.pos : hi));
  return to > from ? { from, to } : null;
}

/* table tools */
function curTable() {
  if (tblCtx) {
    const table = editor.state.doc.nodeAt(tblCtx.pos);
    if (table && table.type.name === 'table') return { table, pos: tblCtx.pos, start: tblCtx.pos + 1, map: TableMap.get(table), rect: tblCtx.rect };
  }
  return tableContext(editor.state);
}
function reselectCells(c) {
  try {
    const { map, rect, start, table } = c;
    const pa = start + map.positionAt(rect.top, rect.left, table), pb = start + map.positionAt(rect.bottom - 1, rect.right - 1, table);
    if (pa !== pb) editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, pa, pb)));
  } catch (e) { /* ignore */ }
}
// scope: 'cells' = selected cells, 'cols' = selected columns in every row, 'table' = whole table
function forCells(scope, fn) {
  const c = curTable(); if (!c) return;
  const { map, rect, start, table } = c;
  const r = scope === 'table' ? { left: 0, top: 0, right: map.width, bottom: map.height }
    : scope === 'cols' ? { left: rect.left, right: rect.right, top: 0, bottom: map.height } : rect;
  const tr = editor.state.tr, seen = new Set();
  for (let row = r.top; row < r.bottom; row++) for (let col = r.left; col < r.right; col++) {
    const rel = map.map[row * map.width + col];
    if (seen.has(rel)) continue; seen.add(rel);
    const node = table.nodeAt(rel);
    const attrs = fn(node, row, col);
    if (attrs) tr.setNodeMarkup(start + rel, undefined, { ...node.attrs, ...attrs });
  }
  editor.view.dispatch(tr);
  reselectCells(curTable());
}
function fillTableFields() {
  const c = curTable(); if (!c) return;
  const act = document.activeElement;
  if (act !== $('#tpWidth')) $('#tpWidth').value = c.table.attrs.width || 100;
  const row = c.table.child(Math.min(c.rect.top, c.table.childCount - 1));
  if (act !== $('#tpRowH')) $('#tpRowH').value = row.attrs.height || '';
  const cell = c.table.nodeAt(c.map.map[c.rect.top * c.map.width + c.rect.left]);
  if (act !== $('#tpColW')) $('#tpColW').value = cell && cell.attrs.colwidth && cell.attrs.colwidth[0] ? Math.round(cell.attrs.colwidth[0] / MM * 10) / 10 : '';
  for (const b of $$('#tableBar [data-talign]')) b.classList.toggle('on', (c.table.attrs.align || 'left') === b.dataset.talign);
}
for (const id of ['#tpWidth', '#tpRowH', '#tpColW']) {
  $(id).addEventListener('focus', rememberTable);
  $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.dispatchEvent(new Event('change')); } });
}
function setTableAttrs(attrs) {
  const c = curTable(); if (!c) return;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(c.pos, undefined, { ...c.table.attrs, ...attrs }));
  reselectCells(curTable());
}
$('#tpWidth').addEventListener('change', e => {
  const pct = Math.max(10, Math.min(100, +e.target.value || 100));
  const c = curTable(); if (!c) return;
  const tr = editor.state.tr;
  tr.setNodeMarkup(c.pos, undefined, { ...c.table.attrs, width: pct === 100 ? null : pct });
  // if every column has a fixed width, scale them so the table gets the requested width
  const cells = []; let all = true, sum = 0;
  c.table.firstChild.forEach(cell => { const w = cell.attrs.colwidth; if (!w || !w[0]) all = false; else sum += w.reduce((x, y) => x + (y || 0), 0); });
  if (all && sum > 0) {
    const k = (editor.view.dom.clientWidth * pct / 100) / sum;
    c.table.descendants((n, rel) => { if (n.type.spec.tableRole && n.type.spec.tableRole.includes('cell') && n.attrs.colwidth) cells.push([rel, n]); return !n.type.spec.tableRole || !n.type.spec.tableRole.includes('cell'); });
    for (const [rel, n] of cells) tr.setNodeMarkup(c.start + rel, undefined, { ...n.attrs, colwidth: n.attrs.colwidth.map(w => Math.round(w * k)) });
  }
  editor.view.dispatch(tr);
  reselectCells(curTable());
});
$('#tpRowH').addEventListener('change', e => {
  const v = e.target.value === '' ? null : Math.max(3, +e.target.value);
  const c = curTable(); if (!c) return;
  const tr = editor.state.tr;
  c.table.forEach((row, o, i) => { if (i >= c.rect.top && i < c.rect.bottom) tr.setNodeMarkup(c.start + o, undefined, { ...row.attrs, height: v }); });
  editor.view.dispatch(tr);
  reselectCells(curTable());
});
$('#tpColW').addEventListener('change', e => {
  const v = e.target.value === '' ? null : Math.round(Math.max(5, +e.target.value) * MM);
  forCells('cols', n => n.attrs.colspan === 1 ? { colwidth: v ? [v] : null } : null);
});
let borderScope = 'cells';
$('#popBorders').addEventListener('click', e => {
  const sc = e.target.closest('[data-scope]');
  if (sc) { borderScope = sc.dataset.scope; for (const b of $$('#popBorders [data-scope]')) b.classList.toggle('on', b === sc); return; }
  const bw = e.target.closest('[data-bw]');
  if (bw) forCells(borderScope === 'table' ? 'table' : 'cells', () => ({ borderWidth: bw.dataset.bw === '' ? null : +bw.dataset.bw }));
});
swatches($('#swBorder'), ['#7d8590', '#111111', '#1f5f74', '#2e4a9e', '#c0392b', '#1e8449', '#b7950b'], c => forCells(borderScope === 'table' ? 'table' : 'cells', () => ({ borderColor: c === 'none' ? null : c })), 'Alapértelmezett');

/* ------------------------------------------------------------------ */
/* Pictures                                                            */
/* ------------------------------------------------------------------ */
const readURL = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
async function prepImage(file, maxSide = 3000) {
  const url = await readURL(file);
  if (/svg|gif/.test(file.type)) return url;
  return new Promise(res => {
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, maxSide / Math.max(im.width, im.height));
      if (k === 1 && file.size < 4e6) return res(url);                // keep the original for best print quality
      const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      const x = c.getContext('2d'), png = file.type === 'image/png';
      if (!png) { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); }
      x.drawImage(im, 0, 0, c.width, c.height);
      res(c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.92));
    };
    im.onerror = () => res(url); im.src = url;
  });
}
async function insertImageFile(file, pos) {
  const src = await prepImage(file);
  const node = { type: 'image', attrs: { src, wrap: 'wl' } };
  if (typeof pos === 'number') editor.chain().focus().insertContentAt(pos, node).run();
  else ch().insertContent(node).run();
}
$('#fileIn').addEventListener('change', async e => { const files = Array.from(e.target.files); e.target.value = ''; for (const f of files) await insertImageFile(f); });
function pickImage(maxSide, cb) {
  const inp = $('#pickIn');
  inp.onchange = async () => { const f = inp.files[0]; inp.value = ''; if (f) cb(await prepImage(f, maxSide)); };
  inp.click();
}

/* ------------------------------------------------------------------ */
/* Formula editor (Matekos Prezi) and live preview                     */
/* ------------------------------------------------------------------ */
function openMath(pos, node) {
  closePops(); showPreview(null);
  const sel = editor.state.selection;
  if (pos == null && sel instanceof NodeSelection && sel.node.type.name === 'math') { pos = sel.from; node = sel.node; }
  const editPos = node ? pos : null;
  let tex = node ? node.attrs.tex : '';
  if (!node && !sel.empty) tex = editor.state.doc.textBetween(sel.from, sel.to, ' ');
  const finish = () => { if (!editor.view.hasFocus()) editor.view.dom.focus({ preventScroll: true }); };
  openMathEditor({
    tex, editing: !!node, top: $('#app').getBoundingClientRect().bottom + 10, wrap: node ? !!node.attrs.wrap : true,
    onApply: (t, wrap) => {
      if (t == null) return finish();
      if (editPos != null) {
        const n = editor.state.doc.nodeAt(editPos);
        if (n && n.type.name === 'math') {
          const tr = editor.state.tr;
          if (!t) tr.delete(editPos, editPos + n.nodeSize); else tr.setNodeMarkup(editPos, undefined, { ...n.attrs, tex: t, wrap: !!wrap }, n.marks);
          editor.view.dispatch(tr);
        }
        return finish();
      }
      if (t) editor.chain().focus().insertContent({ type: 'math', attrs: { tex: t, display: false, wrap: !!wrap } }).run();
      else finish();
    },
    onDelete: () => {
      const n = editPos != null && editor.state.doc.nodeAt(editPos);
      if (n && n.type.name === 'math') editor.view.dispatch(editor.state.tr.delete(editPos, editPos + n.nodeSize));
      finish();
    }
  });
}

const mprev = $('#mprev');
function showPreview(p) {
  if (!p) { mprev.hidden = true; return; }
  mprev.innerHTML = '<div class="mp-m"></div><div class="mp-hint">Írj $ jelet a képlet lezárásához</div>';
  const box = mprev.firstChild;
  mprev.hidden = false;
  const place = () => {
    mprev.style.left = Math.max(8, Math.min(p.coords.left - 12, innerWidth - mprev.offsetWidth - 8)) + 'px';
    let top = p.coords.bottom + 8;
    if (top + mprev.offsetHeight > innerHeight - 8) top = p.coords.top - mprev.offsetHeight - 8;
    mprev.style.top = top + 'px';
  };
  renderInto(box, p.tex, false, place);
  place();
}

/* ------------------------------------------------------------------ */
/* Side panels: page list (left), template editor (right)              */
/* ------------------------------------------------------------------ */
const lsGet = k => load(k), lsSet = (k, v) => store(k, v);
const LSK = { left: 'matekosdoksi.leftw', right: 'matekosdoksi.rightw', panel: 'matekosdoksi.panel', sections: 'matekosdoksi.sections' };
const mainEl = $('#main'), plist = $('#plist'), props = $('#props');
function setLeftWidth(w) { w = Math.max(120, Math.min(420, Math.round(w))); document.body.style.setProperty('--lw', w + 'px'); mainEl.style.setProperty('--lw', w + 'px'); return w; }
function setRightWidth(w) { w = Math.max(260, Math.min(560, Math.round(w))); document.body.style.setProperty('--rw', w + 'px'); mainEl.style.setProperty('--rw', w + 'px'); return w; }
setLeftWidth(+lsGet(LSK.left) || 176); setRightWidth(+lsGet(LSK.right) || 320);
function splitter(el, get, set, key, sign) {
  el.addEventListener('pointerdown', e => {
    e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('drag');
    const x0 = e.clientX, w0 = get();
    const mv = ev => { set(w0 + sign * (ev.clientX - x0)); applyZoom(); thumbsSoon(); };
    const up = ev => { el.releasePointerCapture(ev.pointerId); el.classList.remove('drag'); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up);
      lsSet(key, String(set(w0 + sign * (ev.clientX - x0)))); applyZoom(); thumbsSoon(true); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  });
}
splitter($('#lsplit'), () => $('#pagesNav').getBoundingClientRect().width, setLeftWidth, LSK.left, 1);
splitter($('#rsplit'), () => props.getBoundingClientRect().width, setRightWidth, LSK.right, -1);
function panelVisible(v) {
  mainEl.classList.toggle('noprops', !v); document.body.classList.toggle('noprops-on', !v);
  $('#bTpl').classList.toggle('primary', v); lsSet(LSK.panel, v ? '1' : '0'); applyZoom();
  if (v) fillPanel();
}
$('#bTpl').addEventListener('click', () => panelVisible(mainEl.classList.contains('noprops')));
$('#propsX').addEventListener('click', () => panelVisible(false));
$('#panelOpen').addEventListener('click', () => panelVisible(true));
let secState = {}; try { secState = JSON.parse(lsGet(LSK.sections) || '{}'); } catch (e) { secState = {}; }
for (const sec of $$('#props .psec')) sec.classList.toggle('closed', !!secState[sec.dataset.sec]);
props.addEventListener('click', e => {
  const t = e.target.closest('[data-sec-toggle]'); if (!t) return;
  const k = t.dataset.secToggle; secState[k] = !secState[k]; lsSet(LSK.sections, JSON.stringify(secState));
  t.closest('.psec').classList.toggle('closed', !!secState[k]);
});

/* page list: a live miniature of every page; click = go to the page */
let thumbT = 0, curPage = 0;
function thumbsSoon(now) { clearTimeout(thumbT); thumbT = setTimeout(renderThumbs, now ? 0 : 450); }
function renderThumbs() {
  if (!$('#home').hidden) return;
  const g = geometry(tpl), dom = editor.view.dom;
  const fw = Math.max(60, plist.clientWidth - 22 - 4 - 18), k = fw / g.W, fh = Math.round(g.H * k);
  const kids = Array.from(dom.children).map(c => ({ el: c, top: g.mt + c.offsetTop, bottom: g.mt + c.offsetTop + c.offsetHeight }));
  const style = dom.getAttribute('style') || '';
  const frag = document.createDocumentFragment();
  for (let i = 0; i < pageCount; i++) {
    const t = document.createElement('div');
    t.className = 'thumb' + (i === curPage ? ' cur' : ''); t.dataset.i = i;
    t.innerHTML = `<div class="no">${i + 1}</div><div class="frame" style="width:${fw}px;height:${fh}px"><div class="tpage" style="width:${g.W}px;height:${g.H}px;transform:scale(${k})">${sheetHTML(i, pageCount, tpl, $('#docTitle').value, g, 0, 0)}</div></div>`;
    const tp = t.querySelector('.tpage');
    // line shading of this page
    const bands = document.createElement('div');
    bands.style.cssText = `position:absolute;left:${-g.sheetX(i)}px;top:${-i * g.P}px`;
    bands.innerHTML = $('#shadeLayer').innerHTML;
    for (const d of bands.children) d.style.position = 'absolute';
    tp.appendChild(bands);
    // the blocks that reach into this page (exactly as laid out in the editor)
    const top = i * g.P, bot = top + g.H;
    const parts = kids.filter(c => c.bottom > top - 2 && c.top < bot + 2);
    if (parts.length) {
      const c = document.createElement('div');
      c.className = 'ProseMirror'; c.setAttribute('style', style);
      c.style.left = g.leftOf(i) + 'px'; c.style.top = (parts[0].top - top) + 'px'; c.style.minHeight = '0';
      for (const p of parts) c.appendChild(p.el.cloneNode(true));
      tp.appendChild(c);
    }
    frag.appendChild(t);
  }
  plist.replaceChildren(frag);
}
plist.addEventListener('click', e => {
  const t = e.target.closest('.thumb'); if (!t) return;
  const g = geometry(tpl), i = +t.dataset.i;
  pickedAt = Date.now();
  ws.scrollTo({ top: outer.offsetTop + i * g.P * scale - 12, behavior: 'smooth' });
  setCurPage(i);
});
function setCurPage(i) {
  if (i === curPage) return;
  curPage = i;
  for (const t of plist.children) t.classList.toggle('cur', +t.dataset.i === i);
  const el = plist.children[i]; if (el) el.scrollIntoView({ block: 'nearest' });
}
let pickedAt = 0;
ws.addEventListener('scroll', () => {
  if (Date.now() - pickedAt < 900) return;                 // just clicked a page in the list
  const g = geometry(tpl);
  if (ws.scrollTop + ws.clientHeight >= ws.scrollHeight - 2) return setCurPage(pageCount - 1);
  const y = (ws.scrollTop + ws.clientHeight * 0.35 - outer.offsetTop) / scale;
  setCurPage(Math.max(0, Math.min(pageCount - 1, Math.floor(y / g.P))));
}, { passive: true });

/* template editor (right panel) */
const getPath = (o, p) => p.split('.').reduce((a, k) => a && a[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'), last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
let hfVariant = 'odd';
function hfTabs() {
  const tabs = [['odd', tpl.oddEven ? 'Páratlan oldalak' : 'Minden oldal']];
  if (tpl.oddEven) tabs.push(['even', 'Páros oldalak']);
  if (tpl.firstDiff) tabs.push(['first', 'Első oldal']);
  if (!tabs.find(t => t[0] === hfVariant)) hfVariant = 'odd';
  $('#hfTabs').innerHTML = tabs.map(([k, l]) => `<button data-v="${k}" class="${k === hfVariant ? 'on' : ''}">${l}</button>`).join('');
  const block = kind => {
    const sl = tpl[kind][hfVariant], base = `${kind}.${hfVariant}`;
    const picRow = (pos, label) => {
      const pic = sl.img[pos];
      return `<div class="hfpic"><span class="hfpl">${label}</span><div class="imgpick">${pic.src ? `<img src="${esc(pic.src)}" alt="">` : ''}<button class="btn" data-pickimg="${base}.img.${pos}.src">${pic.src ? 'Csere…' : 'Kép…'}</button>${pic.src ? `<button class="btn" data-clearimg="${base}.img.${pos}.src">Eltávolítás</button><label class="mini-l">Magasság <input type="number" min="3" max="80" step="1" data-k="${base}.img.${pos}.h"> mm</label>` : ''}</div></div>`;
    };
    return `<h4>${kind === 'header' ? 'Élőfej' : 'Élőláb'}</h4>
      <div class="fgrid three">
        <label class="fld">Bal<textarea rows="2" data-k="${base}.l"></textarea></label>
        <label class="fld">Közép<textarea rows="2" data-k="${base}.c"></textarea></label>
        <label class="fld">Jobb<textarea rows="2" data-k="${base}.r"></textarea></label>
      </div>
      ${picRow('l', 'Bal')}${picRow('c', 'Közép')}${picRow('r', 'Jobb')}`;
  };
  $('#hfEditor').innerHTML = block('header') + block('footer');
}
const STYLE_ROWS = [['body', 'Normál szöveg', 'a dokumentum alapszövege'], ['h1', 'Címsor 1', ''], ['h2', 'Címsor 2', ''], ['h3', 'Címsor 3', '']];
function styleRows() {
  $('#styleRows').innerHTML = STYLE_ROWS.map(([k, label, hint]) => {
    const body = k === 'body', st = body ? { size: tpl.size, color: tpl.color } : tpl.styles[k];
    const sk = body ? 'size' : `styles.${k}.size`, ck = body ? 'color' : `styles.${k}.color`;
    return `<div class="strow"><div class="sthead"><b>${label}</b>${hint ? `<span class="phint">${hint}</span>` : ''}</div>
      <div class="stctl"><input type="number" class="stsize" min="5" max="96" step="0.5" data-k="${sk}" title="Betűméret (pt)"><span class="unit">pt</span>
        <label class="colbtn btn" title="Betűszín"><input type="color" class="hidecolor" data-k="${ck}"><i class="dot fill" style="--c:${esc(st.color)}"></i>Szín</label>
        ${body ? '' : ['bold', 'italic', 'underline'].map(t => `<button class="tb${st[t] ? ' on' : ''}" data-stt="${t}" data-st="${k}" title="${{ bold: 'Félkövér', italic: 'Dőlt', underline: 'Aláhúzott' }[t]}">${{ bold: '<b>B</b>', italic: '<i>I</i>', underline: '<u>U</u>' }[t]}</button>`).join('')}</div></div>`;
  }).join('');
}
function fillPanel() {
  hfTabs(); styleRows();
  for (const el of $$('#props [data-k]')) {
    const v = getPath(tpl, el.dataset.k);
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.type === 'radio') el.checked = el.value === v;
    else el.value = v ?? '';
  }
  $('#hcDot').style.setProperty('--c', tpl.headerColor); $('#fcDot').style.setProperty('--c', tpl.footerColor);
  $('#wmThumb').src = tpl.wm.img || ''; $('#wmThumb').hidden = !tpl.wm.img;
  $('#wmText').hidden = tpl.wm.type !== 'text';
  $('#wmImage').hidden = tpl.wm.type !== 'image';
  $$('[data-mirror-label]').forEach(s => { s.textContent = tpl.mirror ? (s.dataset.mirrorLabel === 'left' ? 'Belső margó (mm)' : 'Külső margó (mm)') : (s.dataset.mirrorLabel === 'left' ? 'Bal margó (mm)' : 'Jobb margó (mm)'); });
}
function tplChanged() { markDirty(); applyTpl(); saveSoon(); }
function onPanelInput(e) {
  const el = e.target, k = el.dataset && el.dataset.k; if (!k) return;
  if (el.tagName === 'TEXTAREA') { setPath(tpl, k, el.value); tplChanged(); return; }
  let v = el.type === 'checkbox' ? el.checked : (el.type === 'number' || el.type === 'range') ? parseFloat(el.value) : el.value;
  if (typeof v === 'number' && isNaN(v)) return;
  if (el.type === 'radio' && !el.checked) return;
  setPath(tpl, k, v);
  if (el.type === 'color') { const dot = el.parentElement.querySelector('.dot'); if (dot) dot.style.setProperty('--c', v); }
  if (k === 'oddEven' || k === 'firstDiff' || k === 'mirror' || k === 'wm.type') fillPanel();
  tplChanged();
}
props.addEventListener('input', onPanelInput);
props.addEventListener('change', onPanelInput);
props.addEventListener('click', e => {
  const b = e.target.closest('[data-stt]'); if (!b) return;
  const st = tpl.styles[b.dataset.st]; st[b.dataset.stt] = !st[b.dataset.stt]; b.classList.toggle('on', st[b.dataset.stt]); tplChanged();
});
$('#hfTabs').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { hfVariant = b.dataset.v; fillPanel(); } });
$('#hfEditor').addEventListener('click', e => {
  const p = e.target.closest('[data-pickimg]'), c = e.target.closest('[data-clearimg]');
  if (p) pickImage(1600, url => { setPath(tpl, p.dataset.pickimg, url); fillPanel(); tplChanged(); });
  if (c) { setPath(tpl, c.dataset.clearimg, ''); fillPanel(); tplChanged(); }
});
$('#wmPick').addEventListener('click', () => pickImage(2400, url => { tpl.wm.img = url; tpl.wm.type = 'image'; fillPanel(); tplChanged(); }));
$('#wmClear').addEventListener('click', () => { tpl.wm.img = ''; fillPanel(); tplChanged(); });
const tplMsg = t => { const m = $('#tplMsg'); m.textContent = t; clearTimeout(m._t); m._t = setTimeout(() => { m.textContent = ''; }, 4000); };
$('#tplSave').addEventListener('click', () => tplMsg(store(LS_TPL, JSON.stringify(tpl)) ? 'Elmentve. Az új dokumentumok ebből a sablonból indulnak.' : 'A sablon mentése nem sikerült.'));
$('#tplLoad').addEventListener('click', () => { const s = load(LS_TPL); if (!s) return tplMsg('Még nincs mentett sablon.'); tpl = normalizeTpl(JSON.parse(s)); fillPanel(); markDirty(); applyTpl(true); saveSoon(); tplMsg('Sablon alkalmazva.'); });
$('#tplReset').addEventListener('click', () => { tpl = normalizeTpl(DEFAULT_TPL); fillPanel(); markDirty(); applyTpl(true); saveSoon(); tplMsg('Alapbeállítások visszaállítva.'); });
const startTpl = () => { const s = load(LS_TPL); try { return normalizeTpl(s ? JSON.parse(s) : DEFAULT_TPL); } catch (e) { return normalizeTpl(DEFAULT_TPL); } };

/* ------------------------------------------------------------------ */
/* Documents (Matekos Prezi behaviour): own file, Save as, renaming,   */
/* status, autosave, home screen, confirmations                        */
/* ------------------------------------------------------------------ */
let dirty = false, sessionOpen = false, autoT = 0;
function setStatus(t) {
  const f = currentFileName(), st = $('#status');
  st.className = 'status ' + (t ? 'msg' : dirty || !f ? 'unsaved' : 'saved');
  st.textContent = t || (dirty ? 'Nem mentett' : f ? 'Mentve' : 'Még nincs mentve');
  st.title = f ? 'A dokumentum fájlja: ' + f : 'A dokumentum még nincs fájlba mentve';
}
function flash(t) { setStatus(t); toast(t); clearTimeout(flash._t); flash._t = setTimeout(() => setStatus(), 2600); }
function markDirty() { if (!dirty) { dirty = true; setStatus(); } }
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 2800); }
function confirmBox(msg, yes = 'Igen') {
  return new Promise(res => {
    const box = $('#cfm'); $('#cfmMsg').textContent = msg; $('#cfmYes').textContent = yes; box.hidden = false; $('#cfmYes').focus();
    const done = v => { box.hidden = true; removeEventListener('keydown', key, true); $('#cfmYes').onclick = $('#cfmNo').onclick = null; res(v); };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); } };
    addEventListener('keydown', key, true);
    $('#cfmYes').onclick = () => done(true); $('#cfmNo').onclick = () => done(false);
  });
}
const docTitle = () => $('#docTitle').value.trim() || 'Névtelen dokumentum';
function docData() { return { title: docTitle(), tpl, doc: editor.getJSON() }; }
const autoValue = () => ({ ...docData(), path: getCurrentPath(), dirty });
function saveSoon() { clearTimeout(autoT); autoT = setTimeout(saveLocal, 900); }
async function saveLocal() {
  if (await autosave(autoValue())) return;
  setStatus('Az automatikus mentés nem sikerült');
}
/** The title box always shows the document's file name (after Save as, opening, renaming). */
function titleFromFile() { const f = currentFileName(); if (f) $('#docTitle').value = titleOfFile(f); }
async function renameFromTitle() {
  const t = docTitle(); $('#docTitle').value = t;
  renderSheets(pagesEl, pageCount, tpl, t, true); thumbsSoon();
  if (!currentFileName()) { saveSoon(); return; }
  try {
    const n = await renameCurrentFile(t);
    if (n) { $('#docTitle').value = titleOfFile(n); toast('Átnevezve: ' + n); }
    saveSoon(); setStatus();
  } catch (e) { toast('Az átnevezés nem sikerült: ' + (e && e.message || e)); titleFromFile(); }
}
$('#docTitle').addEventListener('change', renameFromTitle);
$('#docTitle').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
function loadData(d) {
  tpl = normalizeTpl(d.tpl || {});
  $('#docTitle').value = d.title || 'Névtelen dokumentum';
  if (d.doc) editor.commands.setContent(d.doc, { emitUpdate: false });
  else if (typeof d.html === 'string') editor.commands.setContent(d.html, { emitUpdate: false });   // documents from the first prototype
  fillPanel(); applyTpl(true);
}
function busy(msg) { $('#busyMsg').textContent = msg || ''; $('#busy').hidden = !msg; }
async function ready() {
  await mathReady;
  await document.fonts.ready;
  // wait until every formula is drawn and layout is settled
  for (let i = 0; i < 60 && $$('.math .mpending', editor.view.dom).length; i++) await new Promise(r => setTimeout(r, 50));
  editor.storage.pagination.relayoutNow();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}
async function makePdf() {
  const sel = editor.state.selection;
  editor.commands.blur();
  editor.commands.setTextSelection(0 < editor.state.doc.content.size ? 1 : 0);
  await ready();
  try {
    return await buildPDF({ editorDom: editor.view.dom, pagesEl, stackEl: stack, scale, tpl, pages: pageCount, title: docTitle() });
  } finally {
    try { editor.view.dispatch(editor.state.tr.setSelection(sel.map(editor.state.doc, editor.state.tr.mapping))); } catch (e) { /* ignore */ }
  }
}
async function doSave(saveAs) {
  closePops();
  if (isMathEditorOpen()) applyMathEditor();
  try {
    const msg = await saveDocument(docData(), saveAs);
    if (msg === 'Mentve') { titleFromFile(); dirty = false; saveSoon(); setStatus(); }
    else flash(msg);
  } catch (e) { flash('A mentés nem sikerült: ' + (e && e.message || e)); }
}
async function doPdf() {
  closePops(); busy('PDF készítése…');
  try { const blob = await makePdf(); busy(''); flash(await savePdfBlob(blob, docTitle())); }
  catch (e) { busy(''); flash('A PDF elkészítése nem sikerült: ' + (e && e.message || e)); }
}
async function doPrint() {
  closePops();
  // the exact PDF opens in the system PDF viewer, which prints it at true paper size
  busy('Nyomtatás előkészítése…');
  try { const blob = await makePdf(); busy(''); flash(await printPdfBlob(blob, docTitle())); }
  catch (e) { busy(''); flash('A nyomtatás nem sikerült: ' + (e && e.message || e)); }
}
function openedDocument(r) {
  if (!r) return false;
  if (r.error) { toast('Ez a fájl nem Matekos Doksi dokumentum.'); return false; }
  setCurrentPath(r.path && /\.mdoksi$/i.test(r.path) ? r.path : null);
  loadData(r.data);
  $('#docTitle').value = titleOfFile(r.name) || r.data.title || 'Névtelen dokumentum';   // the file's own name
  dirty = false; sessionOpen = true; saveSoon(); setStatus();
  toast('Megnyitva: ' + r.name);
  showHome(false);
  return true;
}
async function doOpen() {
  closePops();
  if (dirty && $('#home').hidden && !await confirmBox('A nem mentett módosítások elvesznek. Megnyitsz egy másik dokumentumot?', 'Megnyitás')) return false;
  try { return openedDocument(await openDocumentFile()); }
  catch (e) { toast('A fájl nem nyitható meg: ' + (e && e.message || e)); return false; }
}
async function openPath(p) {
  try { return openedDocument(await openPathFile(p)); }
  catch (e) { toast('A fájl nem nyitható meg: ' + (e && e.message || e)); showHome(true); return false; }
}
async function newDocument() {
  closePops();
  if (dirty && $('#home').hidden && !await confirmBox('Új dokumentumot kezdesz. A mostani nem mentett módosításai elvesznek. Folytatod?', 'Új dokumentum')) return false;
  tpl = startTpl(); $('#docTitle').value = 'Névtelen dokumentum'; setCurrentPath(null);
  editor.commands.setContent('<p></p>'); fillPanel(); applyTpl(true);
  dirty = false; sessionOpen = true; setStatus(); saveSoon();
  showHome(false); editor.commands.focus();
  return true;
}
/* top bar menus */
$('#bSave').addEventListener('click', () => doSave(false));
$('#fSaveAs').addEventListener('click', () => doSave(true));
$('#fNew').addEventListener('click', newDocument);
$('#fOpen').addEventListener('click', doOpen);
$('#fHome').addEventListener('click', () => { closePops(); sessionOpen = true; clearTimeout(autoT); saveLocal(); showHome(true); });
$('#expPdf').addEventListener('click', doPdf);
$('#expPrint').addEventListener('click', doPrint);
$('#bFile').addEventListener('click', e => showPop('popFile', e.currentTarget));
$('#bExport').addEventListener('click', e => showPop('popExport', e.currentTarget));
$('#bZoom').addEventListener('click', e => showPop('popZoom', e.currentTarget));
$('#popZoom').onopen = () => { for (const b of $$('#popZoom [data-zoom]')) b.classList.toggle('on', b.dataset.zoom === String(zoomMode)); };
$('#popZoom').addEventListener('click', e => {
  const b = e.target.closest('[data-zoom]'); if (!b) return; closePops();
  zoomMode = b.dataset.zoom; $('#zoomLabel').textContent = zoomMode === 'auto' ? '' : zoomMode + '%'; applyZoom();
});

/* home screen (as in Matekos Prezi) */
let resumeLabel = '';
function showHome(show) {
  $('#home').hidden = !show;
  if (show) {
    const f = currentFileName();
    $('#homeResume').hidden = !(sessionOpen || f || resumeLabel);
    $('#homeResume').textContent = f ? `Folytatás: ${f}` : sessionOpen ? 'Vissza a megnyitott dokumentumhoz' : resumeLabel;
  } else { relayout(0); thumbsSoon(true); }
}
$('#homeNew').addEventListener('click', newDocument);
$('#homeOpen').addEventListener('click', doOpen);
$('#homeResume').addEventListener('click', () => { sessionOpen = true; showHome(false); });

document.addEventListener('keydown', e => {
  const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
  if (!mod) return;
  const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); doSave(e.shiftKey); }
  else if (k === 'o') { e.preventDefault(); doOpen(); }
  else if (k === 'p') { e.preventDefault(); doPrint(); }
});
addEventListener('resize', () => { applyZoom(); closePops(); thumbsSoon(); });
ws.addEventListener('scroll', () => { closePops(); }, { passive: true });
function quitBox() {
  return new Promise(res => {
    const box = $('#cfm'), extra = document.createElement('button');
    extra.className = 'btn'; extra.textContent = 'Mentés és kilépés';
    $('#cfmMsg').textContent = 'A dokumentumban nem mentett módosítások vannak. Kilépsz mentés nélkül?';
    $('#cfmYes').textContent = 'Kilépés mentés nélkül'; $('#cfmNo').after(extra); box.hidden = false;
    const done = v => { box.hidden = true; extra.remove(); $('#cfmYes').onclick = $('#cfmNo').onclick = null; res(v); };
    $('#cfmYes').onclick = () => done('quit'); $('#cfmNo').onclick = () => done('stay'); extra.onclick = () => done('save');
  });
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */
(async function init() {
  $('#homeVer').textContent = 'v' + APP_VERSION;
  $('.home-logo-img').src = APP_ICON;
  if (lsGet(LSK.panel) === '0') { mainEl.classList.add('noprops'); document.body.classList.add('noprops-on'); } else $('#bTpl').classList.add('primary');
  let d = await loadAutosave();
  if (!d) {    // earlier versions kept the autosave in localStorage
    try { d = JSON.parse(load(LS_DOC) || load(OLD_DOC) || 'null'); } catch (e) { d = null; }
    if (!load(LS_TPL) && load(OLD_TPL)) store(LS_TPL, load(OLD_TPL));
    if (!d) { try { const v1 = JSON.parse(load('kiadvany.doc.v1') || 'null'); if (v1 && v1.html) d = v1; } catch (e) { /* none */ } }
  }
  if (d && (d.doc || d.html)) {
    loadData(d);
    if (d.path) {
      setCurrentPath(d.path);
      // renamed or moved outside the app since the last session: the old place is no longer used
      if (!await currentFileExists()) { toast(`A(z) „${d.path.split(/[\\/]/).pop()}” fájl már nincs a korábbi helyén – mentéskor új helyet kérdez.`); setCurrentPath(null); }
      else titleFromFile();
    }
    dirty = !!d.dirty;
    resumeLabel = 'Legutóbbi dokumentum folytatása';
  } else {
    tpl = startTpl(); $('#docTitle').value = 'Trigonometria'; editor.commands.setContent(SAMPLE_HTML, { emitUpdate: false }); fillPanel(); applyTpl(true);
    resumeLabel = 'Mintadokumentum megtekintése';
  }
  setStatus();
  loadFonts().then(() => relayout(0));
  document.fonts && document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', () => relayout(30));
  mathReady.then(() => relayout(100));
  // the app starts on the home screen – unless it was opened by double-clicking a document
  showHome(true);
  if (isTauri()) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window'), win = getCurrentWindow();
      win.onCloseRequested(async ev => {
        if (!dirty) return;
        ev.preventDefault();
        const r = await quitBox();
        if (r === 'stay') return;
        if (r === 'save') { await doSave(false); if (dirty) return; }
        clearTimeout(autoT); await autosave({ ...autoValue(), dirty: false }); await win.destroy();
      });
    } catch (e) { /* not available */ }
    try { const p = await watchOpenedFiles(openPath); if (p) await openPath(p); }
    catch (e) { /* not available */ }
  }
})();

// Hooks for automated layout/print tests
window.mdoksi = { editor, makePdf, get tpl() { return tpl; }, set tpl(t) { tpl = normalizeTpl(t); applyTpl(true); }, get pages() { return pageCount; }, ready, setZoom: z => { zoomMode = z; applyZoom(); }, renderThumbs };
