import './styles.css';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color, FontSize } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { Table, TableRow } from '@tiptap/extension-table';
import { ListItem } from '@tiptap/extension-list';
import { NodeSelection } from '@tiptap/pm/state';

import { loadFonts } from './fonts.js';
import { startMathJax, renderInto, opts as mathOpts, clearMathCache, mathReady } from './math.js';
import { DEFAULT_TPL, normalizeTpl, geometry, GAP, MM } from './template.js';
import { renderSheets, sheetHTML, esc } from './pages.js';
import { ParaFormat, KvBulletList, KvOrderedList, ListMarkers, KvTableCell, KvTableHeader, PageBreak, MathNode, KvImage } from './editor/extensions.js';
import { Pagination } from './editor/pagination.js';
import { buildPDF } from './pdf.js';
import { isTauri, saveEditable, openDocumentFile, savePdfBlob, printPdfBlob, setCurrentPath } from './files.js';
import { SAMPLE_HTML } from './sample.js';
import { svg } from './icons.js';

const $ = s => document.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const LS_DOC = 'matekosdoksi.v2.doc', LS_TPL = 'matekosdoksi.v2.tpl';
const OLD_DOC = 'kiadvany.v2.doc', OLD_TPL = 'kiadvany.v2.tpl';   // earlier test versions
const store = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
const load = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const setStatus = t => { $('#status').textContent = t || ''; };

let tpl = normalizeTpl(DEFAULT_TPL);
let zoomMode = 'auto', scale = 1, pageCount = 1;
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
    TextStyle, Color, FontSize,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Subscript, Superscript,
    Table.configure({ resizable: true, cellMinWidth: 24, lastColumnResizable: false }), TableRow, KvTableHeader, KvTableCell,
    ParaFormat, PageBreak,
    MathNode.configure({
      onEdit: (pos, node) => openMath(pos, node),
      onRendered: () => relayout(60),
      onPreview: p => showPreview(p)
    }),
    KvImage.configure({ getScale: () => scale, icons: { wrapL: svg('wrapL'), wrapR: svg('wrapR'), center: svg('center'), inline: svg('inline'), trash: svg('trash') } }),
    Pagination.configure({ getTpl: () => tpl, getScale: () => scale, onLayout: n => applyLayout(n) })
  ],
  content: '<p></p>',
  editorProps: {
    attributes: { spellcheck: 'true', lang: 'hu' },
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
  onUpdate: () => saveSoon(),
  onSelectionUpdate: () => updateToolbar(),
  onTransaction: () => updateToolbar()
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
}
function applyZoom() {
  const g = geometry(tpl);
  const stackW = Math.max(g.sheetX(0), g.sheetX(1)) + g.W;
  scale = zoomMode === 'auto' ? Math.min(1, (ws.clientWidth - 24) / stackW) : (+zoomMode / 100);
  if (!(scale > 0)) scale = 1;
  stack.style.transform = `scale(${scale})`;
  outer.style.width = stackW * scale + 'px';
  outer.style.height = (parseFloat(stack.style.height) || g.H) * scale + 'px';
}
function applyTpl(rerenderMath) {
  const dom = editor.view.dom;
  dom.style.fontSize = tpl.size + 'pt';
  dom.style.color = tpl.color;
  dom.style.lineHeight = String(tpl.line);
  dom.style.setProperty('--after', tpl.after + 'pt');
  if (mathOpts.hunTrig !== tpl.hunTrig || mathOpts.decComma !== tpl.decComma || rerenderMath) {
    mathOpts.hunTrig = tpl.hunTrig; mathOpts.decComma = tpl.decComma; clearMathCache();
    // force math node views to repaint
    for (const m of $$('.math', dom)) { const t = m.getAttribute('data-tex'); renderInto(m, t, m.classList.contains('disp'), () => relayout(60)); }
  }
  applyLayout(pageCount);
  relayout(0);
}

/* ------------------------------------------------------------------ */
/* Toolbar                                                             */
/* ------------------------------------------------------------------ */
for (const b of $$('[data-icon]')) b.insertAdjacentHTML('afterbegin', svg(b.dataset.icon));
const ch = () => editor.chain().focus();
const COMMANDS = {
  undo: () => ch().undo().run(),
  redo: () => ch().redo().run(),
  bold: () => ch().toggleBold().run(),
  italic: () => ch().toggleItalic().run(),
  underline: () => ch().toggleUnderline().run(),
  strike: () => ch().toggleStrike().run(),
  superscript: () => ch().toggleSuperscript().run(),
  subscript: () => ch().toggleSubscript().run(),
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
  alignLeft: () => editor.isActive({ textAlign: 'left' }), alignCenter: () => editor.isActive({ textAlign: 'center' }),
  alignRight: () => editor.isActive({ textAlign: 'right' }), alignJustify: () => editor.isActive({ textAlign: 'justify' }),
  bulletList: () => editor.isActive('bulletList'), orderedList: () => editor.isActive('orderedList')
};
let tbRaf = 0;
function updateToolbar() {
  if (tbRaf) return;
  tbRaf = requestAnimationFrame(() => {
    tbRaf = 0;
    for (const b of $$('[data-state]')) b.classList.toggle('on', !!(STATES[b.dataset.state] && STATES[b.dataset.state]()));
    const { from } = editor.state.selection;
    let el = null;
    try { const d = editor.view.domAtPos(from); el = d.node.nodeType === 1 ? d.node : d.node.parentElement; } catch (e) { /* ignore */ }
    if (el && editor.view.dom.contains(el)) {
      const cs = getComputedStyle(el);
      if (document.activeElement !== $('#sizeIn')) $('#sizeIn').value = Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2;
      $('#colorBar').style.background = cs.color;
    }
    $('#styleSel').value = editor.isActive('heading', { level: 1 }) ? 'h1' : editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p';
    $('#tableBar').hidden = !editor.isActive('table');
    for (const b of $$('[data-valign]')) b.classList.toggle('on', (editor.getAttributes('tableCell').vAlign || editor.getAttributes('tableHeader').vAlign || 'top') === b.dataset.valign);
  });
}
for (const bar of [$('#ribbon'), $('#tableBar')]) {
  bar.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
  bar.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.pop) return showPop(b.dataset.pop, b);
    if (b.dataset.cmd && COMMANDS[b.dataset.cmd]) return COMMANDS[b.dataset.cmd]();
    if (b.dataset.tbl) return editor.chain().focus()[b.dataset.tbl]().run();
    if (b.dataset.valign) return ch().setCellAttribute('vAlign', b.dataset.valign).run();
  });
}
$('#styleSel').addEventListener('change', e => {
  const v = e.target.value;
  if (v === 'p') ch().setParagraph().run(); else ch().setHeading({ level: +v[1] }).run();
});
const setSize = v => { const p = parseFloat(String(v).replace(',', '.')); if (p > 0 && p < 500) ch().setFontSize(p + 'pt').run(); };
$('#sizeIn').addEventListener('change', e => setSize(e.target.value));
$('#sizeIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); setSize(e.target.value); } });

/* popovers */
let openPop = null, openAnchor = null;
function showPop(id, anchor) {
  const p = $('#' + id);
  if (openPop === p) return closePops();
  closePops();
  if (p.onopen) p.onopen();
  p.hidden = false;
  const r = anchor.getBoundingClientRect();
  p.style.left = Math.max(8, Math.min(r.left, innerWidth - p.offsetWidth - 8)) + 'px';
  p.style.top = (r.bottom + 6) + 'px';
  openPop = p; openAnchor = anchor;
}
function closePops() { if (openPop) { openPop.hidden = true; openPop = null; openAnchor = null; } }
document.addEventListener('pointerdown', e => { if (openPop && !openPop.contains(e.target) && !(openAnchor && openAnchor.contains(e.target))) closePops(); }, true);
for (const p of $$('.pop')) p.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });

function swatches(box, colors, onPick, noneLabel) {
  box.innerHTML = colors.map(c => `<button class="sw" data-c="${c}" style="background:${c}" title="${c}" aria-label="${c}"></button>`).join('')
    + '<label class="sw custom" title="Custom color"><input type="color" aria-label="Custom color"></label>'
    + (noneLabel ? `<button class="sw none" data-c="none">${noneLabel}</button>` : '');
  box.addEventListener('click', e => { const b = e.target.closest('button[data-c]'); if (b) { onPick(b.dataset.c); closePops(); } });
  box.querySelector('input').addEventListener('change', e => { onPick(e.target.value); closePops(); });
}
swatches($('#swText'), ['#111111', '#5d6875', '#c0392b', '#d35400', '#b7950b', '#1e8449', '#117a65', '#1f5f74', '#2e4a9e', '#7d3c98', '#ad1457'], c => ch().setColor(c).run());
swatches($('#swHi'), ['#fff176', '#c5f0a4', '#b3ecf5', '#f8bbd0', '#ffd59e', '#e1bee7', '#e0e0e0'], c => c === 'none' ? ch().unsetHighlight().run() : ch().setHighlight({ color: c }).run(), 'No highlight');
swatches($('#swShade'), ['#dbe9ee', '#e8eef5', '#eaf4e4', '#fdf3d7', '#f9e1e1', '#ece6f5', '#eeeeee'], c => ch().setParaAttrs({ shade: c === 'none' ? null : c }).run(), 'No shading');
swatches($('#swCell'), ['#e8eef5', '#eaf4e4', '#fdf3d7', '#f9e1e1', '#ece6f5', '#eeeeee', '#d6e4f0'], c => ch().setCellAttribute('background', c === 'none' ? null : c).run(), 'No fill');

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
$('#bulCustomBtn').addEventListener('click', () => { const v = $('#bulCustom').value.trim(); if (v) { closePops(); setBullet({ bulletChar: v, bulletImage: '' }); } });
$('#bulPicBtn').addEventListener('click', () => pickImage(512, url => { closePops(); setBullet({ bulletImage: url, bulletChar: '', bulletSize: +$('#bulPicSize').value || 0.9 }); }));
$('#bulPicSize').addEventListener('change', e => { if (editor.isActive('bulletList')) ch().updateAttributes('bulletList', { bulletSize: +e.target.value || 0.9 }).run(); });
$('#popNum').addEventListener('click', e => {
  const b = e.target.closest('[data-num]'); if (!b) return; closePops();
  if (!editor.isActive('orderedList')) ch().toggleOrderedList().run();
  ch().updateAttributes('orderedList', { numStyle: b.dataset.num }).run();
});
$('#lineList').innerHTML = [1, 1.15, 1.25, 1.5, 2, 2.5, 3].map(v => `<button class="pitem" data-lh="${v}">${v}</button>`).join('');
$('#lineList').addEventListener('click', e => { const b = e.target.closest('[data-lh]'); if (!b) return; closePops(); ch().setParaAttrs({ lineHeight: +b.dataset.lh }).run(); });
$('#openPara').addEventListener('click', () => { const a = $('[data-pop="popPara"]'); closePops(); showPop('popPara', a); });
$('#popPara').onopen = () => {
  const a = editor.isActive('heading') ? editor.getAttributes('heading') : editor.getAttributes('paragraph');
  for (const inp of $$('[data-pf]')) {
    const k = inp.dataset.pf;
    if (inp.type === 'checkbox') inp.checked = !!a[k];
    else inp.value = a[k] ?? (k === 'lineHeight' ? tpl.line : k === 'spaceAfter' ? tpl.after : 0);
  }
};
$('#popPara').addEventListener('change', e => {
  const k = e.target.dataset.pf; if (!k) return;
  const v = e.target.type === 'checkbox' ? e.target.checked : (e.target.value === '' ? null : +e.target.value);
  editor.chain().setParaAttrs({ [k]: v }).run();
});
const tg = $('#tgrid');
for (let r = 1; r <= 8; r++) for (let c = 1; c <= 8; c++) { const d = document.createElement('button'); d.className = 'tc'; d.dataset.r = r; d.dataset.c = c; d.setAttribute('aria-label', r + ' × ' + c); tg.appendChild(d); }
const hl = (r, c) => { for (const d of tg.children) d.classList.toggle('on', +d.dataset.r <= r && +d.dataset.c <= c); $('#tlabel').textContent = r ? r + ' × ' + c + ' table' : 'Choose a size'; };
tg.addEventListener('pointerover', e => { const d = e.target.closest('.tc'); if (d) hl(+d.dataset.r, +d.dataset.c); });
tg.addEventListener('click', e => { const d = e.target.closest('.tc'); if (d) { closePops(); ch().insertTable({ rows: +d.dataset.r, cols: +d.dataset.c, withHeaderRow: false }).run(); } });
$('#popTable').onopen = () => hl(0, 0);

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
/* Formula dialog and live preview                                     */
/* ------------------------------------------------------------------ */
const mdIn = $('#mdIn'), mdDisp = $('#mdDisp'), mathDlg = $('#mathDlg');
let mathPos = null;
const CHIPS = [['a/b', '\\frac{¦}{}'], ['x²', '^{¦}'], ['x₂', '_{¦}'], ['√', '\\sqrt{¦}'], ['ⁿ√', '\\sqrt[¦]{}'],
  ['tg', '\\tg ¦'], ['ctg', '\\ctg ¦'], ['sin', '\\sin ¦'], ['cos', '\\cos ¦'], ['log', '\\log_{¦}'], ['lg', '\\lg ¦'],
  ['lim', '\\lim_{x\\to ¦}'], ['∑', '\\sum_{i=1}^{n} ¦'], ['∫', '\\int_{¦}^{} '], ['|x|', '\\left|¦\\right|'], ['( )', '\\left(¦\\right)'],
  ['α', '\\alpha ¦'], ['β', '\\beta ¦'], ['γ', '\\gamma ¦'], ['π', '\\pi ¦'], ['·', '\\cdot ¦'], ['≤', '\\le ¦'], ['≥', '\\ge ¦'],
  ['≠', '\\ne ¦'], ['≈', '\\approx ¦'], ['∞', '\\infty ¦'], ['°', '^\\circ ¦'], ['ℝ', '\\R ¦'], ['→', '\\to ¦'], ['⇒', '\\Rightarrow ¦']];
$('#chips').innerHTML = CHIPS.map((c, i) => `<button data-i="${i}">${esc(c[0])}</button>`).join('');
$('#chips').addEventListener('mousedown', e => e.preventDefault());
$('#chips').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const snip = CHIPS[+b.dataset.i][1], at = snip.indexOf('¦'), clean = snip.replace('¦', '');
  const s = mdIn.selectionStart, en = mdIn.selectionEnd;
  mdIn.value = mdIn.value.slice(0, s) + clean + mdIn.value.slice(en);
  mdIn.focus(); mdIn.setSelectionRange(s + at, s + at); updMdPrev();
});
function updMdPrev() {
  const p = $('#mdPrev'), t = mdIn.value.trim();
  if (!t) { p.innerHTML = '<span style="color:#8a8f96;font:13px var(--ui)">The preview appears here</span>'; return; }
  renderInto(p, t, mdDisp.checked);
}
function openMath(pos, node) {
  closePops(); showPreview(null);
  const sel = editor.state.selection;
  if (pos == null && sel instanceof NodeSelection && sel.node.type.name === 'math') { pos = sel.from; node = sel.node; }
  mathPos = node ? pos : null;
  let tex = node ? node.attrs.tex : '';
  if (!node && !sel.empty) tex = editor.state.doc.textBetween(sel.from, sel.to, ' ');
  mdIn.value = tex;
  mdDisp.checked = node ? !!node.attrs.display : false;
  $('#mdOk').textContent = node ? 'Update' : 'Insert';
  $('#mdDel').hidden = !node;
  mathDlg.style.top = ($('#app').getBoundingClientRect().bottom + 10) + 'px';
  mathDlg.hidden = false; updMdPrev();
  mdIn.focus(); mdIn.setSelectionRange(tex.length, tex.length);
}
function closeMath() { mathDlg.hidden = true; mathPos = null; editor.commands.focus(); }
function applyMath() {
  const tex = mdIn.value.trim(), display = mdDisp.checked;
  const pos = mathPos;
  mathDlg.hidden = true; mathPos = null;
  if (pos != null) {
    const n = editor.state.doc.nodeAt(pos);
    if (n && n.type.name === 'math') {
      const tr = editor.state.tr;
      if (!tex) tr.delete(pos, pos + n.nodeSize); else tr.setNodeMarkup(pos, undefined, { tex, display });
      editor.view.dispatch(tr);
    }
    editor.commands.focus();
    return;
  }
  if (tex) ch().insertContent({ type: 'math', attrs: { tex, display } }).run();
  else editor.commands.focus();
}
mdIn.addEventListener('input', updMdPrev);
mdDisp.addEventListener('change', updMdPrev);
mdIn.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); applyMath(); }
  else if (e.key === 'Escape') { e.preventDefault(); closeMath(); }
});
$('#mdOk').addEventListener('click', applyMath);
$('#mdX').addEventListener('click', closeMath);
$('#mdDel').addEventListener('click', () => { mdIn.value = ''; applyMath(); });

const mprev = $('#mprev');
function showPreview(p) {
  if (!p) { mprev.hidden = true; return; }
  mprev.innerHTML = '<div class="mp-m"></div><div class="mp-hint">Type $ to place the formula</div>';
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
/* Template drawer                                                     */
/* ------------------------------------------------------------------ */
const getPath = (o, p) => p.split('.').reduce((a, k) => a && a[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'), last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
let hfVariant = 'odd';
function hfTabs() {
  const tabs = [['odd', tpl.oddEven ? 'Odd pages' : 'All pages']];
  if (tpl.oddEven) tabs.push(['even', 'Even pages']);
  if (tpl.firstDiff) tabs.push(['first', 'First page']);
  if (!tabs.find(t => t[0] === hfVariant)) hfVariant = 'odd';
  $('#hfTabs').innerHTML = tabs.map(([k, l]) => `<button data-v="${k}" class="${k === hfVariant ? 'on' : ''}">${l}</button>`).join('');
  const block = kind => {
    const s = tpl[kind][hfVariant], base = `${kind}.${hfVariant}`;
    return `<h4>${kind === 'header' ? 'Header' : 'Footer'}</h4>
      <div class="fgrid three">
        <label class="fld">Left<input type="text" data-k="${base}.l"></label>
        <label class="fld">Center<input type="text" data-k="${base}.c"></label>
        <label class="fld">Right<input type="text" data-k="${base}.r"></label>
      </div>
      <div class="fgrid" style="margin-top:6px">
        <div class="fld full">Picture<div class="imgpick"><img src="${esc(s.img)}" alt=""><button class="btn" data-pickimg="${base}.img">Choose…</button>${s.img ? `<button class="btn" data-clearimg="${base}.img">Remove</button>` : ''}</div></div>
        <label class="fld">Picture position<select data-k="${base}.imgPos"><option value="l">Left</option><option value="c">Center</option><option value="r">Right</option></select></label>
        <label class="fld">Picture height (mm)<input type="number" min="3" max="60" step="1" data-k="${base}.imgH"></label>
      </div>`;
  };
  $('#hfEditor').innerHTML = block('header') + block('footer');
}
function fillDrawer() {
  hfTabs();
  for (const el of $$('#drawer [data-k]')) {
    const v = getPath(tpl, el.dataset.k);
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.type === 'radio') el.checked = el.value === v;
    else el.value = v ?? '';
  }
  $('#wmThumb').src = tpl.wm.img || '';
  $('#wmText').hidden = tpl.wm.type !== 'text';
  $('#wmImage').hidden = tpl.wm.type !== 'image';
  $$('[data-mirror-label]').forEach(s => { s.textContent = tpl.mirror ? (s.dataset.mirrorLabel === 'left' ? 'Inside margin (mm)' : 'Outside margin (mm)') : (s.dataset.mirrorLabel === 'left' ? 'Left margin (mm)' : 'Right margin (mm)'); });
}
function onDrawerInput(e) {
  const el = e.target, k = el.dataset && el.dataset.k; if (!k) return;
  let v = el.type === 'checkbox' ? el.checked : (el.type === 'number' || el.type === 'range') ? parseFloat(el.value) : el.value;
  if (typeof v === 'number' && isNaN(v)) return;
  if (el.type === 'radio' && !el.checked) return;
  setPath(tpl, k, v);
  if (k === 'oddEven' || k === 'firstDiff' || k === 'mirror' || k === 'wm.type') fillDrawer();
  applyTpl(); saveSoon();
}
$('#drawer').addEventListener('input', onDrawerInput);
$('#drawer').addEventListener('change', onDrawerInput);
$('#hfTabs').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { hfVariant = b.dataset.v; fillDrawer(); } });
$('#hfEditor').addEventListener('click', e => {
  const p = e.target.closest('[data-pickimg]'), c = e.target.closest('[data-clearimg]');
  if (p) pickImage(1600, url => { setPath(tpl, p.dataset.pickimg, url); fillDrawer(); applyTpl(); saveSoon(); });
  if (c) { setPath(tpl, c.dataset.clearimg, ''); fillDrawer(); applyTpl(); saveSoon(); }
});
$('#wmPick').addEventListener('click', () => pickImage(2400, url => { tpl.wm.img = url; tpl.wm.type = 'image'; fillDrawer(); applyTpl(); saveSoon(); }));
$('#wmClear').addEventListener('click', () => { tpl.wm.img = ''; fillDrawer(); applyTpl(); saveSoon(); });
const tplMsg = t => { const m = $('#tplMsg'); m.textContent = t; clearTimeout(m._t); m._t = setTimeout(() => { m.textContent = ''; }, 4000); };
$('#tplSave').addEventListener('click', () => tplMsg(store(LS_TPL, JSON.stringify(tpl)) ? 'Saved. New documents will start from this template.' : 'Could not save the template.'));
$('#tplLoad').addEventListener('click', () => { const s = load(LS_TPL); if (!s) return tplMsg('No template saved yet.'); tpl = normalizeTpl(JSON.parse(s)); fillDrawer(); applyTpl(true); saveSoon(); tplMsg('Template applied.'); });
$('#tplReset').addEventListener('click', () => { tpl = normalizeTpl(DEFAULT_TPL); fillDrawer(); applyTpl(true); saveSoon(); tplMsg('Default settings restored.'); });
$('#tplBtn').addEventListener('click', () => { fillDrawer(); $('#drawer').classList.toggle('open'); });
$('#drawerX').addEventListener('click', () => $('#drawer').classList.remove('open'));
const startTpl = () => { const s = load(LS_TPL); try { return normalizeTpl(s ? JSON.parse(s) : DEFAULT_TPL); } catch (e) { return normalizeTpl(DEFAULT_TPL); } };

/* ------------------------------------------------------------------ */
/* Documents: autosave, new, open, save, PDF, print                    */
/* ------------------------------------------------------------------ */
let saveT = 0;
function saveSoon() { clearTimeout(saveT); saveT = setTimeout(saveLocal, 800); }
function docData() { return { title: $('#docTitle').value, tpl, doc: editor.getJSON() }; }
function saveLocal() { if (!store(LS_DOC, JSON.stringify(docData()))) setStatus('Autosave failed – browser storage is full'); }
function loadData(d) {
  tpl = normalizeTpl(d.tpl || {});
  $('#docTitle').value = d.title || 'Dokumentum';
  if (d.doc) editor.commands.setContent(d.doc, { emitUpdate: false });
  else if (typeof d.html === 'string') editor.commands.setContent(d.html, { emitUpdate: false });   // documents from the first prototype
  fillDrawer(); applyTpl(true);
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
    return await buildPDF({ editorDom: editor.view.dom, pagesEl, stackEl: stack, scale, tpl, pages: pageCount, title: $('#docTitle').value });
  } finally {
    try { editor.view.dispatch(editor.state.tr.setSelection(sel.map(editor.state.doc, editor.state.tr.mapping))); } catch (e) { /* ignore */ }
  }
}
async function doSave(saveAs) {
  closePops();
  try { saveLocal(); setStatus(await saveEditable(docData(), editor.getHTML(), saveAs)); }
  catch (e) { setStatus('Could not save: ' + (e && e.message || e)); }
}
async function doPdf() {
  closePops(); busy('Building the PDF…');
  try { const blob = await makePdf(); busy(''); setStatus(await savePdfBlob(blob, $('#docTitle').value)); }
  catch (e) { busy(''); setStatus('Could not build the PDF: ' + (e && e.message || e)); }
}
async function doPrint() {
  closePops();
  if (isTauri()) {
    busy('Preparing the print…');
    try { const blob = await makePdf(); busy(''); setStatus(await printPdfBlob(blob, $('#docTitle').value)); }
    catch (e) { busy(''); setStatus('Could not print: ' + (e && e.message || e)); }
    return;
  }
  // Browser: print the very same layout, page by page, at true paper size.
  await ready();
  const g = geometry(tpl), root = $('#printRoot');
  let style = document.getElementById('pageRule');
  if (!style) { style = document.createElement('style'); style.id = 'pageRule'; document.head.appendChild(style); }
  style.textContent = `@page{size:${g.W / MM}mm ${g.H / MM}mm;margin:0}`;
  root.innerHTML = '';
  for (let i = 0; i < pageCount; i++) {
    const p = document.createElement('div');
    p.className = 'print-page';
    p.style.width = g.W + 'px'; p.style.height = g.H + 'px';
    p.innerHTML = sheetHTML(i, pageCount, tpl, $('#docTitle').value, g, 0, 0);
    const c = editor.view.dom.cloneNode(true);
    c.removeAttribute('contenteditable');
    c.style.left = g.leftOf(i) + 'px';
    c.style.top = (g.mt - i * g.P) + 'px';
    c.style.minHeight = '0';
    p.appendChild(c);
    root.appendChild(p);
  }
  setTimeout(() => { window.print(); setTimeout(() => { root.innerHTML = ''; }, 500); }, 50);
}
$('#saveBtn').addEventListener('click', e => showPop('popSave', e.currentTarget));
$('#saveEditable').addEventListener('click', () => doSave(false));
$('#savePdf').addEventListener('click', doPdf);
$('#printBtn').addEventListener('click', doPrint);
$('#openBtn').addEventListener('click', doOpen);
async function doOpen() {
  try {
    const r = await openDocumentFile();
    if (!r) return;
    if (r.error) return setStatus('That file is not a Matekos Doksi document.');
    loadData(r.data); setCurrentPath(r.path && /\.(mdoksi|kiadvany)$/i.test(r.path) ? r.path : null); saveLocal();
    setStatus('Opened ' + r.name);
  } catch (e) { setStatus('Could not open the file: ' + (e && e.message || e)); }
}
let arm = 0;
$('#newBtn').addEventListener('click', e => {
  const b = e.currentTarget;
  if (!arm) { b.textContent = 'Discard this document?'; arm = setTimeout(() => { arm = 0; b.textContent = 'New'; }, 2600); return; }
  clearTimeout(arm); arm = 0; b.textContent = 'New';
  tpl = startTpl(); $('#docTitle').value = 'Névtelen dokumentum'; setCurrentPath(null);
  editor.commands.setContent('<p></p>'); fillDrawer(); applyTpl(true); saveLocal(); editor.commands.focus();
});
document.addEventListener('keydown', e => {
  const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
  if (!mod) return;
  const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); if (e.shiftKey) doSave(true); else if (isTauri()) doSave(false); else showPop('popSave', $('#saveBtn')); }
  else if (k === 'o') { e.preventDefault(); doOpen(); }
  else if (k === 'p') { e.preventDefault(); doPrint(); }
});
$('#docTitle').addEventListener('input', () => { renderSheets(pagesEl, pageCount, tpl, $('#docTitle').value); saveSoon(); });
$('#zoomSel').addEventListener('change', e => { zoomMode = e.target.value; applyZoom(); });
addEventListener('resize', () => { applyZoom(); closePops(); });
ws.addEventListener('scroll', () => { closePops(); }, { passive: true });

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */
(function init() {
  let d = null;
  try { d = JSON.parse(load(LS_DOC) || load(OLD_DOC) || 'null'); } catch (e) { d = null; }
  if (!load(LS_TPL) && load(OLD_TPL)) store(LS_TPL, load(OLD_TPL));
  if (!d) { try { const v1 = JSON.parse(load('kiadvany.doc.v1') || 'null'); if (v1 && v1.html) d = v1; } catch (e) { /* none */ } }
  if (d && (d.doc || d.html)) loadData(d);
  else { tpl = startTpl(); $('#docTitle').value = 'Trigonometria'; editor.commands.setContent(SAMPLE_HTML, { emitUpdate: false }); fillDrawer(); applyTpl(true); }
  loadFonts().then(() => relayout(0));
  document.fonts && document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', () => relayout(30));
  mathReady.then(() => relayout(100));
  setStatus(isTauri() ? '' : 'Autosaved in this browser');
})();

// Hooks for automated layout/print tests
window.mdoksi = { editor, makePdf, get tpl() { return tpl; }, set tpl(t) { tpl = normalizeTpl(t); applyTpl(true); }, get pages() { return pageCount; }, ready, setZoom: z => { zoomMode = z; applyZoom(); } };

