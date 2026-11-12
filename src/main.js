import './styles.css';
import './doksi.css';
import { Editor, generateHTML } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color, FontSize, FontFamily } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { ListItem } from '@tiptap/extension-list';
import { NodeSelection, TextSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { undoDepth, redoDepth, closeHistory } from '@tiptap/pm/history';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { drawShadeBands } from './shading.js';

import { loadFonts } from './fonts.js';
import { FONT_SETS, fontSet, allFamilies, familyCSS, familyFromCSS, familyLabel, registerAllFamilies, loadTextFamily } from './fontsets.js';
import { startMathJax, renderInto, opts as mathOpts, clearMathCache, mathReady } from './math.js';
import { DEFAULT_TPL, normalizeTpl, geometry, GAP, MM, variantFor } from './template.js';
import { renderSheets, sheetHTML, esc, setHfHTML, setFirstPage } from './pages.js';
import { FontOverrides } from './editor/extensions.js';
import { ParaFormat, KvBulletList, KvOrderedList, ListMarkers, KvTable, KvTableRow, KvTableCell, KvTableHeader, PageBreak, MathNode, KvImage, LineShade, tableContext, ListHang, LetterSpacing, TextCase, Pins, ActiveTable, CommentMark, ListJoin, setPinSpacers, setPinTop, setDocMathFont, lookOf, lookAtDom, marksAt, TabNode, listDefaults, ListItemAttrs, changeListLevel, HunTyping, Hyphens, hyphenKey, ListGapFit } from './editor/extensions.js';
import { layoutTabs, DEFAULT_STEP, setStyleTabs } from './tabs.js';
import { drawMarks, setCellFilter } from './marks.js';
import { spellPlugin, setSpellEnabled, suggestions, addToDictionary, ignoreWord, hideSpell, showSpell } from './spell.js';
import { Pagination } from './editor/pagination.js';
import { buildPDF } from './pdf.js';
import { isTauri, saveDocument, openDocumentFile, openPathFile, watchOpenedFiles, savePdfBlob, printPdfBlob, setCurrentPath, getCurrentPath, currentFileName, titleOfFile, renameCurrentFile, currentFileExists, autosave, loadAutosave, recoverableDrafts, takeDraft, dropDraft, shelveDraft, recentFiles, forgetRecent, pickDocx, saveTemplateFile, openTemplateFile, pickMarkdown, saveMarkdown, templateFilePath, updateTemplateFile } from './files.js';
import { importMarkdown, exportMarkdown } from './markdown.js';
import { importDocx } from './importDocx.js';
import { SAMPLE_HTML } from './sample.js';
import { svg } from './icons.js';
import { checkForUpdate, openLink } from './updates.js';
import { cleanPastedHTML } from './paste.js';
import APP_ICON from '../public/app-icon.png?inline';
import MATEKOS_BULLET from './matekos-vegtelen.png?inline';
import { openMathEditor, isMathEditorOpen, applyMathEditor } from './mathEditor.js';

const $ = s => document.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const APP_VERSION = __APP_VERSION__;
const LS_DOC = 'matekosdoksi.v2.doc', LS_TPL = 'matekosdoksi.v2.tpl';
const OLD_DOC = 'kiadvany.v2.doc', OLD_TPL = 'kiadvany.v2.tpl';   // earlier test versions
const store = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
const lsSet = (k, v) => store(k, v);
const load = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };

let tpl = normalizeTpl(DEFAULT_TPL);
let zoomMode = 'auto', scale = 1, pageCount = 1;
let tblCtx = null;                 // table + selected cells, remembered while a table popover / size field is in use
let ovRaf = 0, imgMoving = false;  // overlay redraw state
let hfEd = null;                   // header/footer editor while it is open (the ribbon then formats it)
let keepScroll = null;
let painter = null;                 // format painter: {marks, para} waiting for the next selection
let spellOn = load('matekosdoksi.spell') !== '0';
const AE = () => hfEd || editor;
const stack = $('#stack'), outer = $('#outer'), ws = $('#ws'), pagesEl = $('#pages');

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */
startMathJax();
/* Undo / redo also cover the template (page, margins, styles, header / footer, template files): template changes
   are kept in their own list, and each remembers how many text steps existed when it was made – so Ctrl+Z walks
   back through text and template changes in the order they happened. */
let tplSaved = '', tplUndo = [], tplRedo = [], tplRestoring = false;
const editor = new Editor({
  element: $('#editorHost'),
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] }, code: false, codeBlock: false, blockquote: false, horizontalRule: false,
      link: false, bulletList: false, orderedList: false, listItem: false, trailingNode: false,   // no extra empty line under a final list
      dropcursor: { color: '#2f6fdb', width: 2 }
    }),
    ListItem, KvBulletList, KvOrderedList, ListMarkers, HunTyping, Hyphens, ListGapFit.configure({ getScale: () => scale }),
    TextStyle, Color, FontSize, FontFamily, LetterSpacing, TextCase, ListHang, FontOverrides, ListItemAttrs, Pins, ActiveTable, CommentMark, ListJoin, TabNode.configure({ getScale: () => scale }),
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
    KvImage.configure({ getScale: () => scale, onChange: m => updateOverlays(m),
      // the area inside the margins of the page under a point (screen coordinates): pictures stay inside it
      // the paragraph a picture dropped at this height belongs to: {pos (start of it), top (its top on screen)}
      anchorAt: (clientY, skip) => {
        const g = geometry(tpl), sr = stack.getBoundingClientRect();
        const pageOf = y => Math.floor((y - sr.top) / scale / g.P);
        const pg = pageOf(clientY);
        let best = null, first = null;
        for (const blk of editor.view.dom.querySelectorAll('p,h1,h2,h3')) {
          if (blk.closest('td,th,.pinned') || (skip && skip.contains(blk))) continue;
          const t = blk.getBoundingClientRect(); if (!t.height) continue;
          if (pageOf(t.top) !== pg) { if (pageOf(t.top) > pg) break; continue; }
          if (!first) first = { blk, t };
          if (t.top <= clientY) best = { blk, t }; else break;
        }
        const pick = best || first; if (!pick) return null;
        try { return { pos: editor.view.posAtDOM(pick.blk, 0), top: pick.t.top }; } catch (e) { return null; }
      },
      pageBox: clientY => {
        const g = geometry(tpl), sr = stack.getBoundingClientRect(), er = editor.view.dom.getBoundingClientRect();
        const i = Math.max(0, Math.min(pageCount - 1, Math.floor((clientY - sr.top) / scale / g.P)));
        return { page: i, left: er.left, right: er.right, top: sr.top + g.contentTop(i) * scale, bottom: sr.top + g.contentBottom(i) * scale };
      } }),
    Pagination.configure({ getTpl: () => tpl, getScale: () => scale, onLayout: n => applyLayout(n),
      // while the page breaks are recalculated the document is briefly shorter: keep the scroll position
      beforeRun: () => { keepScroll = ws.scrollTop; outer.style.minHeight = outer.offsetHeight + 'px'; },
      afterRun: () => { outer.style.minHeight = ''; if (keepScroll != null && Math.abs(ws.scrollTop - keepScroll) > 0.5) ws.scrollTop = keepScroll; keepScroll = null; } })
  ],
  content: '<p></p>',
  editorProps: {
    attributes: { spellcheck: 'false', lang: 'hu', class: 'docbody' },
    // a freely placed picture / table lives at one place in the text but shows somewhere else on the page:
    // selecting it must never scroll to its place in the text
    handleScrollToSelection: view => {
      const sel = view.state.selection;
      return !!(sel.node && sel.node.attrs && sel.node.attrs.pin);
    },
    handleKeyDown: (view, e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {             // undo / redo: text and template in one history
        const k = e.key.toLowerCase();
        if (k === 'z' || k === 'y') { e.preventDefault(); if (k === 'y' || e.shiftKey) unifiedRedo(); else unifiedUndo(); return true; }
      }
      // Enter / Backspace right after the free pictures anchored at the start of a paragraph: they stay with the text
      // (the cursor goes before them first), so a new empty line above never takes them away
      if ((e.key === 'Enter' || e.key === 'Backspace') && view.state.selection.empty) {
        const $c = view.state.selection.$from;
        if ($c.parent.isTextblock && $c.parentOffset > 0) {
          let ok = true; $c.parent.forEach((ch, off) => { if (off < $c.parentOffset && !(ch.type.name === 'image' && ch.attrs.pin)) ok = false; });
          if (ok) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, $c.start())));
        }
      }
      if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.shiftKey || !view.state.selection.empty) return false;
      const down = e.key === 'ArrowDown';
      if (!view.endOfTextblock(down ? 'down' : 'up')) return false;
      const $f = view.state.selection.$from; if ($f.depth < 1) return false;
      let p = down ? $f.after(1) : $f.before(1), skipped = false;
      for (;;) {
        const n = down ? view.state.doc.nodeAt(p) : view.state.doc.resolve(p).nodeBefore;
        if (!n || n.type.name !== 'table' || !n.attrs.pin) break;
        p = down ? p + n.nodeSize : p - n.nodeSize; skipped = true;
      }
      if (!skipped) return false;
      try { view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(p), down ? 1 : -1)).scrollIntoView()); } catch (err) { return false; }
      return true;
    },
    handleDOMEvents: {
      // Paragraphs with line-breaking formulas: the browser cannot place the cursor or extend a selection
      // across them (they are inline, not boxes) – there the editor places cursor and selection itself.
      mousedown: (view, e) => {
        if (e.button === 0 && (e.ctrlKey || e.metaKey)) {            // a picture behind the text: Ctrl/⌘ + click selects it
          const under = [...view.dom.querySelectorAll('.imgw.under')].find(el => { const r = el.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; });
          if (under) {
            e.preventDefault();
            let at = null; view.state.doc.descendants((n, p) => { if (at == null && n.type.name === 'image' && view.nodeDOM(p) === under) at = p; });
            if (at != null) view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)));
            return true;
          }
        }
        if (e.button !== 0 || e.detail > 1 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false;
        const t = e.target.nodeType === 1 ? e.target : e.target.parentElement;
        if (!t || t.closest('.math,.imgw,.lm')) return false;
        const cellEl = t.closest('td,th');
        // pressed on a list symbol (left of the item's text): the editor selects from there itself
        const onSymbol = !t.closest('p,h1,h2,h3') && !!t.closest('li');
        const liP = onSymbol ? [...t.closest('li').querySelectorAll(':scope > p, :scope > h1, :scope > h2, :scope > h3')].find(p => { const r = p.getBoundingClientRect(); return e.clientY >= r.top && e.clientY <= r.bottom; }) : null;
        const blk = t.closest('p,h1,h2,h3') || liP || (cellEl && [...cellEl.querySelectorAll('p,h1,h2,h3')].find(p => { const r = p.getBoundingClientRect(); return e.clientY >= r.top && e.clientY <= r.bottom; }));
        if (!blk || !(blk.querySelector('.math') || onSymbol)) return false;
        // a formula over several lines: the point is before it only left of its first line, after it right of its last
        const posAt = (cx, cy) => {
          const h = view.posAtCoords({ left: cx, top: cy }); if (!h) return null;
          const node = h.inside >= 0 ? view.state.doc.nodeAt(h.inside) : null;
          const near = node && node.type.name === 'math' ? h.inside : null;
          const cand = near != null ? near : [h.pos, h.pos - 1].find(p => p >= 0 && view.state.doc.nodeAt(p) && view.state.doc.nodeAt(p).type.name === 'math');
          if (cand == null) return h.pos;
          const md = view.nodeDOM(cand); if (!md) return h.pos;
          const lines = [...md.querySelectorAll('svg')].map(sv => sv.getBoundingClientRect()).filter(q => q.width > 1);
          const rs = lines.length > 1 ? lines : [md.getBoundingClientRect()];
          const firstL = rs[0], lastL = rs[rs.length - 1];
          if (cy >= lastL.top && cx >= lastL.right - 1) return cand + 1;                   // right of its last line: after it
          if (cy <= firstL.bottom && cx <= firstL.left + 1) return cand;                   // left of its first line: before it
          return h.pos;
        };
        const hit0 = posAt(e.clientX, e.clientY); if (hit0 == null) return false;
        const hit = { pos: hit0 };
        e.preventDefault();
        const anchor = hit.pos;
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor)));
        if (!view.hasFocus()) view.dom.focus({ preventScroll: true });
        const cellOf = pos => { const $p = view.state.doc.resolve(pos); for (let d = $p.depth; d > 0; d--) { const r = $p.node(d).type.spec.tableRole; if (r === 'cell' || r === 'header_cell') return $p.before(d); } return null; };
        const aCell = cellOf(anchor);
        const mv = ev => {
          const hp = posAt(ev.clientX, ev.clientY); if (hp == null) return;
          const h = { pos: hp };
          const hCell = cellOf(h.pos);
          try {
            if (aCell != null && hCell != null && hCell !== aCell) view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, aCell, hCell)));
            else view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, h.pos)));
          } catch (err) { /* outside text */ }
        };
        const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
        addEventListener('mousemove', mv); addEventListener('mouseup', up);
        return true;
      },
      // no dragging of cell contents inside tables
      dragstart: (view, e) => {                // selected text is never dragged away – pictures may be
        const t = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
        if ((t && t.closest && t.closest('.imgw')) || (view.state.selection.node && view.state.selection.node.type.name === 'image')) return false;
        e.preventDefault(); return true;
      },
      drop: (view, e) => { const t = e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement); if (t && t.closest('td,th') && !(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length)) { e.preventDefault(); return true; } return false; }
    },
    // text from other programs arrives without the look of its source (paragraphs, headings, lists, tables stay)
    transformPastedHTML: html => { try { return cleanPastedHTML(html); } catch (e) { return html; } },
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
  onFocus: () => { if (hfEd) { hfEd = null; updateToolbar(); } updateOverlays(); },
  onBlur: () => updateOverlays(),
  onTransaction: ({ transaction }) => { if (transaction.docChanged && tpl && tpl.hyphenate) hyphenSoon(300); if (transaction.docChanged && transaction.getMeta('addToHistory') !== false && !transaction.getMeta('history$')) tplRedo = []; if (keptSel && transaction.selectionSet && editor.view.hasFocus()) { keptSel = null; drawComments(); } if (transaction.docChanged) { docVersion++; statsSoon(); if (panelView() === 'cmt') renderComments(); else drawComments(); } updateToolbar(); updateOverlays(); marksSoon(); }
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
let pinRaf = 0, pinPrev = '', pinRounds = 0, pinInputs = '', docVersion = 0, pinLast = [];
/** The text line at height y (screen coordinates): {pos, top} – the line start in the document. Pinned
 *  elements, tables and the spacers are left out; works also for parts of the document that are not on screen. */
function lineAtY(y, skipEl) {
  const view = editor.view;
  for (const b of view.dom.querySelectorAll('p,h1,h2,h3')) {
    if (b.closest('.pinned,td,th') || (skipEl && skipEl.contains(b))) continue;
    const br = b.getBoundingClientRect(); if (br.bottom <= y || !br.height) continue;
    const pt = parseFloat(getComputedStyle(b).paddingTop) || 0;
    if (br.top + pt >= y) { try { return { pos: view.posAtDOM(b, 0), top: br.top + pt }; } catch (e) { return null; } }
    // inside this paragraph: the first character whose line reaches below y
    const tw = document.createTreeWalker(b, NodeFilter.SHOW_TEXT, { acceptNode: t => t.parentElement.closest('.lm,.math,.pin-sp,.pg-sp') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const rg = document.createRange();
    while (tw.nextNode()) {
      const t = tw.currentNode; if (!t.data.length) continue;
      rg.selectNodeContents(t); const tr = rg.getBoundingClientRect(); if (tr.bottom <= y) continue;
      let lo = 0, hi = t.data.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; rg.setStart(t, mid); rg.setEnd(t, mid + 1); const q = rg.getClientRects(); const cr = q[q.length - 1]; if (cr && cr.bottom > y) hi = mid; else lo = mid + 1; }
      // back to the start of that line
      rg.setStart(t, lo); rg.setEnd(t, lo + 1); const top0 = rg.getBoundingClientRect().top;
      let s0 = lo, tn = t; while (s0 > 0) { rg.setStart(tn, s0 - 1); rg.setEnd(tn, s0); if (Math.abs(rg.getBoundingClientRect().top - top0) > 2) break; s0--; }
      // the line may begin in an earlier text piece (marks, spell-check underlines split the text)
      if (s0 === 0) {
        const back = document.createTreeWalker(b, NodeFilter.SHOW_TEXT, { acceptNode: x => x.parentElement.closest('.lm,.math,.pin-sp,.pg-sp') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
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
  for (const [ei, G0] of groups.entries()) {
    // the margin around an object: the set value at the sides, half of it above and below
    const vg = gap * scale * 0.5, G = { ...G0, t: G0.t - vg, b: G0.b + vg };
    const keepOld = () => { if (pinRounds > 1 && pinLast[ei]) specs.push(...pinLast[ei]); };   // a second round never takes floats away
    const textLeft = (G.l - er.left) >= (er.right - G.r);
    const side = textLeft ? 'right' : 'left';
    // the paragraphs with lines beside the object: each gets its own invisible float, only over its own lines
    const blocks = [...dom.querySelectorAll('p,h1,h2,h3')].filter(b0 => {
      if (b0.closest('.pinned,td,th')) return false;
      const r0 = b0.getBoundingClientRect(); return r0.height > 0 && r0.top < G.b && r0.bottom > G.t;
    });
    if (!blocks.length) { keepOld(); continue; }
    // indents beside the object: the outermost paragraph starts right at the object's margin, the others keep only
    // the difference of their indents (first-line and hanging indents do not count there)
    const edgeL = b0 => b0.getBoundingClientRect().left, edgeR = b0 => b0.getBoundingClientRect().right;
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
      const br0 = blk.getBoundingClientRect(), f0 = lineAtY(Math.max(G.t, br0.top) + 1, null);
      if (f0 && Math.abs(f0.top - (br0.top + (parseFloat(getComputedStyle(blk).paddingTop) || 0) * scale)) < 3) shift = Math.max(shift, liRoom(blk) - (edgeL(blk) - outerL));
    }
    blocks.forEach((blk, bi) => {
      const br = blk.getBoundingClientRect(), bcs = getComputedStyle(blk);
      const found = lineAtY(Math.max(G.t, br.top) + 1, null);
      if (!found) return;
      let pos = found.pos; const lineTop = found.top;
      try { const d = editor.view.domAtPos(pos), host = (d.node.nodeType === 1 ? d.node : d.node.parentElement).closest('p,h1,h2,h3'); if (host !== blk) pos = editor.view.posAtDOM(blk, 0); } catch (e) { return; }
      if (lineTop >= G.b) return;
      const padL = parseFloat(bcs.paddingLeft) || 0, padR = parseFloat(bcs.paddingRight) || 0;
      const cbL = br.left + padL * scale, cbR = br.right - padR * scale;
      // the first line beside the object: no first-line / hanging indent there; a list symbol on such a line keeps its room
      const firstLine = Math.abs(lineTop - (br.top + (parseFloat(bcs.paddingTop) || 0) * scale)) < 3;
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
      const nextTop = last ? Infinity : blocks[bi + 1].getBoundingClientRect().top;
      const top = Math.max(G.t, lineTop), bottom = last ? G.b : Math.min(G.b, br.bottom, nextTop) - 2;
      const dy = Math.max(0, (G.t - lineTop) / scale), h = (bottom - top) / scale;
      if (h <= 0) return;
      const pgOf = Math.floor((lineTop - sr0.top) / scale / g.P);
      const atPageTop = (lineTop - (sr0.top + g.contentTop(pgOf) * scale)) / scale < 24;
      mine.push({ pos, side, after: atPageTop, flat: flat ? editor.view.posAtDOM(blk, 0) - 1 : null, w: Math.round(wPx / scale), h: Math.round(h), dy: Math.round(dy), key: `pin${pos}${side}${atPageTop ? 'a' : 'b'}${Math.round(wPx / scale)}x${Math.round(h)}+${Math.round(dy)}` });
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
  if (!pinNested) { pinNested = true; try { for (let k = 0; k < 2; k++) { const before = pinPrev; updatePins(); if (pinPrev === before) break; } } finally { pinNested = false; } relayout(0); }
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

/* ------------------------------------------------------------------ */
/* Toolbar (Matekos Prezi layout)                                      */
/* ------------------------------------------------------------------ */
for (const b of $$('[data-icon]')) b.insertAdjacentHTML('afterbegin', svg(b.dataset.icon));
for (const c of $$('.psec-h .chev')) c.innerHTML = svg('chev');
const ch = () => AE().chain().focus(null, { scrollIntoView: false });
/** The computed look at the cursor (style + marks). */
function lookAt(test) {
  const ed = AE(); let el = null;
  const sel = ed.state.selection, at = sel.empty ? sel.from : Math.min(sel.from + 1, sel.to);
  try { const d = ed.view.domAtPos(at); el = d.node.nodeType === 1 ? (d.node.childNodes[d.offset] && d.node.childNodes[d.offset].nodeType === 1 ? d.node.childNodes[d.offset] : d.node) : d.node.parentElement; } catch (e) { return false; }
  return !!el && test(getComputedStyle(el));
}
/** B / I / U: a mark normally; inside a style that already has it (e.g. a bold heading) it switches it off. */
function toggleLook(mark, prop, offValue, test) {
  const ed = AE(), ts = ed.getAttributes('textStyle');
  if (ed.isActive(mark)) return ch().unsetMark(mark).run();
  if (ts[prop] === offValue) return ch().setMark('textStyle', { [prop]: null }).removeEmptyTextStyle().run();
  if (lookAt(test)) return ch().setMark('textStyle', { [prop]: offValue }).run();
  return ch().setMark(mark).run();
}
const isUpper = () => AE().getAttributes('textStyle').textTransform === 'uppercase';
const COMMANDS = {
  undo: () => hfEd ? ch().undo().run() : unifiedUndo(),
  redo: () => hfEd ? ch().redo().run() : unifiedRedo(),
  bold: () => toggleLook('bold', 'fontWeight', '400', cs => (parseInt(cs.fontWeight, 10) || 400) >= 600),
  italic: () => toggleLook('italic', 'fontStyle', 'normal', cs => cs.fontStyle === 'italic'),
  underline: () => toggleLook('underline', 'textDecoration', 'none', cs => /underline/.test(cs.textDecorationLine)),
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
  indent: () => AE().isActive('listItem') ? (changeListLevel(AE().view, 1), AE().view.focus()) : ch().shiftIndent(0.8).run(),
  outdent: () => AE().isActive('listItem') ? (changeListLevel(AE().view, -1), AE().view.focus()) : ch().shiftIndent(-0.8).run(),
  image: () => $('#fileIn').click(),
  pageBreak: () => ch().setPageBreak().run(),
  toc: () => updateTOC(true),
  math: () => openMath(null, null),
  painter: () => {
    if (painter) { painter = null; document.body.classList.remove('painting'); updateToolbar(); return; }
    const ed = AE(), st = ed.state, $f = st.selection.$from;
    const marks = (st.selection.empty ? (st.storedMarks || $f.marks()) : (st.doc.nodeAt(st.selection.from) || { marks: [] }).marks).filter(m => m.type.name !== 'link' && m.type.name !== 'lineShade');
    const blk = $f.parent, pa = {};
    for (const k of ['textAlign', 'lineHeight', 'spaceBefore', 'spaceAfter', 'indentLeft', 'indentRight', 'firstLine', 'shade', 'ctx']) if (blk.attrs[k] !== undefined) pa[k] = blk.attrs[k];
    // a list: its symbol / numbering format comes along too
    let list = null;
    for (let d = $f.depth; d > 0; d--) { const n = $f.node(d); if (n.type.name === 'bulletList' || n.type.name === 'orderedList') { const { bulletChar, bulletImage, bulletSize, numStyle, gap } = n.attrs; list = { type: n.type.name, attrs: n.type.name === 'orderedList' ? { numStyle, gap } : { bulletChar, bulletImage, bulletSize, gap } }; break; } }
    painter = { marks, para: pa, heading: blk.type.name === 'heading' ? blk.attrs.level : 0, list };
    document.body.classList.add('painting'); updateToolbar();
    toast('Formátummásoló: jelöld ki a szöveget, amelyre át kell vinni. Esc: mégse');
  },
  // two columns: a one-row, two-column table with invisible borders and no cell margins
  twoCols: () => twoColumns(),
  spell: () => {
    spellOn = !spellOn; lsSet('matekosdoksi.spell', spellOn ? '1' : '0');
    setSpellEnabled(editor.view, spellOn);
    toast(spellOn ? 'Helyesírás-ellenőrzés: bekapcsolva (magyar)' : 'Helyesírás-ellenőrzés: kikapcsolva'); updateToolbar();
  },
  marks: () => { showMarks = !showMarks; lsSet('matekosdoksi.marks', showMarks ? '1' : '0'); marksSoon(); updateToolbar(); }
};
const STATES = {
  bold: () => lookAt(cs => (parseInt(cs.fontWeight, 10) || 400) >= 600), italic: () => lookAt(cs => cs.fontStyle === 'italic'),
  underline: () => lookAt(cs => /underline/.test(cs.textDecorationLine)), spell: () => spellOn,
  strike: () => AE().isActive('strike'), superscript: () => AE().isActive('superscript'), subscript: () => AE().isActive('subscript'),
  upper: isUpper, marks: () => showMarks, painter: () => !!painter,
  alignLeft: () => AE().isActive({ textAlign: 'left' }), alignCenter: () => AE().isActive({ textAlign: 'center' }),
  alignRight: () => AE().isActive({ textAlign: 'right' }), alignJustify: () => AE().isActive({ textAlign: 'justify' }),
  bulletList: () => AE().isActive('bulletList'), orderedList: () => AE().isActive('orderedList')
};
let tbRaf = 0;
function updateToolbar() {
  if (tbRaf) return;
  tbRaf = requestAnimationFrame(() => {
    tbRaf = 0;
    for (const b of $$('#ribbon [data-state]')) b.classList.toggle('on', !!(STATES[b.dataset.state] && STATES[b.dataset.state]()));
    const { from } = AE().state.selection;
    let el = null;
    try { const d = AE().view.domAtPos(from); el = d.node.nodeType === 1 ? d.node : d.node.parentElement; } catch (e) { /* ignore */ }
    // a formula: its size is the size of the text around it
    if (el && el.closest && el.closest('.math')) el = el.closest('.math').parentElement;
    if (el && el.nodeType === 1 && AE().state.selection instanceof NodeSelection) { const d = AE().view.nodeDOM(from); if (d && d.parentElement) el = d.parentElement; }
    if (el && AE().view.dom.contains(el)) {
      const cs = getComputedStyle(el);
      if (document.activeElement !== $('#sizeIn')) $('#sizeIn').value = String(Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2).replace('.', ',');
      $('#colorBar').style.background = cs.color;
    }
    { const f = currentFamily(); $('#fontLabel').textContent = familyLabel(f || fontSet(tpl.font).text).replace(/ \(.*\)$/, ''); }
    $('#styleSel').value = AE().isActive('heading', { level: 1 }) ? 'h1' : AE().isActive('heading', { level: 2 }) ? 'h2' : AE().isActive('heading', { level: 3 }) ? 'h3' : 'p';
    updateImgBar();
    $('#tableBar').hidden = !AE().isActive('table') || !$('#imgBar').hidden;
    if (!$('#tableBar').hidden) fillTableFields();
    for (const b of $$('#tableBar [data-valign]')) b.classList.toggle('on', (AE().getAttributes('tableCell').vAlign || AE().getAttributes('tableHeader').vAlign || 'top') === b.dataset.valign);
  });
}
for (const bar of [$('#ribbon'), $('#tableBar'), $('.b1left')]) {
  bar.addEventListener('mousedown', e => { if (e.target.closest('button') && !e.target.closest('[data-pop="popFile"],[data-pop="popExport"],[data-pop="popSave"],#bSave')) e.preventDefault(); });
  bar.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.pop) return showPop(b.dataset.pop, b);
    if (hfEd && (['math', 'image', 'pageBreak', 'toc', 'bulletList', 'orderedList', 'indent', 'outdent'].includes(b.dataset.cmd) || ['popTable', 'popShade', 'popBullet', 'popNum'].includes(b.dataset.pop)))
      return toast('Az élőfejben és az élőlábban ez nem használható.');
    if (b.dataset.cmd && COMMANDS[b.dataset.cmd]) return COMMANDS[b.dataset.cmd]();
    if (b.dataset.tbl) return tableCmd(b.dataset.tbl);
    if (b.dataset.valign) return ch().setCellAttribute('vAlign', b.dataset.valign).run();
    if (b.dataset.talign) return setTableAttrs({ align: b.dataset.talign });
  });
}
$('#styleSel').addEventListener('change', e => {
  const v = e.target.value;
  if (v === 'p') ch().setParagraph().run(); else ch().setHeading({ level: +v[1] }).run();
});
/* find and replace (as in Matekos Prezi) – in the document text */
function findRegex() { const q = $('#findIn').value; if (!q) return null; return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $('#findCase').checked ? 'g' : 'gi'); }
/** All matches as document ranges, in reading order: {from, to} inside one paragraph (also across bold / italic /
 *  colour changes), and {from, to, math: true} for a formula whose TeX code matches (found, never replaced). */
function findMatches(re) {
  const out = [];
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === 'math') { if (String(n.attrs.tex ?? '').search(re) >= 0) out.push({ from: pos, to: pos + n.nodeSize, math: true }); return false; }
    if (!n.isTextblock) return;
    // the paragraph's text in runs of neighbouring text nodes (a formula, picture or tab ends a run)
    let run = '', at = 0;
    const flush = () => {
      if (run) { re.lastIndex = 0; let m; while ((m = re.exec(run))) { if (!m[0]) { re.lastIndex++; continue; } out.push({ from: at + m.index, to: at + m.index + m[0].length }); } }
      run = '';
    };
    n.forEach((c, off) => {
      if (c.isText) { if (!run) at = pos + 1 + off; run += c.text; }
      else { flush(); if (c.type.name === 'math' && String(c.attrs.tex ?? '').search(re) >= 0) out.push({ from: pos + 1 + off, to: pos + 1 + off + c.nodeSize, math: true }); }
    });
    flush();
    return false;
  });
  return out;
}
/* two columns: a 1×2 table with invisible borders and no cell margins. With text selected, that text is moved into
   it, divided evenly (blocks, or the items of a list – a list split in two keeps counting in the second column);
   the text and paragraph formatting stay as they are. */
function twoColumns() {
  const st = editor.state, S = st.schema, { $from, $to, empty } = st.selection;
  const cell = content => S.nodes.tableCell.create({ colspan: 1, rowspan: 1, borderWidth: 0, vAlign: 'top' }, content.length ? content : [S.nodes.paragraph.create()]);
  const table = (a, b) => S.nodes.table.create({ padV: 0, padH: 0 }, [S.nodes.tableRow.create(null, [cell(a), cell(b)])]);
  const inTable = (() => { for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.spec.tableRole) return true; return false; })();
  if (empty || inTable || $from.depth < 1) { editor.view.dispatch(st.tr.replaceSelectionWith(table([], [])).scrollIntoView()); editor.view.focus(); return; }
  // the whole top-level blocks the selection touches
  const i0 = $from.index(0), i1 = $to.index(0);
  const blocks = []; for (let i = i0; i <= i1; i++) blocks.push(st.doc.child(i));
  const from = $from.before(1), to = $to.after(1);
  // units: a block, or one item of a list
  const units = [];
  for (const b of blocks) {
    if ((b.type.name === 'bulletList' || b.type.name === 'orderedList') && b.childCount > 1) b.forEach((it, o, k) => units.push({ list: b, item: it, k }));
    else units.push({ node: b });
  }
  const half = Math.ceil(units.length / 2);
  const toBlocks = us => {
    const out = []; let cur = null;
    for (const u of us) {
      if (u.node) { out.push(u.node); cur = null; continue; }
      if (cur && cur.src === u.list) { cur.items.push(u.item); continue; }
      cur = { src: u.list, first: u.k, items: [u.item] }; out.push(cur);
    }
    return out.map(x => x.src ? x.src.type.create({ ...x.src.attrs, ...(x.src.type.name === 'orderedList' ? { start: (x.src.attrs.start ?? 1) + x.first, cont: false } : {}) }, x.items) : x);
  };
  const tbl = table(toBlocks(units.slice(0, half)), toBlocks(units.slice(half)));
  const tr = st.tr.replaceWith(from, to, tbl);
  try { tr.setSelection(TextSelection.near(tr.doc.resolve(from + 4))); } catch (e) { /* keep */ }
  editor.view.dispatch(tr.scrollIntoView()); editor.view.focus();
}

/* ------------------------------------------------------------------ */
/* Word count (bottom of the left panel) and statistics                */
/* ------------------------------------------------------------------ */
function docStats() {
  const doc = editor.state.doc;
  let text = '', images = 0, tables = 0;
  doc.descendants((n, pos, parent) => {
    if (n.type.name === 'image') { images++; return false; }
    if (n.type.name === 'table') tables++;
    if (n.isTextblock) { if (parent && parent.type.name === 'listItem' && parent.attrs.ghost && parent.firstChild === n) return false; text += '\n'; }
    if (n.isText) text += n.text;
    if (n.type.name === 'math') text += ' ' + 'ƒ' + ' ';          // a formula counts as one word / one character
    if (n.type.name === 'tab' || n.type.name === 'hardBreak') text += ' ';
    return true;
  });
  const words = (text.match(/\S+/g) || []).length;
  const chars = text.replace(/\n/g, '').length, noSpace = text.replace(/\s/g, '').length;
  // lines as they are on the pages (hidden holder lines and the app's own marks left out)
  let lines = 0;
  for (const b of editor.view.dom.querySelectorAll('p,h1,h2,h3')) {
    if (!b.getBoundingClientRect().height || b.closest('.pinned') && false) continue;
    const r = document.createRange(); r.selectNodeContents(b);
    const tops = new Set();
    for (const q of r.getClientRects()) if (q.width > 1 && q.height > 4) tops.add(Math.round(q.bottom / 4));
    lines += Math.max(b.textContent.trim() ? 1 : 0, tops.size);
  }
  return { words, chars, noSpace, lines, images, tables };
}
let statsTimer = 0;
function statsSoon() { clearTimeout(statsTimer); statsTimer = setTimeout(() => { const st = docStats(); $('#wordCount').textContent = `${st.words.toLocaleString('hu-HU')} szó`; }, 300); }
$('#wordCount').addEventListener('click', e => {
  const st = docStats(), f = n => n.toLocaleString('hu-HU');
  $('#statsBody').innerHTML = [['Szavak', st.words], ['Karakterek (szóközökkel)', st.chars], ['Karakterek (szóközök nélkül)', st.noSpace], ['Sorok', st.lines], ['Képek', st.images], ['Táblázatok', st.tables]]
    .map(([k, v]) => `<div class="srow"><span>${k}</span><b>${f(v)}</b></div>`).join('');
  showPop('popStats', e.currentTarget);
});

/* ------------------------------------------------------------------ */
/* The app's own right-click menu (the web view's menu is switched off) */
/* ------------------------------------------------------------------ */
/** The icon in front of a menu item (by its text). */
const CTX_ICONS = [[/^Kivágás/, 'cut'], [/^Beillesztés/, 'paste'], [/^Mindent/, 'selAll'], [/^TeX-kód/, 'copy'], [/^Másolás/, 'copy'],
  [/^Megjegyzés/, 'comment'], [/^Bekezdés/, 'para'], [/^Tabulátor/, 'tabstop'], [/^Formátummásoló/, 'painter'], [/^Formázás törlése/, 'clear'],
  [/^Szint beljebb/, 'indent'], [/^Szint kijjebb/, 'outdent'], [/Számozás|Kezdő szám/, 'num'], [/beszúrása/, 'tblAdd'], [/^(Sor|Oszlop) törlése/, 'tblDel'],
  [/egyesítése/, 'merge'], [/^Cella kitöltése/, 'fill'], [/^Kép cseréje/, 'image'], [/^Felirat/, 'comment'], [/^A szöveg sorában/, 'inline'], [/^Külön sorban/, 'center'],
  [/^Körbefuttatás/, 'wrapL'], [/^Szöveg fölött/, 'front'], [/^Szöveg mögött/, 'back'], [/törlése$|^Törlés/, 'trash'], [/^Szerkesztés/, 'sigma'], [/Sortörés|Egy sorban/, 'wrapL']];
const ctxIcon = label => (CTX_ICONS.find(([re]) => re.test(label)) || [0, 'para'])[1];
function ctxItems(e) {
  const t = e.target.nodeType === 1 ? e.target : e.target.parentElement;
  const st = editor.state, sel = st.selection, items = [];
  const add = (label, fn, hint = '', on = true) => items.push({ label, fn, hint, on });
  const sep = title => items.push({ sep: true, title });
  // where was it clicked: formula, picture, table, list item
  const mathEl = t.closest('.math'), imgEl = t.closest('.imgw') || (sel.node && sel.node.type.name === 'image' ? editor.view.nodeDOM(sel.from) : null);
  const inTable = !!tableContext(st), inList = editor.isActive('listItem');
  const nodePos = el => { let at = null; st.doc.descendants((n, p) => { if (at == null && editor.view.nodeDOM(p) === el) at = p; }); return at; };
  if (mathEl) {
    const p = nodePos(mathEl), n = p != null ? st.doc.nodeAt(p) : null;
    sep('Képlet');
    add('Szerkesztés…', () => mathEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })), 'dupla kattintás');
    add('TeX-kód másolása', () => n && navigator.clipboard.writeText(n.attrs.tex).then(() => toast('TeX-kód a vágólapon')));
    add(n && n.attrs.wrap ? 'Egy sorban maradjon' : 'Sortörés a sor végén', () => { if (p != null) editor.view.dispatch(editor.state.tr.setNodeMarkup(p, undefined, { ...n.attrs, wrap: !n.attrs.wrap })); });
    add('Képlet törlése', () => { if (p != null) editor.view.dispatch(editor.state.tr.delete(p, p + n.nodeSize)); });
  } else if (imgEl && imgEl._kv) {
    const k = imgEl._kv, w = k.node().attrs.wrap;
    sep('Kép');
    add('Körbefuttatás', () => k.setWrap('wl'), w === 'wl' || w === 'wr' ? '✓' : '');
    add('Szöveg fölött', () => k.setWrap('over'), w === 'over' ? '✓' : '');
    add('Szöveg mögött', () => k.setWrap('under'), w === 'under' ? '✓' : '');
    add('Külön sorban', () => k.setWrap('ctr'), w === 'ctr' ? '✓' : '');
    add('A szöveg sorában', () => k.setWrap('inl'), w === 'inl' ? '✓' : '');
    add('Megjegyzés hozzáadása', () => { const p = nodePos(imgEl); if (p != null) editor.commands.setNodeSelection(p); openCommentBox(); });
    add('Kép cseréje…', () => pickImage(1600, url => { const p = nodePos(imgEl); if (p != null) { const n = editor.state.doc.nodeAt(p); editor.view.dispatch(editor.state.tr.setNodeMarkup(p, undefined, { ...n.attrs, src: url })); } }));
    add('Kép törlése', () => k.remove());
  } else {
    const hasSel = !sel.empty;
    add('Kivágás', () => { editor.view.focus(); document.execCommand('cut'); }, 'Ctrl/⌘+X', hasSel);
    add('Másolás', () => { editor.view.focus(); document.execCommand('copy'); }, 'Ctrl/⌘+C', hasSel);
    add('Beillesztés', async () => {
      editor.view.focus();
      try {
        const items2 = await navigator.clipboard.read();
        for (const it of items2) if (it.types.includes('text/html')) { const h = await (await it.getType('text/html')).text(); editor.view.pasteHTML(h); return; }
        const tx = await navigator.clipboard.readText(); editor.view.pasteText(tx);
      } catch (err) { try { editor.view.pasteText(await navigator.clipboard.readText()); } catch (e2) { toast('A beillesztéshez használd a Ctrl/⌘+V-t.'); } }
    }, 'Ctrl/⌘+V');
    add('Beillesztés formázás nélkül', async () => { editor.view.focus(); try { editor.view.pasteText(await navigator.clipboard.readText()); } catch (err) { toast('A beillesztéshez használd a Ctrl/⌘+Shift+V-t.'); } });
    add('Mindent kijelöl', () => { editor.view.focus(); editor.commands.selectAll(); }, 'Ctrl/⌘+A');
    sep();
    add('Megjegyzés hozzáadása', () => openCommentBox(), '', hasSel);
    add('Bekezdés beállításai…', () => showPop('popPara', $('[data-pop="popPara"]')));
    add('Formázás törlése', () => COMMANDS.clearFormat ? COMMANDS.clearFormat() : ch().unsetAllMarks().run());
    add('Formátummásoló', () => COMMANDS.painter());
    if (inList) {
      sep('Lista');
      add('Szint beljebb', () => changeListLevel(editor.view, 1), 'Tab');
      add('Szint kijjebb', () => changeListLevel(editor.view, -1), 'Shift+Tab');
      if (editor.isActive('orderedList')) {
        add('Számozás újrakezdése', () => applyListAttrs('orderedList', { start: 1 }));
        add('Kezdő szám…', () => showPop('popNum', $('[data-pop="popNum"]')));
      }
    }
    if (inTable) {
      const c = tableContext(st);
      sep('Táblázat');
      add('Sor beszúrása fölé', () => tableCmd('addRowBefore'));
      add('Sor beszúrása alá', () => tableCmd('addRowAfter'));
      add('Oszlop beszúrása balra', () => tableCmd('addColumnBefore'));
      add('Oszlop beszúrása jobbra', () => tableCmd('addColumnAfter'));
      add('Sor törlése', () => tableCmd('deleteRow'));
      add('Oszlop törlése', () => tableCmd('deleteColumn'));
      add('Cellák egyesítése / felosztása', () => tableCmd('mergeOrSplit'));
      add(c && c.table.attrs.pin ? 'Vissza a szövegbe' : 'Szabad elhelyezés', () => { toggleTablePin(); updateToolbar(); });
      add('Cella kitöltése…', () => showPop('popCell', $('[data-pop="popCell"]')));
      add('Táblázat törlése', () => tableCmd('deleteTable'));
    }
  }
  return items;
}
function openCommentBox() { if (panelView() !== 'cmt') panelVisible(true, 'cmt'); setTimeout(() => $('#cmtText').focus(), 50); }
let ctxActions = [];
document.addEventListener('contextmenu', e => {
  const t = e.target.nodeType === 1 ? e.target : e.target.parentElement;
  if (t && t.closest('input, textarea, select')) return;                    // text boxes keep the system's copy / paste menu
  e.preventDefault();                                                       // never the web view's own (browser) menu
  if (!t || !t.closest('#editorHost')) return;                              // panels, top bar: no menu
  if (t.closest('.spell-err')) return;                                      // misspelled word: the spelling popup
  // a right-click outside the selection moves the cursor there first
  const hit = editor.view.posAtCoords({ left: e.clientX, top: e.clientY }), sel = editor.state.selection;
  if (hit && !t.closest('.imgw,.math') && (sel.empty || hit.pos < sel.from || hit.pos > sel.to)) editor.commands.setTextSelection(hit.pos);
  const items = ctxItems(e); ctxActions = items;
  const m = $('#ctxMenu');
  m.innerHTML = items.map((it, i) => it.sep ? (it.title ? `<div class="psep"></div><div class="ctitle">${it.title}</div>` : '<div class="psep"></div>') : `<button class="pitem" data-ci="${i}"${it.on ? '' : ' disabled'}><span class="cico">${svg(ctxIcon(it.label))}</span><span class="clbl">${it.label}</span><span class="phint">${it.hint || ''}</span></button>`).join('').replace(/^<div class="psep"><\/div>/, '');
  closePops();
  m.hidden = false;
  const W = m.offsetWidth, H = m.offsetHeight;
  m.style.left = Math.min(e.clientX, innerWidth - W - 6) + 'px'; m.style.top = Math.min(e.clientY, innerHeight - H - 6) + 'px';
  openPop = m; openAnchor = null;
}, true);
$('#ctxMenu').addEventListener('mousedown', e => e.preventDefault());       // the selection stays
$('#ctxMenu').addEventListener('click', e => {
  const b = e.target.closest('[data-ci]'); if (!b) return;
  const it = ctxActions[+b.dataset.ci]; closePops();
  if (it && it.fn) it.fn();
});

/* format painter: applied when the mouse is released over a selection */
function applyPainter() {
  const ed = editor, st = ed.state, { from, to, empty } = st.selection;
  if (!painter || empty) return;
  const tr = st.tr;
  const FORMAT = ['bold', 'italic', 'underline', 'strike', 'superscript', 'subscript', 'highlight', 'textStyle'];
  for (const n of FORMAT) { const t = st.schema.marks[n]; if (t) tr.removeMark(from, to, t); }
  for (const m of painter.marks) tr.addMark(from, to, m);
  st.doc.nodesBetween(from, to, (n, pos) => {
    if (n.type.name === 'paragraph' || n.type.name === 'heading') {
      if (painter.heading && n.type.name === 'paragraph') tr.setNodeMarkup(pos, st.schema.nodes.heading, { ...n.attrs, ...painter.para, level: painter.heading });
      else if (!painter.heading && n.type.name === 'heading') tr.setNodeMarkup(pos, st.schema.nodes.paragraph, { ...n.attrs, ...painter.para });
      else tr.setNodeMarkup(pos, undefined, { ...n.attrs, ...painter.para, ...(n.type.name === 'heading' ? { level: painter.heading || n.attrs.level } : {}) });
      return false;
    }
  });
  ed.view.dispatch(tr);
  if (painter.list) {                          // the list format: the selected items get it (a new list if needed)
    const L = painter.list;
    if (!ed.isActive(L.type)) ed.chain().focus()[L.type === 'bulletList' ? 'toggleBulletList' : 'toggleOrderedList']().run();
    applyListAttrs(L.type, { ...L.attrs });
  }
  painter = null; document.body.classList.remove('painting'); updateToolbar();
}
editor.view.dom.addEventListener('mouseup', () => { if (painter) setTimeout(applyPainter, 0); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && painter) { painter = null; document.body.classList.remove('painting'); updateToolbar(); } });

/* spell checking (Hunspell + Magyar Ispell, the same on every computer) */
queueMicrotask(() => { editor.registerPlugin(spellPlugin()); setSpellEnabled(editor.view, spellOn); });   // after the whole module is set up
let spellTarget = null;
editor.view.dom.addEventListener('contextmenu', e => {
  const el = e.target.closest && e.target.closest('.spell-err'); if (!el || !spellOn) return;
  e.preventDefault();
  const word = el.dataset.word || el.textContent;
  let from; try { from = editor.view.posAtDOM(el, 0); } catch (err) { return; }
  spellTarget = { word, from, to: from + word.length };
  const sg = suggestions(word);
  $('#spellList').innerHTML = (sg.length ? sg.map(w => `<button class="pitem" data-sug="${esc(w)}"><b>${esc(w)}</b></button>`).join('') : '<div class="phint">Nincs javaslat.</div>');
  $('#spellWord').textContent = `„${word}”`;
  closePops();
  const p = $('#popSpell'); p.hidden = false;
  p.style.left = Math.min(e.clientX, innerWidth - p.offsetWidth - 8) + 'px'; p.style.top = Math.min(e.clientY + 6, innerHeight - p.offsetHeight - 8) + 'px';
  openPop = p; openAnchor = el;
});
$('#popSpell').addEventListener('click', e => {
  const t = spellTarget; if (!t) return;
  const sug = e.target.closest('[data-sug]');
  if (sug) { const tr = editor.state.tr, marks = editor.state.doc.resolve(t.from + 1).marks(); tr.replaceWith(t.from, t.to, editor.state.schema.text(sug.dataset.sug, marks)); editor.view.dispatch(tr); }
  else if (e.target.closest('#spellAdd')) addToDictionary(t.word, editor.view);
  else if (e.target.closest('#spellIgnore')) ignoreWord(t.word, editor.view);
  else return;
  closePops(); editor.view.focus();
});

/* all matches are highlighted; the current one is shown and scrolled into the middle of the view */
const findKey = new PluginKey('find');
queueMicrotask(() => editor.registerPlugin(new Plugin({
  key: findKey,
  state: { init: () => DecorationSet.empty,
    apply(tr, old) { const m = tr.getMeta(findKey); if (m) return m.clear ? DecorationSet.empty : DecorationSet.create(tr.doc, m.all.map((x, i) => (x.math ? Decoration.node : Decoration.inline)(x.from, x.to, { class: i === m.cur ? 'find-hit cur' : 'find-hit' }))); return tr.docChanged ? DecorationSet.empty : old; } },
  props: { decorations(st) { return findKey.getState(st); } }
})));
function showFind(all, cur) {
  editor.view.dispatch(editor.state.tr.setMeta(findKey, { all, cur }).setMeta('addToHistory', false));
  const m = all[cur]; if (!m) return;
  requestAnimationFrame(() => {
    try {
      const c = editor.view.coordsAtPos(m.from), wr = ws.getBoundingClientRect();
      ws.scrollTo({ top: ws.scrollTop + (c.top - wr.top) - ws.clientHeight / 2, behavior: 'smooth' });
    } catch (e) { /* ignore */ }
  });
}
function clearFind() { const f = findKey.getState(editor.state); if (f && f !== DecorationSet.empty) editor.view.dispatch(editor.state.tr.setMeta(findKey, { clear: true })); }
let findAt = -1;
function findNext() {
  const re = findRegex(); if (!re) { clearFind(); return; }
  const all = findMatches(re);
  if (!all.length) { clearFind(); $('#findInfo').textContent = 'Nincs találat.'; return; }
  const from = findAt >= 0 ? findAt : editor.state.selection.from;
  let i = all.findIndex(x => x.from > from); if (i < 0) i = 0;
  findAt = all[i].from;
  editor.view.dispatch(editor.state.tr.setSelection(all[i].math ? NodeSelection.create(editor.state.doc, all[i].from) : TextSelection.create(editor.state.doc, all[i].from, all[i].to)));
  showFind(all, i);
  $('#findInfo').textContent = `${i + 1}. / ${all.length} találat` + (all[i].math ? ' – képletben (a csere a képleteket nem módosítja)' : '');
}
function replaceOne() {
  const re = findRegex(); if (!re) return;
  const { from, to } = editor.state.selection, sel = editor.state.selection instanceof NodeSelection ? '' : editor.state.doc.textBetween(from, to);
  re.lastIndex = 0;
  if (from !== to && re.test(sel) && sel.match(re)[0] === sel) { editor.chain().insertContentAt({ from, to }, $('#replIn').value).run(); findAt = from - 1 + $('#replIn').value.length; }
  findNext();
}
function replaceAll() {
  const re = findRegex(); if (!re) return;
  const found = findMatches(re), all = found.filter(m => !m.math), inMath = found.length - all.length, tr = editor.state.tr, rep = $('#replIn').value;
  for (const m of all.reverse()) { const marks = editor.state.doc.resolve(m.from + 1).marks(); if (rep) tr.replaceWith(m.from, m.to, editor.state.schema.text(rep, marks)); else tr.delete(m.from, m.to); }
  if (all.length) editor.view.dispatch(tr);
  $('#findInfo').textContent = (all.length ? `${all.length} csere.` : inMath ? 'A szövegben nincs találat.' : 'Nincs találat.') + (inMath ? ` ${inMath} képlet változatlan maradt (bennük csak keresni lehet).` : '');
}
$('#findNext').onclick = findNext; $('#findRepl').onclick = replaceOne; $('#findAll').onclick = replaceAll;
$('#findIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); findNext(); } });
$('#findIn').addEventListener('input', () => {        // live highlighting while typing
  findAt = -1; const re = findRegex(); if (!re) { clearFind(); $('#findInfo').textContent = ''; return; }
  const all = findMatches(re); if (!all.length) { clearFind(); $('#findInfo').textContent = 'Nincs találat.'; return; }
  editor.view.dispatch(editor.state.tr.setMeta(findKey, { all, cur: -1 })); $('#findInfo').textContent = `${all.length} találat`;
});
$('#findCase').addEventListener('change', () => $('#findIn').dispatchEvent(new Event('input')));
$('#popFind').onclose = () => { clearFind(); findAt = -1; };
$('#popFind').onopen = () => { const { from, to } = editor.state.selection; if (from !== to) $('#findIn').value = editor.state.doc.textBetween(from, to).slice(0, 80); $('#findInfo').textContent = ''; setTimeout(() => { $('#findIn').focus(); $('#findIn').select(); }); };

/* fonts (Matekos Prezi): the template's font set, or any family on the selected text */
registerAllFamilies();
{ const fams = allFamilies(), item = ([f, l]) => `<button class="pitem fitem" data-fam="${f}" style="font-family:${familyCSS(f)}">${l}</button>`;
  $('#fontMath').innerHTML = fams.math.map(item).join(''); $('#fontOther').innerHTML = fams.other.map(item).join(''); }
/** Font family at the cursor ('' = the template font). */
const currentFamily = () => { const ff = AE().getAttributes('textStyle').fontFamily; return ff ? (familyFromCSS(ff) || '') : ''; };
$('#popFont').onopen = () => { const f = currentFamily(); for (const b of $$('#popFont [data-fam]')) b.classList.toggle('on', b.dataset.fam === f); };
$('#popFont').addEventListener('click', e => {
  const b = e.target.closest('[data-fam]'); if (!b) return; closePops();
  const fam = b.dataset.fam;
  if (fam) loadTextFamily(fam).then(() => relayout(30));
  (fam ? ch().setFontFamily(familyCSS(fam)) : ch().unsetFontFamily()).run();
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
function rememberTable() { if (tblCtx) return; const c = tableContext(AE().state); tblCtx = c ? { pos: c.pos, rect: c.rect } : null; }
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
function closePops() { if (openPop) { const p = openPop; p.hidden = true; openPop = null; openAnchor = null; if (p.onclose) p.onclose(); } }
document.addEventListener('pointerdown', e => { if (openPop && !openPop.contains(e.target) && !(openAnchor && openAnchor.contains(e.target))) closePops(); }, true);
for (const p of $$('.pop')) p.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });

/* colour pickers (Matekos Prezi): base colours, the document's own saved colours, any colour + eyedropper */
let docColors = [];                 // saved with the document
const pickers = [];
function swatches(box, colors, onPick, noneLabel) {
  box.className = 'cpicker';
  box.innerHTML = `<div class="swg">${colors.map(c => `<button class="sw" data-c="${c}" style="background:${c}" title="${c}" aria-label="${c}"></button>`).join('')}</div>
    <div class="libwrap" hidden><div class="ptitle">A dokumentum saját színei</div><div class="swg lib"></div></div>
    <div class="ccust"><button class="tb eyed" title="Pipetta: szín felvétele a képernyőről">${svg('eyedrop')}</button>
      <label class="sw custom" title="Egyéni szín választása"><input type="color" aria-label="Egyéni szín"></label>
      <span class="chex">#000000</span><span class="sp"></span>
      <button class="btn cok" disabled>OK</button><button class="btn csave" disabled title="Hozzáadás a dokumentum saját színeihez">Mentés</button></div>
    ${noneLabel ? `<button class="sw none" data-c="none">${noneLabel}</button>` : ''}`;
  const inp = box.querySelector('input[type=color]'), hex = box.querySelector('.chex'), ok = box.querySelector('.cok'), save = box.querySelector('.csave');
  const pending = c => { inp.value = c; hex.textContent = c; ok.disabled = save.disabled = false; };
  box.addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (del) { docColors = docColors.filter(c => c !== del.dataset.del); refreshPickers(); markDirty(); saveSoon(); e.stopPropagation(); return; }
    const b = e.target.closest('button[data-c]'); if (b) { onPick(b.dataset.c); closePops(); }
  });
  inp.addEventListener('input', () => pending(inp.value));
  inp.addEventListener('change', () => pending(inp.value));
  ok.onclick = () => { onPick(inp.value); closePops(); };
  save.onclick = () => { const c = inp.value.toLowerCase(); docColors = [...new Set([...docColors, c])]; refreshPickers(); markDirty(); saveSoon(); onPick(c); closePops(); };
  box.querySelector('.eyed').onclick = async () => {
    if (!window.EyeDropper) { toast('A pipetta ezen a gépen nem érhető el.'); return; }
    const pop = openPop, anchor = openAnchor;
    try { const r = await new window.EyeDropper().open(); if (pop && anchor && pop.hidden) showPop(pop.id, anchor); pending(r.sRGBHex); } catch (e) { /* cancelled */ }
  };
  pickers.push(box); refreshPickers();
}
function refreshPickers() {
  for (const box of pickers) {
    box.querySelector('.libwrap').hidden = !docColors.length;
    box.querySelector('.lib').innerHTML = docColors.map(c => `<span class="libsw"><button class="sw" data-c="${c}" style="background:${c}" title="${c}"></button><button class="del" data-del="${c}" title="Törlés a dokumentum színei közül">×</button></span>`).join('');
  }
}
swatches($('#swText'), ['#111111', '#5d6875', '#ffffff', '#da291c', '#c0392b', '#d35400', '#b7950b', '#1e8449', '#117a65', '#1f5f74', '#2e4a9e', '#7d3c98'], c => ch().setColor(c).run());
swatches($('#swHi'), ['#fff176', '#c5f0a4', '#b3ecf5', '#f8bbd0', '#ffd59e', '#e1bee7', '#e0e0e0'], c => c === 'none' ? ch().unsetHighlight().run() : ch().setHighlight({ color: c }).run(), 'Nincs kiemelés');
swatches($('#swShade'), ['#d9d9d9', '#dbe9ee', '#e8eef5', '#eaf4e4', '#fdf3d7', '#f9e1e1', '#ece6f5', '#eeeeee'], c => {
  const empty = AE().state.selection.empty;
  if (c === 'none') return ch().unsetMark('lineShade').setParaAttrs({ shade: null }).run();
  if (empty) {                                                // cursor only: just the line the cursor is in
    const r = currentLineRange();
    if (r) AE().chain().focus(null, { scrollIntoView: false }).setTextSelection(r).setMark('lineShade', { color: c }).setTextSelection(AE().state.selection.from).run();
    else ch().setParaAttrs({ shade: c }).run();               // empty paragraph: shade its (single) line
  } else ch().setMark('lineShade', { color: c }).run();       // selection: exactly the lines it touches
}, 'Nincs sorárnyék');
/* colour settings of the template panel: the same palette as the ribbon (with the document's colours) */
let anyColorCb = null;
swatches($('#swAny'), ['#111111', '#5d6875', '#9aa3ad', '#ffffff', '#da291c', '#c0392b', '#d35400', '#b7950b', '#1e8449', '#117a65', '#1f5f74', '#2e4a9e', '#7d3c98', '#d9d9d9', '#dbe9ee', '#e8eef5', '#eaf4e4', '#fdf3d7', '#f9e1e1', '#ece6f5'], c => anyColorCb && anyColorCb(c), 'Nincs');
$('#props').addEventListener('click', e => {
  const inp = e.target.closest('input[type=color]') || (e.target.closest('.colbtn') && e.target.closest('.colbtn').querySelector('input[type=color]'));
  if (!inp) return;
  e.preventDefault();
  const host = inp.closest('.colbtn') || inp, none = host.dataset && host.dataset.none;
  $('#anyColorTitle').textContent = (host.getAttribute('title') || 'Szín').replace(/\s*\(.*$/, '');
  $('#popAnyColor').classList.toggle('nonone', !none);
  const nb = $('#swAny .sw.none'); if (nb) nb.textContent = none || 'Nincs';
  anyColorCb = c => {
    if (c === 'none') { setPath(tpl, inp.dataset.k, ''); const dot = host.querySelector && host.querySelector('.dot'); if (dot) { dot.style.setProperty('--c', 'transparent'); dot.classList.add('none'); } tplChanged(); return; }
    inp.value = c; const dot = host.querySelector && host.querySelector('.dot'); if (dot) dot.classList.remove('none');
    inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true }));
  };
  showPop('popAnyColor', host);
}, true);
swatches($('#swCell'), ['#da291c', '#e8eef5', '#eaf4e4', '#fdf3d7', '#f9e1e1', '#ece6f5', '#eeeeee', '#d6e4f0'], c => forCells('cells', () => ({ background: c === 'none' ? null : c })), 'Nincs kitöltés');

/* letter spacing (Prezi) */
const spR = $('#spacingR'), spN = $('#spacingIn');
function setSpacing(v, final) {
  if (!isFinite(v)) return;
  v = Math.round(v * 10) / 10;
  if (!final) return;
  (v ? AE().chain().focus().setLetterSpacing(v + 'pt') : AE().chain().focus().unsetLetterSpacing()).run();
}
spR.oninput = () => { spN.value = spR.value; };
spR.onchange = () => setSpacing(+spR.value, true);
spN.onchange = () => { const v = parseFloat(String(spN.value).replace(',', '.')); if (!isFinite(v)) return; spR.value = v; setSpacing(v, true); };
$('#popSpacing').onopen = () => { const ls = AE().getAttributes('textStyle').letterSpacing; spR.value = spN.value = ls ? parseFloat(ls) : 0; };

/* bullets, numbering */
const BUL = ['•', '◦', '▪', '–', '➤', '➔', '✓', '★', '◆', '❖', '☐', '→'];
$('#bulGrid').innerHTML = BUL.map(b => `<button data-bul="${b}" aria-label="${b}">${b}</button>`).join('')
  + `<button data-bulimg="matekos" title="Matekos végtelen jel" aria-label="Matekos végtelen jel"><img src="${MATEKOS_BULLET}" alt="" style="height:.7em"></button>`;
/* Lists: a change of symbol / numbering on only some items starts a new list for exactly those items */
function listAround(state, typeName) {
  const { $from, $to } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === typeName) {
      const pos = $from.before(d);
      if ($to.pos > pos + n.nodeSize) return null;
      let b = n.childCount - 1;
      const $t = state.doc.resolve(Math.min($to.pos, pos + n.nodeSize - 1));
      for (let e = $t.depth; e > 0; e--) if ($t.node(e) === n) { b = $t.index(e); break; }
      return { node: n, pos, a: $from.index(d), b };
    }
  }
  return null;
}
function applyListAttrs(typeName, attrs) {
  const ed = AE();
  if (!ed.isActive(typeName)) { ed.chain().focus()[typeName === 'bulletList' ? 'toggleBulletList' : 'toggleOrderedList']().run(); }
  const st = ed.state, r = listAround(st, typeName);
  if (!r) return;
  const { node, pos, a, b } = r, ordered = typeName === 'orderedList';
  const own = ordered && 'start' in attrs ? { cont: false } : {};        // a start number set here: numbering starts again
  if (a === 0 && b === node.childCount - 1) { ed.chain().focus().updateAttributes(typeName, { ...attrs, ...own }).run(); return; }
  const items = []; node.forEach(c => items.push(c));
  const parts = [];
  if (a > 0) parts.push(node.type.create(node.attrs, items.slice(0, a)));
  parts.push(node.type.create({ ...node.attrs, ...(ordered ? { start: 1, cont: false } : {}), ...attrs }, items.slice(a, b + 1)));
  // the items after it keep counting on (from the last list of their own numbering style on this level)
  if (b < items.length - 1) parts.push(node.type.create({ ...node.attrs, ...(ordered ? { cont: true } : {}) }, items.slice(b + 1)));
  const tr = st.tr.replaceWith(pos, pos + node.nodeSize, parts);
  ed.view.dispatch(tr.scrollIntoView()); ed.view.focus();
}
function setBullet(attrs) { applyListAttrs('bulletList', attrs); }
/** "1. a) …": the current line becomes the first item of a list inside the current item, on the same line. */
function nestSameLine(numStyle) {
  const ed = AE(), st = ed.state, { $from } = st.selection;
  let d = $from.depth; while (d > 0 && $from.node(d).type.name !== 'listItem') d--;
  if (d <= 0) { ed.chain().focus().toggleOrderedList().updateAttributes('orderedList', { numStyle }).run(); return; }
  const li = $from.node(d), liPos = $from.before(d), i = $from.index(d), S = st.schema.nodes;
  const kids = []; li.forEach(c => kids.push(c));
  const inner = S.orderedList.create({ numStyle, start: 1 }, [S.listItem.create(null, kids.slice(i))]);
  const content = i === 0 ? [S.paragraph.create(), inner] : [...kids.slice(0, i), inner];
  const tr = st.tr.replaceWith(liPos, liPos + li.nodeSize, S.listItem.create({ ...li.attrs, sameLine: i === 0 }, content));
  // cursor: same place, now inside the inner list
  const off = $from.pos - $from.start(d + 1);
  let target = liPos + 1 + (i === 0 ? 2 : kids.slice(0, i).reduce((x, n) => x + n.nodeSize, 0)) + 1 + 1 + 1 + off;
  try { tr.setSelection(TextSelection.create(tr.doc, Math.min(target, tr.doc.content.size))); } catch (e) { /* keep */ }
  ed.view.dispatch(tr.scrollIntoView()); ed.view.focus();
}
$('#popBullet').addEventListener('click', e => {
  if (e.target.closest('[data-bulimg]')) { closePops(); setBullet({ bulletImage: MATEKOS_BULLET, bulletChar: '', bulletSize: 0.7 }); return; }
  const b = e.target.closest('[data-bul]'); if (!b) return;
  closePops();
  if (b.dataset.bul === 'none') { if (AE().isActive('bulletList')) ch().toggleBulletList().run(); return; }
  setBullet({ bulletChar: b.dataset.bul, bulletImage: '' });
});
$('#popBullet').onopen = () => { const a = AE().isActive('bulletList') ? AE().getAttributes('bulletList') : null;
  $('#bulPicOk').disabled = !(bulPicPending || (a && a.bulletImage)); if (a && a.bulletImage) $('#bulPicSize').value = a.bulletSize || 0.9;
  for (const b of $$('#popBullet [data-bul]')) b.classList.toggle('on', !!a && !a.bulletImage && b.dataset.bul === (a.bulletChar || '')); };
$('#bulCustomBtn').addEventListener('click', () => { const v = $('#bulCustom').value.trim(); if (v) { closePops(); setBullet({ bulletChar: v, bulletImage: '' }); } });
$('#bulCustom').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#bulCustomBtn').click(); } });
let bulPicPending = null;          // a chosen picture, used only when OK is pressed
$('#bulPicBtn').addEventListener('click', () => pickImage(512, url => { bulPicPending = url; $('#bulPicPrev').innerHTML = `<img src="${url}" alt="">`; $('#bulPicOk').disabled = false; }));
$('#bulPicOk').addEventListener('click', () => {
  const a = AE().isActive('bulletList') ? AE().getAttributes('bulletList') : {};
  const url = bulPicPending || a.bulletImage; if (!url) return;
  closePops(); setBullet({ bulletImage: url, bulletChar: '', bulletSize: +$('#bulPicSize').value || 0.9 }); bulPicPending = null; $('#bulPicPrev').innerHTML = '';
});
$('#popNum').addEventListener('click', e => {
  const n = e.target.closest('[data-nest]'); if (n) { closePops(); nestSameLine(n.dataset.nest); return; }
  const b = e.target.closest('[data-num]'); if (!b) return; closePops();
  if (b.dataset.num === 'none') { if (AE().isActive('orderedList')) ch().toggleOrderedList().run(); return; }
  applyListAttrs('orderedList', { numStyle: b.dataset.num });
});
$('#nestOther').addEventListener('change', e => { const v = e.target.value; e.target.value = ''; if (v) { closePops(); nestSameLine(v); } });
$('#numStartOk').addEventListener('click', () => { const v = parseInt($('#numStart').value, 10); if (!(v >= 0)) return; closePops(); applyListAttrs('orderedList', { start: v }); });
$('#numStart').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#numStartOk').click(); } });
$('#popNum').onopen = () => { const on = AE().isActive('orderedList'), a = on ? AE().getAttributes('orderedList') : {};
  const st = on ? (a.numStyle || listDefaults.num) : null;
  for (const b of $$('#popNum [data-num]')) b.classList.toggle('on', b.dataset.num === st);
  $('#numStart').value = on ? (a.start ?? 1) : 1; };

/* line spacing (Prezi: list + own value) */
const LH = [1, 1.15, 1.25, 1.5, 2, 2.5];
$('#lineList').innerHTML = LH.map(v => `<button class="pitem" data-lh="${v}">${String(v).replace('.', ',')}</button>`).join('');
function lineOpen() {
  const a = AE().isActive('heading') ? AE().getAttributes('heading') : AE().getAttributes('paragraph');
  const v = a.lineHeight ? +a.lineHeight : tpl.styles[AE().isActive('heading') ? 'h' + AE().getAttributes('heading').level : 'p'].line;
  for (const b of $('#lineList').children) b.classList.toggle('on', +b.dataset.lh === v);
  $('#lhIn').value = String(v).replace('.', ',');            // always the value in effect
}
$('#lineList').addEventListener('click', e => { const b = e.target.closest('[data-lh]'); if (!b) return; closePops(); ch().setParaAttrs({ lineHeight: +b.dataset.lh }).run(); });
$('#lhOk').onclick = () => { const v = parseFloat(String($('#lhIn').value).replace(',', '.')); if (!(v >= 0.5 && v <= 5)) return; closePops(); ch().setParaAttrs({ lineHeight: Math.round(v * 100) / 100 }).run(); };
$('#lhIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#lhOk').click(); } });

/* paragraph: indents, first line / hanging, spacing (Prezi) */
$('#popPara').onopen = () => {
  lineOpen();
  const a = AE().isActive('heading') ? AE().getAttributes('heading') : AE().getAttributes('paragraph');
  const sk = AE().isActive('heading') ? 'h' + AE().getAttributes('heading').level : 'p';
  for (const inp of $$('#popPara [data-pf]')) {
    const k = inp.dataset.pf;
    if (k === 'keepNext') inp.checked = a.keepNext ?? !!(tpl.styles[sk] && tpl.styles[sk].keepNext);
    else if (k === 'ctx') inp.checked = a.ctx ?? (AE().isActive('listItem') ? !!tpl.lists.contextual : !!(tpl.styles[sk] && tpl.styles[sk].contextual));
    else if (inp.type === 'checkbox') inp.checked = !!a[k];
    else {      // the value in effect: set on the paragraph, or the style's (never an empty box)
      const st = AE().isActive('listItem') && !AE().isActive('heading') ? { ...tpl.styles.p, indentLeft: 0, firstLine: 0 } : tpl.styles[sk] || {};
      const fromStyle = { indentLeft: st.indentLeft, indentRight: st.indentRight, spaceBefore: st.spaceBefore, spaceAfter: st.spaceAfter }[k];
      inp.value = a[k] ?? (fromStyle ?? 0);
    }
  }
  const lst = listAroundAny(AE().state);
  const hang = (lst && lst.node.attrs.gap) || a.hang || (a.firstLine < 0 ? -a.firstLine : 0);
  const fl = a.firstLine ?? (AE().isActive('listItem') ? 0 : (tpl.styles[sk] || {}).firstLine || 0);
  const hang2 = hang || (fl < 0 ? -fl : 0);
  $('#pfFirstKind').value = hang2 ? 'hang' : fl > 0 ? 'first' : 'none';
  $('#pfFirstVal').value = hang2 || (fl > 0 ? fl : 0);
};
/** The outermost list around the cursor. */
function listAroundAny(state) {
  const $f = state.selection.$from;
  for (let d = 1; d <= $f.depth; d++) if (/List$/.test($f.node(d).type.name)) return { node: $f.node(d), pos: $f.before(d) };
  return null;
}
function applyFirstLine() {
  const kind = $('#pfFirstKind').value, v = Math.max(0, parseFloat(String($('#pfFirstVal').value).replace(',', '.')) || 0);
  const { state } = editor, tr = state.tr;
  const outer = listAroundAny(state);
  if (outer && (kind === 'hang' || (outer.node.attrs.gap && kind === 'none'))) {
    // a list: the same symbol-to-text gap on every level; the inner symbols stand where the outer text starts
    tr.setNodeMarkup(outer.pos, undefined, { ...outer.node.attrs, gap: kind === 'hang' && v ? v : null });
    outer.node.descendants((n, rel) => { if (n.type.name === 'paragraph' && (n.attrs.hang || n.attrs.firstLine)) tr.setNodeMarkup(outer.pos + 1 + rel, undefined, { ...n.attrs, hang: null, firstLine: null }); });
    editor.view.dispatch(tr); return;
  }
  let { from, to } = state.selection;
  if (kind === 'hang') {             // in a list: every level of the whole list gets the same hanging indent
    const $f = state.doc.resolve(from);
    for (let d = 1; d <= $f.depth; d++) if (/List$/.test($f.node(d).type.name)) { from = $f.before(d); to = from + $f.node(d).nodeSize; break; }
  }
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
  AE().view.dispatch(tr);
}
$('#pfFirstKind').addEventListener('change', applyFirstLine);
/* tab stops of the selected paragraphs */
/** The stops of the selected paragraph: its own, or – when it has none – those of its paragraph style in the template. */
function tabInfo() {
  const head = AE().isActive('heading'), a = head ? AE().getAttributes('heading') : AE().getAttributes('paragraph');
  if (a.tabStops === 'hf') return { list: [], fromTpl: false };
  if (a.tabStops) { try { return { list: JSON.parse(a.tabStops), fromTpl: false }; } catch (e) { return { list: [], fromTpl: false }; } }
  const k = head ? 'h' + (a.level || 1) : 'p', st = hfEd ? null : (tpl.styles[k] || {}).tabs;
  return st && st.length ? { list: st.map(x => ({ ...x })), fromTpl: true } : { list: [], fromTpl: false };
}
const curTabs = () => tabInfo().list;
const AL = { left: 'balra', center: 'középre', right: 'jobbra' }, LD = { dot: ', pontozott', line: ', vonallal' };
let tabEditing = -1;                 // the row being edited in the popup
function showTabs() {
  const { list: t, fromTpl } = tabInfo();
  $('#tabFromTpl').hidden = !fromTpl;
  const lead = v => `<option value=""${!v ? ' selected' : ''}>üres</option><option value="dot"${v === 'dot' ? ' selected' : ''}>pont</option><option value="line"${v === 'line' ? ' selected' : ''}>vonal</option>`;
  $('#tabList').innerHTML = t.length ? t.map((x, i) => i === tabEditing
    ? `<div class="tabrow editing"><input type="number" step="0.25" min="0.25" class="tabEdPos" value="${x.pos}" aria-label="Pozíció (cm)"><span class="unit">cm</span><select class="tabEdLead" aria-label="Kitöltés">${lead(x.leader)}</select><button class="btn primary" data-oktab="${i}">OK</button></div>`
    : `<div class="tabrow${fromTpl ? ' tpl' : ''}"><span>${String(x.pos).replace('.', ',')} cm – ${AL[x.align] || 'balra'}${LD[x.leader] || ''}${fromTpl ? ' (sablon)' : ''}</span><span class="tabbtns"><button class="tb mini" data-edtab="${i}" title="Pozíció és kitöltés módosítása">${svg('edit')}</button><button class="tb mini" data-deltab="${i}" title="Tabulátor törlése">✕</button></span></div>`).join('')
    : '<div class="phint" style="margin:2px 0 4px">Nincs tabulátor.</div>';
  const inp = $('#tabList .tabEdPos'); if (inp) { inp.focus(); inp.select(); }
}
/** The stops of the selected paragraphs (an empty list over the template's stops: none here, on purpose). */
function setTabs(list) {
  const fromTpl = tabInfo().fromTpl; tabEditing = -1;
  list.sort((a, b) => a.pos - b.pos);
  AE().chain().setParaAttrs({ tabStops: list.length ? JSON.stringify(list) : (fromTpl ? '[]' : null) }).run(); showTabs(); relayout(0);
}
function okTabEdit(i) {
  const row = $('#tabList .tabrow.editing'); if (!row) return;
  const v = parseFloat(String(row.querySelector('.tabEdPos').value).replace(',', '.')), lead = row.querySelector('.tabEdLead').value;
  if (!(v > 0 && v < 60)) { row.querySelector('.tabEdPos').focus(); return; }
  const t = curTabs(), old = t[i]; if (!old) return;
  const { leader, ...rest } = old;
  t.splice(i, 1);
  setTabs([...t.filter(x => x.pos !== v), { ...rest, pos: v, ...(lead ? { leader: lead } : {}) }]);
}
$('#tabAdd').addEventListener('click', () => { const v = parseFloat(String($('#tabPos').value).replace(',', '.')); if (!(v > 0 && v < 60)) return; setTabs([...curTabs().filter(x => x.pos !== v), { pos: v, align: $('#tabAlign').value, ...($('#tabLeader').value ? { leader: $('#tabLeader').value } : {}) }]); $('#tabPos').value = ''; });
$('#popTabs').onopen = () => { tabEditing = -1; showTabs(); };
$('#tabRightMargin').addEventListener('click', () => {      // right tab exactly at the right margin (width of the text column)
  const v = Math.round(editor.view.dom.clientWidth / (96 / 2.54) * 100) / 100;
  setTabs([...curTabs().filter(x => Math.abs(x.pos - v) > 0.01), { pos: v, align: 'right', ...($('#tabLeader').value ? { leader: $('#tabLeader').value } : {}) }]);
});
$('#tabList').addEventListener('click', e => {
  const ed = e.target.closest('[data-edtab]'); if (ed) { tabEditing = +ed.dataset.edtab; showTabs(); return; }
  const ok = e.target.closest('[data-oktab]'); if (ok) { okTabEdit(+ok.dataset.oktab); return; }
  const b = e.target.closest('[data-deltab]'); if (!b) return; const t = curTabs(); t.splice(+b.dataset.deltab, 1); setTabs(t);
});
$('#tabList').addEventListener('keydown', e => {
  if (!e.target.closest('.tabrow.editing')) return;
  if (e.key === 'Enter') { e.preventDefault(); okTabEdit(tabEditing); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); tabEditing = -1; showTabs(); }
});
/* margin-to-margin line above / below the paragraph */
let ruleW = 0.5, ruleC = '#111111';
$('#ruleW').addEventListener('click', e => { const b = e.target.closest('[data-rw]'); if (!b) return; ruleW = +b.dataset.rw; for (const x of $$('#ruleW [data-rw]')) x.classList.toggle('on', x === b); });
$('#popRule').addEventListener('click', e => {
  const b = e.target.closest('[data-rule]'); if (!b) return;
  const a = AE().isActive('heading') ? AE().getAttributes('heading') : AE().getAttributes('paragraph'), val = `${ruleW} ${ruleC}`;
  if (b.dataset.rule === 'none') AE().chain().focus().setParaAttrs({ ruleTop: null, ruleBottom: null }).run();
  else if (b.dataset.rule === 'top') AE().chain().focus().setParaAttrs({ ruleTop: a.ruleTop ? null : val }).run();
  else AE().chain().focus().setParaAttrs({ ruleBottom: a.ruleBottom ? null : val }).run();
  closePops();
});
$('#popRule').onopen = () => { const a = AE().isActive('heading') ? AE().getAttributes('heading') : AE().getAttributes('paragraph');
  $('[data-rule="top"]').classList.toggle('on', !!a.ruleTop); $('[data-rule="bottom"]').classList.toggle('on', !!a.ruleBottom); };
swatches($('#swRule'), ['#111111', '#5d6875', '#9aa3ad', '#da291c', '#1f5f74', '#2e4a9e', '#1e8449'], c => { ruleC = c === 'none' ? '#111111' : c; showPop('popRule', $('[data-pop="popRule"]')); });
$('#pfFirstVal').addEventListener('change', applyFirstLine);
$('#popPara').addEventListener('change', e => {
  const k = e.target.dataset.pf; if (!k) return;
  const v = e.target.type === 'checkbox' ? e.target.checked : (e.target.value === '' ? null : +e.target.value);
  AE().chain().setParaAttrs({ [k]: v }).run();
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
  tableCmd(b.dataset.tbl);
});
/** Table commands; a new row / column takes over the look of the one next to it (fill, borders, text position,
 *  paragraph formatting, row height). */
function tableCmd(cmd) {
  const before = tableContext(editor.state);
  editor.chain().focus()[cmd]().run();
  if (!before || !/^add(Row|Column)(Before|After)$/.test(cmd)) return;
  const c = tableContext(editor.state); if (!c) return;
  const { map, table, start } = c, isRow = cmd.startsWith('addRow'), after = cmd.endsWith('After');
  const newIdx = isRow ? (after ? before.rect.bottom : before.rect.top) : (after ? before.rect.right : before.rect.left);
  const srcIdx = after ? newIdx - 1 : newIdx + 1;
  const tr = editor.state.tr, done = new Set();
  const n = isRow ? map.width : map.height;
  for (let k = 0; k < n; k++) {
    const [r, cc, rs, cs] = isRow ? [newIdx, k, srcIdx, k] : [k, newIdx, k, srcIdx];
    if (r >= map.height || cc >= map.width || rs < 0 || cs < 0 || rs >= map.height || cs >= map.width) continue;
    const relN = map.map[r * map.width + cc], relS = map.map[rs * map.width + cs];
    if (relN === relS || done.has(relN)) continue; done.add(relN);
    const nCell = table.nodeAt(relN), sCell = table.nodeAt(relS); if (!nCell || !sCell) continue;
    const keep = { colspan: nCell.attrs.colspan, rowspan: nCell.attrs.rowspan, colwidth: nCell.attrs.colwidth };
    tr.setNodeMarkup(tr.mapping.map(start + relN), undefined, { ...sCell.attrs, ...keep });
    const sp = sCell.firstChild, np = nCell.firstChild;
    if (sp && np && np.type === sp.type) tr.setNodeMarkup(tr.mapping.map(start + relN + 1), undefined, { ...sp.attrs });
  }
  if (isRow) {                                   // the same row height
    let oN = null, oS = null; table.forEach((row, o, i) => { if (i === newIdx) oN = [o, row]; if (i === srcIdx) oS = [o, row]; });
    if (oN && oS) tr.setNodeMarkup(tr.mapping.map(start + oN[0]), undefined, { ...oN[1].attrs, height: oS[1].attrs.height });
  }
  if (tr.docChanged) editor.view.dispatch(tr);
}

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
  // always the value in effect (also when it is automatic): measured on the page
  const r1 = n => Math.round(n * 10) / 10;
  const rowIdx = Math.min(c.rect.top, c.table.childCount - 1), row = c.table.child(rowIdx);
  let rowOff = 0; c.table.forEach((r, o, i) => { if (i === rowIdx) rowOff = o; });
  const rowDom = editor.view.nodeDOM(c.start + rowOff);
  if (act !== $('#tpRowH')) $('#tpRowH').value = row.attrs.height || (rowDom ? r1(rowDom.getBoundingClientRect().height / scale / MM) : '');
  const cellRel = c.map.map[c.rect.top * c.map.width + c.rect.left], cell = c.table.nodeAt(cellRel), cellDom = editor.view.nodeDOM(c.start + cellRel);
  if (act !== $('#tpColW')) $('#tpColW').value = cell && cell.attrs.colwidth && cell.attrs.colwidth[0] ? r1(cell.attrs.colwidth[0] / MM) : (cellDom ? r1(cellDom.getBoundingClientRect().width / scale / MM) : '');
  const ccs = cellDom ? getComputedStyle(cellDom) : null;
  $('#tblPin').classList.toggle('on', !!c.table.attrs.pin);
  for (const b of $$('#tableBar [data-talign]')) b.disabled = !!c.table.attrs.pin;   // alignment means nothing for a free table
  if (act !== $('#tpPadV')) $('#tpPadV').value = c.table.attrs.padV ?? (ccs ? r1(parseFloat(ccs.paddingTop) / MM) : '');
  if (act !== $('#tpPadH')) $('#tpPadH').value = c.table.attrs.padH ?? (ccs ? r1(parseFloat(ccs.paddingLeft) / MM) : '');
  for (const b of $$('#tableBar [data-talign]')) b.classList.toggle('on', (c.table.attrs.align || 'left') === b.dataset.talign);
}
for (const [id, k] of [['#tpPadV', 'padV'], ['#tpPadH', 'padH']]) $(id).addEventListener('change', e => {
  const v = e.target.value === '' ? null : Math.max(0, Math.min(20, parseFloat(String(e.target.value).replace(',', '.')) || 0));
  setTableAttrs({ [k]: v });
});
for (const id of ['#tpWidth', '#tpRowH', '#tpColW', '#tpPadV', '#tpPadH']) {
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
/* Header and footer: three columns (left, centre, right – the side    */
/* columns are equally wide), edited on the page, opened from the      */
/* template panel; the ribbon formats the column being edited          */
/* ------------------------------------------------------------------ */
const HF_EXT = () => [
  StarterKit.configure({ heading: false, code: false, codeBlock: false, blockquote: false, horizontalRule: false, link: false,
    bulletList: false, orderedList: false, listItem: false, listKeymap: false, dropcursor: false, gapcursor: false, trailingNode: false }),
  TextStyle, Color, FontSize, FontFamily, LetterSpacing, TextCase, FontOverrides,
  Highlight.configure({ multicolor: true }), TextAlign.configure({ types: ['paragraph'] }), Subscript, Superscript, ParaFormat
];
let hfExtCache = null;
const hfExtensions = () => hfExtCache || (hfExtCache = HF_EXT());
function hfRenderCache() {
  const map = { header: {}, footer: {} };
  for (const k of ['header', 'footer']) for (const v of ['odd', 'even', 'first']) {
    map[k][v] = {};
    for (const p of ['l', 'c', 'r']) {
      const d = tpl[k][v][p];
      try { map[k][v][p] = d ? generateHTML(d, hfExtensions()) : ''; } catch (e) { map[k][v][p] = ''; }
    }
  }
  setHfHTML(map);
}
let hfOpen = null;        // {kind, v, i, box, eds}
const hfEds = [];         // the three cell editors while open
/** Header/footer lines run across the whole box: under (or above) all three columns. */
function hfRules() { /* lines are set by the template (box) and by the paragraphs (columns) */ }
/** Open the header / footer of the given variant on the first page that uses it. */
function editHF(kind, v, keep) {
  if (hfOpen) closeHF();
  let i = 0;
  for (let k = 0; k < pageCount; k++) if (variantFor(tpl, k) === v) { i = k; break; }
  if (variantFor(tpl, i) !== v) { toast(v === 'even' ? 'A dokumentumnak még nincs páros oldala.' : 'Ez az oldaltípus nem szerepel a dokumentumban.'); return; }
  const box = pagesEl.querySelector(`.hf[data-hf="${kind}"][data-i="${i}"]`); if (!box) return;
  // show that page
  const g = geometry(tpl), pageTop = outer.offsetTop + i * g.P * scale;
  if (!keep) ws.scrollTo({ top: kind === 'header' ? pageTop - 40 : pageTop + g.H * scale - ws.clientHeight + 60 });
  box.classList.add('editing');
  stack.classList.add('hfmode');
  const label = document.createElement('div');
  label.className = 'hf-label';
  label.textContent = `${kind === 'header' ? 'Élőfej' : 'Élőláb'} – ${{ odd: tpl.oddEven ? 'páratlan oldalak' : 'minden oldal', even: 'páros oldalak', first: 'első oldal' }[v]} · befejezés: „Kész” a jobb oldali panelen`;
  box.appendChild(label);
  for (const cellEl of box.querySelectorAll('.hf-text')) {
    const p = cellEl.dataset.cell;
    cellEl.innerHTML = '';
    const ed = new Editor({
      element: cellEl, extensions: hfExtensions(), content: tpl[kind][v][p],
      editorProps: { attributes: { class: 'hf-editor', spellcheck: 'false', lang: 'hu' },
        handleKeyDown: (view, e) => {
          if (e.key === 'Tab') { const k = hfEds.indexOf(ed), n = hfEds[(k + (e.shiftKey ? 2 : 1)) % 3]; if (n) { n.commands.focus('end'); } return true; }   // next column
          return false;
        } },
      onFocus: () => { hfEd = ed; updateToolbar(); },
      onTransaction: () => { if (hfEd === ed) updateToolbar(); requestAnimationFrame(() => hfRules()); },
      onSelectionUpdate: () => { if (hfEd === ed) updateToolbar(); }
    });
    ed._cell = p;
    hfEds.push(ed);
  }
  hfOpen = { kind, v, i, box };
  const fc = keep && keep.cell ? hfEds.find(e => e._cell === keep.cell) : hfEds[0];
  hfEd = fc || hfEds[0];
  if (!keep || keep.focus) requestAnimationFrame(() => hfEd && hfEd.commands.focus('end'));
  updateToolbar(); fillPanel();
}
function closeHF() {
  if (!hfOpen) return;
  const { kind, v } = hfOpen;
  for (const ed of hfEds) { tpl[kind][v][ed._cell] = ed.getJSON(); ed.destroy(); }
  hfEds.length = 0; hfOpen = null; hfEd = null;
  stack.classList.remove('hfmode');
  markDirty(); applyTpl(); renderSheets(pagesEl, pageCount, tpl, docTitle(), true); hfRules(); saveSoon(); updateToolbar(); fillPanel();
  noteTplChange();
}
$('#props').addEventListener('click', e => {
  const ed = e.target.closest('[data-edithf]');
  if (ed) { if (hfOpen && hfOpen.kind === ed.dataset.edithf) closeHF(); else editHF(ed.dataset.edithf, hfVariant); return; }
  const b = e.target.closest('[data-field]'); if (!b) return;
  if (!hfEd) { toast('Előbb nyisd meg szerkesztésre az élőfejet vagy az élőlábat.'); return; }
  hfEd.chain().focus().insertContent(b.dataset.field).run();
});

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
  // the preview shows the formula in the font it will really have there
  let look;
  try {
    if (node) look = lookOf(node, editor.view.nodeDOM(pos));
    else { const d = editor.view.domAtPos(sel.from), el = d.node.nodeType === 1 ? d.node : d.node.parentElement; look = lookAtDom(el, marksAt(editor.state).some(m => m.type.name === 'bold')); }
  } catch (e) { look = null; }
  openMathEditor({
    tex, editing: !!node, look, top: $('#app').getBoundingClientRect().bottom + 10, wrap: node ? !!node.attrs.wrap : true,
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
      if (t) {
        const st = editor.state, node = st.schema.nodes.math.create({ tex: t, display: false, wrap: !!wrap }, null, marksAt(st));
        editor.view.dispatch(st.tr.replaceSelectionWith(node, false).scrollIntoView()); editor.view.focus();
      }
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
const lsGet = k => load(k);
const LSK = { left: 'matekosdoksi.leftw', right: 'matekosdoksi.rightw', panel: 'matekosdoksi.panel', sections: 'matekosdoksi.sections' };
const mainEl = $('#main'), plist = $('#plist'), props = $('#props');
function setLeftWidth(w) { w = Math.max(120, Math.min(420, Math.round(w))); document.body.style.setProperty('--lw', w + 'px'); mainEl.style.setProperty('--lw', w + 'px'); return w; }
function setRightWidth(w) { w = Math.max(260, Math.min(560, Math.round(w))); document.body.style.setProperty('--rw', w + 'px'); mainEl.style.setProperty('--rw', w + 'px'); return w; }
setLeftWidth(+lsGet(LSK.left) || 176); setRightWidth(+lsGet(LSK.right) || 320);
function splitter(el, get, set, key, sign) {
  el.addEventListener('pointerdown', e => {
    e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('drag');
    const x0 = e.clientX, w0 = get();
    const mv = ev => { set(w0 + sign * (ev.clientX - x0)); applyZoom(); };
    const up = ev => { el.releasePointerCapture(ev.pointerId); el.classList.remove('drag'); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up);
      lsSet(key, String(set(w0 + sign * (ev.clientX - x0)))); applyZoom(); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  });
}
splitter($('#lsplit'), () => $('#pagesNav').getBoundingClientRect().width, setLeftWidth, LSK.left, 1);
splitter($('#rsplit'), () => props.getBoundingClientRect().width, setRightWidth, LSK.right, -1);
/** The right panel shows the template editor or the comments ("cmt"). */
function panelVisible(v, view = 'tpl') {
  mainEl.classList.toggle('noprops', !v); document.body.classList.toggle('noprops-on', !v);
  $('#props').classList.toggle('cmtmode', v && view === 'cmt');
  $('#bTpl').classList.toggle('primary', v && view !== 'cmt'); $('#bCmt').classList.toggle('primary', v && view === 'cmt');
  lsSet(LSK.panel, v && view !== 'cmt' ? '1' : '0'); applyZoom();
  if (v && view !== 'cmt') fillPanel();
  if (v && view === 'cmt') renderComments();
  if (typeof drawComments === 'function') drawComments();
}
const panelView = () => mainEl.classList.contains('noprops') ? null : ($('#props').classList.contains('cmtmode') ? 'cmt' : 'tpl');
$('#bTpl').addEventListener('click', () => panelVisible(panelView() !== 'tpl', 'tpl'));
$('#bCmt').addEventListener('click', () => panelVisible(panelView() !== 'cmt', 'cmt'));

/* ------------------------------------------------------------------ */
/* Comments: attached to text (a mark), a picture or table cells (an  */
/* attribute); listed in the order of the document; saved in the file */
/* ------------------------------------------------------------------ */
let docComments = [];               // [{id, text, at, done, replies:[{text, at}]}]
const cmtDate = t => new Date(t).toLocaleString('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
/** Where each comment is in the document: id -> first position */
function commentPlaces() {
  const at = {};
  editor.state.doc.descendants((n, pos) => {
    if (n.attrs && n.attrs.cmt) for (const id of String(n.attrs.cmt).split(' ')) if (id && at[id] == null) at[id] = pos;
    for (const m of n.marks || []) if (m.type.name === 'comment' && at[m.attrs.id] == null) at[m.attrs.id] = pos;
  });
  return at;
}
let cmtFilter = load('matekosdoksi.cmtfilter') === 'open' ? 'open' : 'all';      // 'open': resolved comments are not listed
/** Every reviewer has a colour of their own (from the name), shown behind the profile icon. */
function avatarColor(name) { let h = 0; for (const ch of String(name).trim().toLowerCase()) h = (h * 31 + ch.codePointAt(0)) % 360; return `hsl(${h} 55% 45%)`; }
/** The name written on new comments and replies (asked once, kept by the app). Null (and a hint) while it is missing. */
function cmtAuthor() {
  const inp = $('#cmtAuthor'), name = inp.value.trim().slice(0, 40);
  if (!name) { toast('Írd be a neved – ez kerül a megjegyzéseidre.'); inp.focus(); return null; }
  store('matekosdoksi.author', name); return name;
}
const orderedComments = (at = commentPlaces()) => [...docComments].sort((a, b) => (at[a.id] ?? 1e12) - (at[b.id] ?? 1e12));
/** Jump to the next / previous unresolved comment (dir = 1 / -1), going round at the ends. */
function stepOpenComment(dir) {
  const open = orderedComments().filter(c => !c.done);
  if (!open.length) { toast('Nincs nyitott megjegyzés.'); return; }
  const i = open.findIndex(c => c.id === activeCmt);
  const c = open[i < 0 ? (dir > 0 ? 0 : open.length - 1) : (i + dir + open.length) % open.length];
  showCommentPlace(c.id); renderComments(); focusCard(c.id);
}
function renderComments() {
  const at = commentPlaces();
  const all = orderedComments(at), nOpen = all.filter(c => !c.done).length;
  const list = cmtFilter === 'open' ? all.filter(c => !c.done) : all;
  $('#cmtCount').textContent = all.length ? `${nOpen} nyitott / ${all.length}` : '';
  for (const b of $$('#cmtView [data-cflt]')) b.classList.toggle('on', b.dataset.cflt === cmtFilter);
  $('#cmtPrev').disabled = $('#cmtNext').disabled = !nOpen;
  const who = x => x.by ? `<span class="cav" style="--c:${avatarColor(x.by)}">${svg('user')}</span><b class="cby">${esc(x.by)}</b>` : '';
  $('#cmtList').innerHTML = list.length ? list.map(c => `<div class="cmtcard${c.done ? ' done' : ''}${c.id === activeCmt ? ' act' : ''}" data-cid="${c.id}">
      <div class="ctop"><span class="cdate">${who(c)}${cmtDate(c.at)}</span>
        <button class="tb mini${c.done ? ' on' : ''}" data-cact="done" title="${c.done ? 'Mégsem megoldott' : 'Megoldva'}">${svg('tick')}</button>
        <button class="tb mini" data-cact="del" title="Megjegyzés törlése">${svg('xmark')}</button></div>
      <div class="ctext">${esc(c.text).replace(/\n/g, '<br>')}</div>
      ${(c.replies || []).map(r => `<div class="creply"><span class="cdate">${who(r)}${cmtDate(r.at)}</span><div>${esc(r.text).replace(/\n/g, '<br>')}</div></div>`).join('')}
      <div class="crow"><input type="text" class="cin" placeholder="Válasz…"><button class="btn mini" data-cact="reply">Válasz</button></div>
    </div>`).join('') : all.length ? '<div class="phint" style="padding:6px 2px">Nincs nyitott megjegyzés – minden meg van oldva. A „Mind” gombbal a megoldottak is látszanak.</div>' : '<div class="phint" style="padding:6px 2px">Még nincs megjegyzés. Jelölj ki valamit a dokumentumban, írd be a megjegyzést fent, és kattints a „Megjegyzés hozzáadása” gombra.</div>';
  drawComments();  thumbsSoon();                       // the comment counts on the page miniatures
}
function addComment() {
  const text = $('#cmtText').value.trim();
  const st = editor.state;
  let sel = st.selection;
  if (cmtSel && sel.empty) { try { sel = cmtSel.node ? NodeSelection.create(st.doc, cmtSel.from) : TextSelection.create(st.doc, cmtSel.from, cmtSel.to); } catch (e) { /* keep */ } }
  if (!text) { toast('Írd be a megjegyzés szövegét.'); $('#cmtText').focus(); return; }
  const by = cmtAuthor(); if (!by) return;
  const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const tr = st.tr;
  const addId = v => (v ? v + ' ' : '') + id;
  if (sel instanceof NodeSelection && sel.node.type.name === 'image') tr.setNodeMarkup(sel.from, undefined, { ...sel.node.attrs, cmt: addId(sel.node.attrs.cmt) });
  else if (sel instanceof CellSelection) sel.forEachCell((cell, pos) => tr.setNodeMarkup(pos, undefined, { ...cell.attrs, cmt: addId(cell.attrs.cmt) }));
  else if (!sel.empty) tr.addMark(sel.from, sel.to, st.schema.marks.comment.create({ id }));
  else { toast('Előbb jelölj ki szöveget, egy képet vagy táblázatcellát.'); return; }
  editor.view.dispatch(tr);
  docComments.push({ id, text, by, at: Date.now(), done: false, replies: [] });
  $('#cmtText').value = ''; cmtSel = null;
  markDirty(); saveSoon(); activeCmt = id; renderComments(); focusCard(id);
}
function removeCommentAnchors(id) {
  const st = editor.state, tr = st.tr, type = st.schema.marks.comment;
  st.doc.descendants((n, pos) => {
    if (n.attrs && n.attrs.cmt && String(n.attrs.cmt).split(' ').includes(id)) { const rest = String(n.attrs.cmt).split(' ').filter(x => x && x !== id).join(' '); tr.setNodeMarkup(pos, undefined, { ...n.attrs, cmt: rest || null }); }
    if (n.isInline) for (const m of n.marks) if (m.type === type && m.attrs.id === id) tr.removeMark(pos, pos + n.nodeSize, m);   // text and formulas
  });
  if (tr.docChanged) editor.view.dispatch(tr);
}
/** The page elements of a comment (text pieces, picture, cells). */
const commentEls = id => [...editor.view.dom.querySelectorAll(`[data-cmt~="${id}"]`)];
/** Scroll `box` to `top` in a short animation of our own. */
const glides = new WeakMap();
function glideTo(box, top) {
  top = Math.max(0, Math.min(top, box.scrollHeight - box.clientHeight));
  cancelAnimationFrame(glides.get(box) || 0);
  const from = box.scrollTop, d = top - from; if (Math.abs(d) < 1) { box.scrollTop = top; return; }
  const t0 = performance.now(), T = Math.min(420, 180 + Math.abs(d) / 12);
  const step = now => { const k = Math.min(1, (now - t0) / T), e = 1 - Math.pow(1 - k, 3); box.scrollTop = from + d * e; if (k < 1) glides.set(box, requestAnimationFrame(step)); };
  glides.set(box, requestAnimationFrame(step));
}
/** Scroll `box` (instantly) so that `el` is fully visible in it. */
function keepVisible(box, el) {
  const b = box.getBoundingClientRect(), r = el.getBoundingClientRect();
  if (r.top < b.top) box.scrollTop += r.top - b.top - 6; else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 6;
}
function focusCard(id) {
  const card = $(`#cmtList [data-cid="${id}"]`); if (!card) return;
  for (const c of $$('#cmtList .cmtcard.act')) c.classList.remove('act');
  card.classList.add('act');
  let box = card.parentElement; while (box && box !== document.body && !(box.scrollHeight > box.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
  if (box && box !== document.body) keepVisible(box, card);
  activeCmt = id; drawComments();
}
/** Scroll the document to a comment's place (its first highlighted part, a third down the window). */
function showCommentPlace(id) {
  const els = commentEls(id);
  let r = els.length ? els[0].getBoundingClientRect() : null;
  if (!r || (!r.width && !r.height)) {                     // not drawn as an element (e.g. on an empty paragraph): its position
    const at = commentPlaces()[id]; if (at == null) return;
    try { const c = editor.view.coordsAtPos(Math.min(at + 1, editor.state.doc.content.size)); r = { top: c.top }; } catch (e) { return; }
  }
  const wr = ws.getBoundingClientRect();
  glideTo(ws, ws.scrollTop + r.top - wr.top - ws.clientHeight / 3);
  activeCmt = id; drawComments();
}
var keptSel = null;                 // the text selection shown while a box of a popup / the panel has the focus
document.addEventListener('focusin', e => {
  const t = e.target;
  if (editor.view.dom.contains(t)) { if (keptSel) { keptSel = null; drawComments(); } return; }
  if (!t.matches || !t.matches('input, select, textarea')) return;
  const s0 = editor.state.selection;
  if (!s0.empty && !(s0 instanceof NodeSelection)) { keptSel = { from: s0.from, to: s0.to }; drawComments(); }
});
let activeCmt = null, cmtRaf = 0, cmtSel = null, cmtHidden = load('matekosdoksi.cmthide') === '1';
/** Screen rectangles of a selection {from, to, node}. */
function selRects(sel) {
  try {
    if (sel.node) { const d = editor.view.nodeDOM(sel.from); return d ? [d.getBoundingClientRect()] : []; }
    const a = editor.view.domAtPos(sel.from), b = editor.view.domAtPos(sel.to), rg = document.createRange();
    rg.setStart(a.node, a.offset); rg.setEnd(b.node, b.offset);
    return [...rg.getClientRects()].filter(q => q.width > 0 && q.height > 0);
  } catch (e) { return []; }
}
function setCmtHidden(v) {
  cmtHidden = v; lsSet('matekosdoksi.cmthide', v ? '1' : '0');
  $('#cmtHide').classList.toggle('on', v);
  $('#cmtHide').title = v ? 'A megjegyzések jelölése el van rejtve a lapon, amíg a panel zárva van – kattints a megjelenítéshez' : 'A megjegyzések jelölése a lapon akkor is látszik, ha a panel zárva van – kattints az elrejtéshez';
  drawComments();
}
const cmtShown = () => !(cmtHidden && panelView() !== 'cmt');
let cmtShownWas = null;
function drawComments() {
  if (cmtShownWas !== cmtShown()) { cmtShownWas = cmtShown(); thumbsSoon(true); }       // the miniatures' comment marks follow
  if (cmtRaf) return;
  cmtRaf = requestAnimationFrame(() => {
    cmtRaf = 0;
    const layer = $('#cmtLayer'), sr = stack.getBoundingClientRect(), out = [], top = [];
    if (cmtHidden && panelView() !== 'cmt') { layer.innerHTML = ''; $('#cmtTop').innerHTML = ''; return; }
    const done = new Set(docComments.filter(c => c.done).map(c => c.id));
    const txt = [], obj = [];
    for (const el of editor.view.dom.querySelectorAll('[data-cmt]')) {
      const ids = el.dataset.cmt.split(' ').filter(Boolean);
      const text = el.tagName === 'SPAN' && !el.classList.contains('imgw');
      if (!text) { const q = el.getBoundingClientRect(); if (q.width && q.height) obj.push({ l: q.left, t: q.top, r: q.right, b: q.bottom, ids }); continue; }
      // a formula counts with its own drawing (not with the room around it), text with its line pieces
      const maths = [...el.querySelectorAll('.math')].map(m => (m.querySelector('mjx-container') || m).getBoundingClientRect());
      const own = [...el.getClientRects()].filter(q => !maths.some(m => q.left >= m.left - 1 && q.right <= m.right + 1));
      for (const q of [...own, ...maths]) if (q.width && q.height) txt.push({ l: q.left, t: q.top, r: q.right, b: q.bottom, ids });
    }
    // pieces on the same line that touch or overlap become one band (no doubled colour, the height of the tallest)
    const merge = list => {
      list.sort((p, q) => p.t - q.t || p.l - q.l);
      const out2 = [];
      for (const x of list) {
        const m = out2.find(y => x.l <= y.r + 1 && x.r >= y.l - 1 && Math.min(x.b, y.b) - Math.max(x.t, y.t) > Math.min(x.b - x.t, y.b - y.t) * 0.4);
        if (m) { m.l = Math.min(m.l, x.l); m.r = Math.max(m.r, x.r); m.t = Math.min(m.t, x.t); m.b = Math.max(m.b, x.b); for (const id of x.ids) if (!m.ids.includes(id)) m.ids.push(id); }
        else out2.push({ ...x, ids: [...x.ids] });
      }
      return out2;
    };
    const cls = ids => (ids.every(id => done.has(id)) ? ' done' : '') + (ids.includes(activeCmt) ? ' act' : '');
    const box = (q, extra) => `<div class="cmt-hl${extra}" style="left:${(q.l - sr.left) / scale}px;top:${(q.t - sr.top) / scale}px;width:${(q.r - q.l) / scale}px;height:${(q.b - q.t) / scale}px"></div>`;
    for (const q of merge(txt)) out.push(box(q, cls(q.ids)));
    for (const q of merge(obj)) top.push(box(q, ' obj' + cls(q.ids)));
    // the selection the new comment will go on, while typing it (the text itself has lost the focus)
    const shown = cmtSel && panelView() === 'cmt' ? cmtSel : keptSel;
    if (shown) for (const q of selRects(shown)) out.push(`<div class="cmt-sel" style="left:${(q.left - sr.left) / scale}px;top:${(q.top - sr.top) / scale}px;width:${q.width / scale}px;height:${q.height / scale}px"></div>`);
    layer.innerHTML = out.join(''); $('#cmtTop').innerHTML = top.join('');
  });
}
$('#cmtAdd').addEventListener('mousedown', e => e.preventDefault());     // keep the selection in the document
$('#cmtText').addEventListener('focus', () => { const s0 = editor.state.selection; cmtSel = s0.empty && !(s0 instanceof NodeSelection) ? null : { from: s0.from, to: s0.to, node: s0 instanceof NodeSelection }; drawComments(); });
$('#cmtText').addEventListener('blur', () => { setTimeout(() => { if (document.activeElement !== $('#cmtText')) { cmtSel = null; drawComments(); } }, 200); });
$('#cmtHide').addEventListener('click', () => setCmtHidden(!cmtHidden));
setCmtHidden(cmtHidden);
$('#cmtAdd').addEventListener('click', addComment);
$('#cmtText').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addComment(); } });
$('#cmtList').addEventListener('click', e => {
  const card = e.target.closest('.cmtcard'); if (!card) return;
  const id = card.dataset.cid, c = docComments.find(x => x.id === id); if (!c) return;
  const act = e.target.closest('[data-cact]');
  if (act && act.dataset.cact === 'del') { removeCommentAnchors(id); docComments = docComments.filter(x => x.id !== id); markDirty(); saveSoon(); renderComments(); return; }
  if (act && act.dataset.cact === 'done') { c.done = !c.done; markDirty(); saveSoon(); renderComments(); return; }
  if (act && act.dataset.cact === 'reply') {
    const inp = card.querySelector('.cin'), t = inp.value.trim(); if (!t) { inp.focus(); return; }
    const by = cmtAuthor(); if (!by) return;
    (c.replies = c.replies || []).push({ text: t, by, at: Date.now() }); markDirty(); saveSoon(); renderComments(); focusCard(id); return;
  }
  if (e.target.closest('input')) return;
  for (const x of $$('#cmtList .cmtcard.act')) x.classList.remove('act');
  card.classList.add('act'); showCommentPlace(id);
});
const paintAvatar = () => { const a = $('#cmtAvatar'), n = $('#cmtAuthor').value.trim(); a.innerHTML = svg('user'); a.style.setProperty('--c', n ? avatarColor(n) : 'var(--ink-2)'); };
$('#cmtAuthor').value = load('matekosdoksi.author') || ''; paintAvatar();
$('#cmtAuthor').addEventListener('input', paintAvatar);
$('#cmtAuthor').addEventListener('change', e => { const n = e.target.value.trim().slice(0, 40); e.target.value = n; store('matekosdoksi.author', n); paintAvatar(); });
$('#cmtAuthor').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#cmtText').focus(); } });
$('#cmtPrev').onclick = () => stepOpenComment(-1);
$('#cmtNext').onclick = () => stepOpenComment(1);
for (const b of $$('#cmtView [data-cflt]')) b.onclick = () => { cmtFilter = b.dataset.cflt; store('matekosdoksi.cmtfilter', cmtFilter); renderComments(); };
$('#cmtList').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('cin')) { e.preventDefault(); e.target.closest('.cmtcard').querySelector('[data-cact=reply]').click(); } });
// a click on commented text / picture / cell: its comment in the panel
editor.view.dom.addEventListener('click', e => {
  const el = e.target.closest && e.target.closest('[data-cmt]'); if (!el) return;
  const ids = []; let x = el; while (x && x !== editor.view.dom) { if (x.dataset && x.dataset.cmt) ids.push(...x.dataset.cmt.split(' ').filter(Boolean)); x = x.parentElement; }
  if (!ids.length) return;
  if (panelView() !== 'cmt') panelVisible(true, 'cmt');
  focusCard(ids[0]);
});
/* left panel: collapse / open */
function pagesVisible(v) { mainEl.classList.toggle('nopages', !v); document.body.classList.toggle('nopages-on', !v); lsSet('matekosdoksi.pages', v ? '1' : '0'); applyZoom(); if (v) thumbsSoon(true); }
$('#pagesX').addEventListener('click', () => pagesVisible(false));
$('#pagesOpen').addEventListener('click', () => pagesVisible(true));
let secState = {}; try { secState = JSON.parse(lsGet(LSK.sections) || '{}'); } catch (e) { secState = {}; }
for (const sec of $$('#props .psec')) sec.classList.toggle('closed', !!secState[sec.dataset.sec]);
props.addEventListener('click', e => {
  const t = e.target.closest('[data-sec-toggle]'); if (!t) return;
  const k = t.dataset.secToggle; secState[k] = !secState[k]; lsSet(LSK.sections, JSON.stringify(secState));
  t.closest('.psec').classList.toggle('closed', !!secState[k]);
});

/* page list: a live miniature of every page; click = go to the page */
let thumbT = 0, curPage = 0;
function thumbsSoon(now) { clearTimeout(thumbT); thumbT = setTimeout(() => { renderThumbs(); renderHeads(); }, now ? 0 : 450); }
/* the left panel's other view: the headings of the document (Főcím, Cím, Alcím) with their page – a click goes there */
let navMode = load('matekosdoksi.nav') === 'heads' ? 'heads' : 'pages';
function setNav(m) {
  navMode = m; store('matekosdoksi.nav', m);
  for (const b of $$('#pagesNav [data-nav]')) b.classList.toggle('on', b.dataset.nav === m);
  plist.hidden = m !== 'pages'; $('#hlist').hidden = m !== 'heads';
  if (m === 'heads') renderHeads(); else thumbsSoon(true);
}
function renderHeads() {
  const box = $('#hlist'); if (box.hidden || !$('#home').hidden) return;
  const g = geometry(tpl), dom = editor.view.dom, top0 = dom.getBoundingClientRect().top, out = [];
  editor.state.doc.forEach((n, pos) => {
    if (n.type.name !== 'heading') return;
    let text = ''; n.forEach(c => { text += c.isText ? c.text : c.type.name === 'math' ? ' … ' : c.type.name === 'tab' ? ' ' : ''; });
    text = text.replace(/\s+/g, ' ').trim(); if (!text) return;
    let pg = 0; try { pg = Math.max(0, Math.floor(((editor.view.coordsAtPos(pos + 1).top - top0) / scale + g.mt) / g.P)); } catch (e) { /* not laid out yet */ }
    out.push(`<button class="hl l${n.attrs.level}" data-hpos="${pos}" title="${esc(text)}"><span>${esc(text)}</span><i>${pg + (+tpl.startPage || 1)}</i></button>`);
  });
  box.innerHTML = out.join('') || '<div class="phint" style="padding:8px 12px">Nincs címsor a dokumentumban. A Főcím, Cím és Alcím stílusú bekezdések jelennek meg itt.</div>';
}
queueMicrotask(() => {
  for (const b of $$('#pagesNav [data-nav]')) b.onclick = () => setNav(b.dataset.nav);
  $('#hlist').addEventListener('click', e => {
    const b = e.target.closest('[data-hpos]'); if (!b) return;
    const pos = Math.min(+b.dataset.hpos + 1, editor.state.doc.content.size);
    try {
      const c = editor.view.coordsAtPos(pos), wr = ws.getBoundingClientRect();
      glideTo(ws, ws.scrollTop + (c.top - wr.top) - 40);
      editor.chain().setTextSelection(pos).focus(null, { scrollIntoView: false }).run();
    } catch (err) { /* the document changed meanwhile */ }
  });
  setNav(navMode);
});
/* Which blocks of the document changed since their miniature was drawn: every top-level block has a number that
   grows with each change inside it (text, formatting, page-break spacers, a picture's size…). */
const blockVer = new WeakMap(), blockId = new WeakMap(); let verSeq = 0, idSeq = 0;
const verOf = el => { let id = blockId.get(el); if (!id) blockId.set(el, id = ++idSeq); return id + '.' + (blockVer.get(el) || 0); };
queueMicrotask(() => {
  const dom = editor.view.dom;
  new MutationObserver(list => {
    for (const m of list) { let n = m.target; while (n && n.parentNode !== dom) n = n.parentNode; if (n) blockVer.set(n, ++verSeq); }
  }).observe(dom, { subtree: true, childList: true, attributes: true, characterData: true });
});
let thumbCache = [];                 // per page: {sig, node} – a page whose content did not change keeps its miniature
function renderThumbs() {
  if (!$('#home').hidden || plist.hidden) return;             // not shown (home screen, or the heading list is open)
  const g = geometry(tpl), dom = editor.view.dom;
  plist.style.setProperty('--pw', g.W); plist.style.setProperty('--ph', g.H);
  const kids = Array.from(dom.children).map(c => ({ el: c, top: g.mt + c.offsetTop, bottom: g.mt + c.offsetTop + c.offsetHeight }));
  const style = dom.getAttribute('style') || '';
  const frag = document.createDocumentFragment();
  // open comments per page (where each comment's first highlighted part is); not shown while the comments are hidden
  const cmtN = {};
  if (cmtShown()) {
    const open = new Set(docComments.filter(c => !c.done).map(c => c.id)), seen = new Set(), st = stack.getBoundingClientRect();
    for (const el of dom.querySelectorAll('[data-cmt]')) for (const id of el.dataset.cmt.split(' ')) {
      if (!id || seen.has(id) || !open.has(id)) continue;
      const r = el.getBoundingClientRect(); if (!r.width && !r.height) continue;
      seen.add(id);
      const pg = Math.max(0, Math.min(pageCount - 1, Math.floor((r.top - st.top) / scale / g.P)));
      cmtN[pg] = (cmtN[pg] || 0) + 1;
    }
    const at = commentPlaces(), top0 = dom.getBoundingClientRect().top;          // anchors that are not drawn as an element
    for (const id of open) if (!seen.has(id) && at[id] != null) {
      try { const pg = Math.max(0, Math.min(pageCount - 1, Math.floor(((editor.view.coordsAtPos(at[id]).top - top0) / scale + g.mt) / g.P))); cmtN[pg] = (cmtN[pg] || 0) + 1; } catch (e) { /* skipped */ }
    }
  }
  // the free pictures / tables, each with the page it is on (measured once)
  const sr0 = stack.getBoundingClientRect(), edr = dom.getBoundingClientRect();
  const pins = [...dom.querySelectorAll('.pinned')].map(el => {
    const er0 = el.getBoundingClientRect(), pg = Math.floor((er0.top - sr0.top) / scale / g.P);
    const tx = (er0.left - edr.left) / scale, ty = (er0.top - sr0.top) / scale - (pg * g.P + g.mt);
    let top = el; while (top && top.parentNode !== dom) top = top.parentNode;
    return { el, pg, tx, ty, sig: (top ? verOf(top) : '') + '@' + Math.round(tx) + ',' + Math.round(ty) + ',' + Math.round(er0.width) };
  });
  // line shading: only the bands of each page
  const shade = [...$('#shadeLayer').children].map(d => ({ html: d.outerHTML, top: parseFloat(d.style.top), h: parseFloat(d.style.height) }));
  const title = $('#docTitle').value, cache = [];
  for (let i = 0; i < pageCount; i++) {
    const top = i * g.P, bot = top + g.H;
    const parts = kids.filter(c => c.bottom > top - 2 && c.top < bot + 2);
    const sheet = sheetHTML(i, pageCount, tpl, title, g, 0, 0);
    const bandsHTML = shade.filter(d => !(d.top + d.h < top - 2 || d.top > top + g.P + 2)).map(d => d.html).join('');   // bands without a place are kept on every page
    const myPins = pins.filter(x => x.pg === i);
    const sig = [g.W, g.H, g.sheetX(i), g.leftOf(i), i + (+tpl.startPage || 1), style, sheet, bandsHTML, parts.map(p => verOf(p.el) + '@' + Math.round(p.top)).join(','), myPins.map(x => x.sig).join(','), cmtN[i] || 0].join('|');
    const old = thumbCache[i];
    if (old && old.sig === sig) { old.node.classList.toggle('cur', i === curPage); frag.appendChild(old.node); cache[i] = old; continue; }
    const t = document.createElement('div');
    t.className = 'thumb' + (i === curPage ? ' cur' : ''); t.dataset.i = i;
    t.innerHTML = `<div class="no">${i + (+tpl.startPage || 1)}</div><div class="frame"><div class="tpage" style="width:${g.W}px;height:${g.H}px">${sheet}</div></div>`;
    const tp = t.querySelector('.tpage');
    // line shading of this page
    const bands = document.createElement('div');
    bands.style.cssText = `position:absolute;left:${-g.sheetX(i)}px;top:${-i * g.P}px`;
    bands.innerHTML = bandsHTML;
    for (const d of bands.children) d.style.position = 'absolute';
    tp.appendChild(bands);
    // the blocks that reach into this page (exactly as laid out in the editor)
    if (parts.length) {
      const c = document.createElement('div');
      c.className = 'ProseMirror docbody'; c.setAttribute('style', style);
      c.style.position = 'absolute'; c.style.left = g.leftOf(i) + 'px'; c.style.top = (parts[0].top - top) + 'px'; c.style.minHeight = '0';
      for (const p of parts) c.appendChild(p.el.cloneNode(true));
      // free pictures / tables are placed on their page below; working marks are not part of the page
      for (const x of c.querySelectorAll('.pinned')) x.style.visibility = 'hidden';
      for (const x of c.querySelectorAll('.spell-err,.find-hit,.tbl-active,.ProseMirror-selectednode')) x.classList.remove('spell-err', 'find-hit', 'cur', 'tbl-active', 'ProseMirror-selectednode');
      tp.appendChild(c);
    }
    // the free pictures / tables of this page, where they are on the page
    for (const { el, tx, ty } of myPins) {
      const cl = el.cloneNode(true);
      cl.classList.remove('ProseMirror-selectednode', 'tbl-active');
      const holder = document.createElement('div');
      holder.className = 'ProseMirror docbody'; holder.setAttribute('style', style);
      holder.style.position = 'absolute'; holder.style.left = g.leftOf(i) + 'px'; holder.style.top = g.mt + 'px'; holder.style.minHeight = '0'; holder.style.height = '0';
      cl.style.left = tx + 'px'; cl.style.top = ty + 'px'; cl.style.visibility = '';
      holder.appendChild(cl); tp.appendChild(holder);
    }
    if (cmtN[i]) t.querySelector('.frame').insertAdjacentHTML('beforeend', `<span class="cmtmark" title="${cmtN[i]} nyitott megjegyzés ezen az oldalon">${svg('comment')}${cmtN[i]}</span>`);
    frag.appendChild(t); cache[i] = { sig, node: t };
  }
  thumbCache = cache;
  plist.replaceChildren(frag);
  fitThumbs();
}
/** Miniature size follows the panel width at once (only a CSS scale – no re-render while dragging). */
function fitThumbs() {
  const f = plist.querySelector('.frame'); if (!f) return;
  plist.style.setProperty('--tk', f.clientWidth / (+plist.style.getPropertyValue('--pw') || 794));
}
new ResizeObserver(fitThumbs).observe(plist);
plist.addEventListener('click', e => {
  const t = e.target.closest('.thumb'); if (!t) return;
  const g = geometry(tpl), i = +t.dataset.i;
  pickedAt = Date.now();
  glideTo(ws, outer.offsetTop + i * g.P * scale - 12);
  setCurPage(i);
});
function setCurPage(i) {
  if (i === curPage) return;
  curPage = i;
  for (const t of plist.children) t.classList.toggle('cur', +t.dataset.i === i);
  const el = plist.children[i]; if (el && !plist.hidden) keepVisible(plist, el);
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
    const col = (pos, label) => {
      const pic = sl.img[pos];
      return `<div class="hfpcol"><span class="hfpl">${label}</span><div class="hfthumb">${pic.src ? `<img src="${esc(pic.src)}" alt="">` : '<i>nincs kép</i>'}</div>
        <button class="btn mini" data-pickimg="${base}.img.${pos}.src">${pic.src ? 'Csere…' : 'Kép…'}</button>
        ${pic.src ? `<button class="btn mini" data-clearimg="${base}.img.${pos}.src">Eltávolítás</button><label class="mini-l">Magasság<span class="unitin"><input type="number" min="3" max="80" step="1" data-k="${base}.img.${pos}.h"><i>mm</i></span></label>` : ''}</div>`;
    };
    return `<h4>${kind === 'header' ? 'Élőfej képei' : 'Élőláb képei'}</h4><div class="hfpics">${col('l', 'Bal')}${col('c', 'Közép')}${col('r', 'Jobb')}</div>`;
  };
  $('#hfEditor').innerHTML = block('header') + block('footer');
}
const STYLE_ROWS = [['p', 'Normál', 'a dokumentum alapszövege'], ['h1', 'Főcím', ''], ['h2', 'Cím', ''], ['h3', 'Alcím', '']];
let openStyle = 'p';
const ALIGNS = [['left', 'alignL', 'Balra'], ['center', 'alignC', 'Középre'], ['right', 'alignR', 'Jobbra'], ['justify', 'alignJ', 'Sorkizárt']];
function styleRows() {
  const fams = allFamilies();
  const famOpts = sel => `<option value="">Alap betűtípus</option><optgroup label="Képletbarát betűtípusok">${fams.math.map(([f, l]) => `<option value="${f}"${f === sel ? ' selected' : ''}>${l}</option>`).join('')}</optgroup><optgroup label="Egyéb betűtípusok">${fams.other.map(([f, l]) => `<option value="${f}"${f === sel ? ' selected' : ''}>${l}</option>`).join('')}</optgroup>`;
  $('#styleRows').innerHTML = STYLE_ROWS.map(([k, label, hint]) => {
    const st = tpl.styles[k], b = `styles.${k}`, open = openStyle === k;
    const num = (key, lab, step, min, max, unit) => `<label class="fld">${lab}<span class="unitin"><input type="number" step="${step}"${min != null ? ` min="${min}"` : ''}${max != null ? ` max="${max}"` : ''} data-k="${b}.${key}">${unit ? `<i>${unit}</i>` : ''}</span></label>`;
    return `<div class="strow stcard${open ? ' open' : ''}" data-style="${k}">
      <button class="sthead sttoggle" data-sttoggle="${k}"><span class="chev">${svg('chev')}</span><b>${label}</b>${hint ? `<span class="phint">${hint}</span>` : ''}<span class="stprev" style="font-weight:${st.bold ? 700 : 400};font-style:${st.italic ? 'italic' : 'normal'};color:${esc(st.color)}">Aa</span></button>
      <div class="stbody">
        <label class="fld full">Betűtípus<select data-k="${b}.font">${famOpts(st.font)}</select></label>
        <div class="stctl"><input type="number" class="stsize" min="5" max="96" step="0.5" data-k="${b}.size" title="Betűméret (pt)"><span class="unit">pt</span>
          <label class="colbtn btn" title="Betűszín"><input type="color" class="hidecolor" data-k="${b}.color"><i class="dot fill" style="--c:${esc(st.color)}"></i>Szín</label>
          ${['bold', 'italic', 'underline'].map(t => `<button class="tb${st[t] ? ' on' : ''}" data-stt="${t}" data-st="${k}" title="${{ bold: 'Félkövér', italic: 'Dőlt', underline: 'Aláhúzott' }[t]}">${{ bold: '<b>B</b>', italic: '<i>I</i>', underline: '<u>U</u>' }[t]}</button>`).join('')}</div>
        <div class="stctl" style="margin-top:6px">${ALIGNS.map(([v, ic, t]) => `<button class="tb${(st.align || 'left') === v ? ' on' : ''}" data-stalign="${v}" data-st="${k}" title="${t}">${svg(ic)}</button>`).join('')}
          <label class="colbtn btn" title="Sorárnyék (a bekezdés sorai mögött)" data-none="Nincs sorárnyék"><input type="color" class="hidecolor" data-k="${b}.shade"><i class="dot fill${st.shade ? '' : ' none'}" style="--c:${esc(st.shade || 'transparent')}"></i>Sorárnyék</label></div>
        <div class="fgrid" style="margin-top:8px">
          ${num('line', 'Sorköz', 0.05, 0.8, 4, '')}${num('letter', 'Betűköz', 0.1, -3, 10, 'pt')}
          ${num('spaceBefore', 'Térköz előtte', 1, 0, 72, 'pt')}${num('spaceAfter', 'Térköz utána', 1, 0, 72, 'pt')}
          ${num('indentLeft', 'Bal behúzás', 0.25, 0, 10, 'cm')}${num('indentRight', 'Jobb behúzás', 0.25, 0, 10, 'cm')}
          <label class="fld">Első sor<select data-flkind="${k}"><option value="none"${!+st.firstLine ? ' selected' : ''}>Nincs</option><option value="first"${+st.firstLine > 0 ? ' selected' : ''}>Első sor beljebb</option><option value="hang"${+st.firstLine < 0 ? ' selected' : ''}>Függő</option></select></label>
          <label class="fld">Mértéke<span class="unitin"><input type="number" step="0.25" min="0" max="5" data-flval="${k}" value="${Math.abs(+st.firstLine || 0) || ''}"><i>cm</i></span></label>
        </div>
        <div class="sttabs"><span class="sttl">Tabulátorok</span>${(st.tabs || []).map((t, ti) => `<span class="stt">${String(t.pos).replace('.', ',')} cm ${{ left: 'balra', center: 'középre', right: 'jobbra' }[t.align] || 'balra'}${t.leader ? (t.leader === 'dot' ? ', pontozott' : ', vonallal') : ''}<button class="tb mini" data-sttabdel="${k}:${ti}" title="Törlés">✕</button></span>`).join('') || '<span class="phint" style="display:inline">nincs (1,25 cm-enként)</span>'}
          <span class="sttadd"><input type="number" step="0.25" min="0.25" placeholder="cm" data-sttabpos="${k}"><select data-sttabal="${k}"><option value="left">balra</option><option value="center">középre</option><option value="right">jobbra</option></select><select data-sttablead="${k}"><option value="">üres</option><option value="dot">pontozott</option><option value="line">vonal</option></select><button class="btn mini" data-sttabadd="${k}">Hozzáadás</button></span></div>
        <label class="chk" style="margin-top:8px"><input type="checkbox" data-k="${b}.keepNext"> Együtt a következő bekezdéssel</label>
        <label class="chk" style="margin-top:4px"><input type="checkbox" data-k="${b}.contextual"> Nincs térköz az azonos stílusú bekezdések között</label>
        ${k === 'p' ? `<label class="chk" style="margin-top:4px"><input type="checkbox" data-k="lists.contextual"> Nincs térköz a listaelemek között</label>
        <label class="chk" style="margin-top:4px" title="A sorok végén a hosszú szavak a magyar elválasztási szabályok szerint megtörhetnek. A szöveg nem változik, csak a tördelése."><input type="checkbox" data-k="hyphenate"> Automatikus elválasztás</label>` : ''}
        ${k === 'p' ? `<div class="fgrid" style="margin-top:8px">
          <label class="fld">Felsorolásjel<select data-k="lists.bullet">${['•', '◦', '▪', '–', '➤', '➔', '✓', '★', '◆', '❖', '☐', '→'].map(c => `<option>${c}</option>`).join('')}<option value="matekos">∞ Matekos végtelen</option></select></label>
          <label class="fld">Számozás<select data-k="lists.num"><option value="decimal">1. 2. 3.</option><option value="decimal-paren">1) 2) 3)</option><option value="lower-alpha">a) b) c)</option><option value="upper-alpha">A. B. C.</option><option value="lower-roman">i. ii. iii.</option><option value="upper-roman">I. II. III.</option></select></label>
        </div><div class="phint">Az új listák ezzel a jellel / számozással indulnak.</div>` : ''}
      </div></div>`;
  }).join('') + capCard(famOpts);
}
/** The style card of the picture captions (as the paragraph styles, with what a caption can have). */
function capCard(famOpts) {
  const c = tpl.cap || (tpl.cap = {}), open = openStyle === 'cap';
  return `<div class="strow stcard${open ? ' open' : ''}" data-style="cap">
    <button class="sthead sttoggle" data-sttoggle="cap"><span class="chev">${svg('chev')}</span><b>Képfelirat</b><span class="phint">a képek fölötti és alatti szöveg</span><span class="stprev" style="font-weight:${c.bold ? 700 : 400};font-style:${c.italic ? 'italic' : 'normal'};text-decoration:${c.underline ? 'underline' : 'none'};color:${esc(c.color || '#59616b')}">Aa</span></button>
    <div class="stbody">
      <label class="fld full">Betűtípus<select data-k="cap.font">${famOpts(c.font)}</select></label>
      <div class="stctl"><input type="number" class="stsize" min="5" max="30" step="0.5" data-k="cap.size" title="Betűméret (pt)"><span class="unit">pt</span>
        <label class="colbtn btn" title="Betűszín"><input type="color" class="hidecolor" data-k="cap.color"><i class="dot fill" style="--c:${esc(c.color || '#59616b')}"></i>Szín</label>
        ${['bold', 'italic', 'underline'].map(t => `<button class="tb${c[t] ? ' on' : ''}" data-capt="${t}" title="${{ bold: 'Félkövér', italic: 'Dőlt', underline: 'Aláhúzott' }[t]}">${{ bold: '<b>B</b>', italic: '<i>I</i>', underline: '<u>U</u>' }[t]}</button>`).join('')}</div>
      <div class="phint" style="margin-top:6px">A felirat a kép szélességében, középre igazítva áll, és a képpel együtt mozog.</div>
    </div></div>`;
}
{ const fams = allFamilies(), o = list => list.map(([f, l]) => `<option value="${f}">${l}</option>`).join('');
  for (const sel of $$('.hffont')) sel.innerHTML = `<option value="">Alap betűtípus</option><optgroup label="Képletbarát betűtípusok">${o(fams.math)}</optgroup><optgroup label="Egyéb betűtípusok">${o(fams.other)}</optgroup>`; }
$('#tplFont').innerHTML = Object.entries(FONT_SETS).map(([k, f]) => `<option value="${k}">${f.label} – ${f.note}</option>`).join('');
/* header texts for page ranges */
function renderHfRanges() {
  const box = $('#hfRangeList'); if (!box) return;
  const rs = tpl.hfRanges || (tpl.hfRanges = []);
  box.innerHTML = rs.map((r, k) => `<div class="hfr" data-r="${k}"><input type="number" min="1" data-f="from" value="${+r.from || 1}" title="Első oldal"><span>–</span><input type="number" min="1" data-f="to" value="${+r.to || ''}" title="Utolsó oldal"><input type="text" data-f="l" value="${esc(r.l || '')}" placeholder="bal"><input type="text" data-f="c" value="${esc(r.c || '')}" placeholder="közép"><input type="text" data-f="r" value="${esc(r.r || '')}" placeholder="jobb"><button class="tb mini" data-del title="Törlés">✕</button><select data-f="par" class="hfrpar" title="Mely oldalakra vonatkozik a tartományon belül"><option value="both"${!r.par || r.par === 'both' ? ' selected' : ''}>minden oldalra</option><option value="odd"${r.par === 'odd' ? ' selected' : ''}>csak a páratlan oldalakra</option><option value="even"${r.par === 'even' ? ' selected' : ''}>csak a páros oldalakra</option></select></div>`).join('');
}
document.addEventListener('change', e => {
  const row = e.target.closest && e.target.closest('#hfRangeList .hfr'); if (!row) return;
  const r = tpl.hfRanges[+row.dataset.r], f = e.target.dataset.f; if (!r || !f) return;
  r[f] = f === 'from' || f === 'to' ? (+e.target.value || null) : e.target.value;
  if (f === 'par' && r.par === 'both') delete r.par;
  tplChanged(); applyTpl();
});
document.addEventListener('click', e => {
  if (e.target.closest && e.target.closest('#hfRangeAdd')) { (tpl.hfRanges = tpl.hfRanges || []).push({ from: 1, to: pageCount, l: '', c: '', r: '', ...(tpl.oddEven && (hfVariant === 'odd' || hfVariant === 'even') ? { par: hfVariant } : {}) }); renderHfRanges(); tplChanged(); applyTpl(); return; }
  const d = e.target.closest && e.target.closest('#hfRangeList [data-del]'); if (!d) return;
  tpl.hfRanges.splice(+d.closest('.hfr').dataset.r, 1); renderHfRanges(); tplChanged(); applyTpl();
});
/* every slider of the template panel has a number box (with arrows) beside it, one slider per row */
function sliderValues() {
  for (const r of $$('#props input[type=range]')) {
    if (!r.parentElement.classList.contains('rvrow')) {
      const lab = r.closest('label'); if (lab) lab.classList.add('full');
      const row = document.createElement('span'); row.className = 'rvrow';
      r.replaceWith(row); row.appendChild(r);
      const pct = /opacity/.test(r.dataset.k || '');
      const n = document.createElement('input'); n.type = 'number'; n.className = 'rvnum';
      n.min = pct ? Math.round(+r.min * 100) : r.min; n.max = pct ? Math.round(+r.max * 100) : r.max; n.step = pct ? 1 : r.step;
      const u = document.createElement('span'); u.className = 'rvu';
      u.textContent = pct ? '%' : /angle|Angle/.test(r.dataset.k) ? '°' : /imgWidth/.test(r.dataset.k) ? '%' : /size/.test(r.dataset.k) ? 'pt' : '';
      row.append(n, u);
      r.addEventListener('input', () => showRv(r));
      n.addEventListener('change', () => {
        let v = +String(n.value).replace(',', '.'); if (!Number.isFinite(v)) return;
        if (pct) v = v / 100;
        r.value = Math.min(+r.max, Math.max(+r.min, v));
        r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    showRv(r);
  }
}
function showRv(r) {
  const n = r.parentElement.querySelector('.rvnum'); if (!n || document.activeElement === n) return;
  n.value = /opacity/.test(r.dataset.k || '') ? Math.round(+r.value * 100) : r.value;
}
function fillPanel() {
  renderHfRanges();
  queueMicrotask(sliderValues);
  hfTabs(); styleRows(); presetName();
  for (const el of $$('#props [data-k]')) {
    const v = getPath(tpl, el.dataset.k);
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.type === 'radio') el.checked = el.value === v;
    else el.value = v ?? '';
  }
  $('#hcDot').style.setProperty('--c', tpl.headerColor); $('#fcDot').style.setProperty('--c', tpl.footerColor);
  for (const b of $$('[data-edithf]')) { const on = !!hfOpen && hfOpen.kind === b.dataset.edithf; b.classList.toggle('primary', on); b.textContent = on ? 'Kész' : (b.dataset.edithf === 'header' ? 'Élőfej szerkesztése' : 'Élőláb szerkesztése'); }
  $('#wmThumb').src = tpl.wm.img || ''; $('#wmThumb').hidden = !tpl.wm.img;
  $('#wmText').hidden = tpl.wm.type !== 'text';
  $('#wmImage').hidden = tpl.wm.type !== 'image';
  $('#wmOpacity').hidden = tpl.wm.type === 'none';
  for (const el of $$('#props [data-custom]')) el.hidden = tpl.page !== 'custom';
  $$('[data-mirror-label]').forEach(s => { s.textContent = tpl.mirror ? (s.dataset.mirrorLabel === 'left' ? 'Belső margó (mm)' : 'Külső margó (mm)') : (s.dataset.mirrorLabel === 'left' ? 'Bal margó (mm)' : 'Jobb margó (mm)'); });
}
function tplChanged() { markDirty(); applyTpl(); saveSoon(); noteTplChange(); }
const tplState = () => JSON.stringify({ tpl, customTpl });
/** A new document (opened, new, imported): the template history starts again. */
function resetTplHistory() { tplSaved = tplState(); tplUndo = []; tplRedo = []; }
/** The template was changed: one undo step (a dragged slider or quick typing in a box counts as one). */
function noteTplChange() {
  if (tplRestoring) return;
  const now = tplState(); if (now === tplSaved) return;
  const last = tplUndo[tplUndo.length - 1], t = Date.now(), depth = undoDepth(editor.state);
  if (last && t - last.at < 800 && last.depth === depth) last.at = t;
  else {
    tplUndo.push({ before: tplSaved, depth, at: t }); if (tplUndo.length > 100) tplUndo.shift();
    try { editor.view.dispatch(closeHistory(editor.state.tr)); } catch (e) { /* text typed after this is a step of its own */ }
  }
  tplSaved = now; tplRedo = [];
  updateToolbar();
}
function restoreTpl(state) {
  tplRestoring = true;
  try {
    if (hfOpen) closeHF();
    const st = JSON.parse(state);
    tpl = normalizeTpl(st.tpl); customTpl = st.customTpl || null;
    fillPanel(); applyTpl(true); markDirty(); saveSoon();
  } finally { tplRestoring = false; }
  tplSaved = tplState(); updateToolbar();
}
function unifiedUndo() {
  const top = tplUndo[tplUndo.length - 1];
  if (top && undoDepth(editor.state) <= top.depth) {
    tplUndo.pop(); tplRedo.push({ after: tplSaved, redo: redoDepth(editor.state) });
    restoreTpl(top.before); toast('Sablonmódosítás visszavonva'); return true;
  }
  return editor.chain().focus(null, { scrollIntoView: false }).undo().run();
}
function unifiedRedo() {
  const top = tplRedo[tplRedo.length - 1];
  if (top && redoDepth(editor.state) <= top.redo) {
    tplRedo.pop(); tplUndo.push({ before: tplSaved, depth: undoDepth(editor.state), at: 0 });
    restoreTpl(top.after); toast('Sablonmódosítás újra'); return true;
  }
  return editor.chain().focus(null, { scrollIntoView: false }).redo().run();
}
function onPanelInput(e) {
  const el = e.target;
  if (el.dataset && (el.dataset.flkind || el.dataset.flval)) {          // style: first line indent / hanging indent
    const key = el.dataset.flkind || el.dataset.flval, st = tpl.styles[key], card = el.closest('.stcard');
    const kind = card.querySelector('[data-flkind]').value, v = Math.max(0, parseFloat(String(card.querySelector('[data-flval]').value).replace(',', '.')) || 0);
    const oldHang = +st.firstLine < 0 ? -st.firstLine : 0, base = Math.max(0, (+st.indentLeft || 0) - oldHang);
    if (kind === 'none' || !v) { st.firstLine = 0; st.indentLeft = base; }
    else if (kind === 'first') { st.firstLine = v; st.indentLeft = base; }
    else { st.firstLine = -v; st.indentLeft = base + v; }
    const il = card.querySelector(`[data-k="styles.${key}.indentLeft"]`); if (il) il.value = st.indentLeft;
    tplChanged(); return;
  }
  const k = el.dataset && el.dataset.k; if (!k) return;
  if (el.tagName === 'TEXTAREA') { setPath(tpl, k, el.value); tplChanged(); return; }
  let v = el.type === 'checkbox' ? el.checked : (el.type === 'number' || el.type === 'range') ? parseFloat(el.value) : el.value;
  if (typeof v === 'number' && isNaN(v)) return;
  if (el.type === 'radio' && !el.checked) return;
  setPath(tpl, k, v);
  if (el.type === 'color') { const dot = el.parentElement.querySelector('.dot'); if (dot) dot.style.setProperty('--c', v); }
  if (k === 'oddEven' || k === 'firstDiff' || k === 'mirror' || k === 'wm.type' || k === 'page') fillPanel();
  if ((/^styles\.\w+\.font$/.test(k) || /^(header|footer)Font$/.test(k)) && v) loadTextFamily(v).then(() => relayout(30));
  if (k === 'oddEven' || k === 'firstDiff') { if (hfOpen) closeHF(); }
  tplChanged();
}
props.addEventListener('input', onPanelInput);
props.addEventListener('change', onPanelInput);
props.addEventListener('click', e => {
  // tab stops of a paragraph style
  const ta = e.target.closest('[data-sttabadd]'), td = e.target.closest('[data-sttabdel]');
  if (ta) {
    const k = ta.dataset.sttabadd, card = ta.closest('.stcard'), v = parseFloat(String(card.querySelector('[data-sttabpos]').value).replace(',', '.'));
    if (!(v > 0 && v < 60)) return;
    const st = tpl.styles[k]; st.tabs = [...(st.tabs || []).filter(t => t.pos !== v), { pos: v, align: card.querySelector('[data-sttabal]').value, ...(card.querySelector('[data-sttablead]').value ? { leader: card.querySelector('[data-sttablead]').value } : {}) }].sort((a, b) => a.pos - b.pos);
    styleRows(); tplChanged(); relayout(0); return;
  }
  if (td) { const [k, i] = td.dataset.sttabdel.split(':'); tpl.styles[k].tabs.splice(+i, 1); styleRows(); tplChanged(); relayout(0); return; }
  const tg = e.target.closest('[data-sttoggle]');
  if (tg) { openStyle = openStyle === tg.dataset.sttoggle ? '' : tg.dataset.sttoggle; for (const c of $$('#styleRows .stcard')) c.classList.toggle('open', c.dataset.style === openStyle); return; }
  const al = e.target.closest('[data-stalign]');
  if (al) { tpl.styles[al.dataset.st].align = al.dataset.stalign; for (const x of al.parentElement.querySelectorAll('[data-stalign]')) x.classList.toggle('on', x === al); tplChanged(); return; }
  const cb = e.target.closest('[data-capt]');
  if (cb) { const c = tpl.cap; c[cb.dataset.capt] = !c[cb.dataset.capt]; cb.classList.toggle('on', c[cb.dataset.capt]); tplChanged(); return; }
  const b = e.target.closest('[data-stt]'); if (!b) return;
  const st = tpl.styles[b.dataset.st]; st[b.dataset.stt] = !st[b.dataset.stt]; b.classList.toggle('on', st[b.dataset.stt]); tplChanged();
});
$('#hfTabs').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { const was = hfOpen && hfOpen.kind; hfVariant = b.dataset.v; if (hfOpen) closeHF(); fillPanel(); if (was) editHF(was, hfVariant); } });
$('#hfEditor').addEventListener('click', e => {
  const p = e.target.closest('[data-pickimg]'), c = e.target.closest('[data-clearimg]');
  if (p) pickImage(1600, url => { setPath(tpl, p.dataset.pickimg, url); fillPanel(); tplChanged(); });
  if (c) { setPath(tpl, c.dataset.clearimg, ''); fillPanel(); tplChanged(); }
});
$('#wmPick').addEventListener('click', () => pickImage(2400, url => { tpl.wm.img = url; tpl.wm.type = 'image'; fillPanel(); tplChanged(); }));
$('#wmClear').addEventListener('click', () => { tpl.wm.img = ''; fillPanel(); tplChanged(); });
const startTpl = () => normalizeTpl(DEFAULT_TPL);

/* ready-made templates: red box at the top of the template panel (like Matekos Prezi); the locked ones come later.
   Below them: save the current settings into a template file (.mdsab) and use one (at most one per document). */
const PRESETS = [['ures', 'Sima', false, '#ffffff', '#da291c'], ['feladatsor', 'Feladatsor', false, '#f4f6f8', '#1f5f74'], ['kiadvany', 'Kiadvány', true, '#fdf3d7', '#b7950b'], ['pre', 'Pré', true, '#ece6f5', '#7d3c98']];
let customTpl = null;               // {name, tpl}: the template file used in this document
const presetLabel = () => tpl.preset === 'custom' && customTpl ? customTpl.name : (PRESETS.find(p => p[0] === tpl.preset) || PRESETS[0])[1];
function presetName() {
  $('#tplName').textContent = presetLabel();
  const cards = PRESETS.map(([k, l, locked, a, b]) => `<button class="pbcard${tpl.preset === k ? ' on' : ''}${locked ? ' locked' : ''}" data-preset="${k}" title="${locked ? 'Hamarosan' : l}"><i style="--a:${a};--b:${b}"></i><span>${locked ? svg('lock') : ''}${l}</span>${locked ? '<small>hamarosan</small>' : ''}</button>`);
  if (customTpl) cards.push(`<button class="pbcard custom${tpl.preset === 'custom' ? ' on' : ''}" data-preset="custom" title="Sablonfájlból: ${esc(customTpl.name)}"><i style="--a:#ffffff;--b:#2e4a9e"></i><span>${esc(customTpl.name)}</span><small>sablonfájlból</small></button>`);
  $('#presetBox').innerHTML = `<div class="pbhead"><b>Sablonok</b></div><div class="pbgrid">${cards.join('')}</div>
    <div class="pbfile">${tpl.preset === 'custom' && customTpl ? `<button class="btn primary" id="tplUpdate" title="A sablonfájl felülírása a mostani beállításokkal (különben a változások csak ebbe a dokumentumba kerülnek)">Sablonfájl frissítése</button>` : ''}<button class="btn" id="tplToFile" title="A jobb oldali panel minden beállítása – az élőfejjel és az élőlábbal együtt – egy Matekos Doksi Sablon fájlba">Sablon mentése fájlba…</button><button class="btn" id="tplFromFile" title="Egy Matekos Doksi Sablon fájl használata ebben a dokumentumban">Sablonfájl importálása…</button></div>`;
}
$('#presetBox').addEventListener('click', async e => {
  if (e.target.closest('#tplUpdate')) {
    if (!customTpl) return;
    try {
      const t = JSON.parse(JSON.stringify(tpl)); delete t.preset;
      const n = await updateTemplateFile(customTpl.path || null, { name: customTpl.name, tpl: t });
      if (n) { customTpl.tpl = t; markDirty(); saveSoon(); toast('Sablonfájl frissítve: ' + n); }
    } catch (err) { toast('A sablonfájl frissítése nem sikerült: ' + (err && err.message || err)); }
    return;
  }
  if (e.target.closest('#tplToFile')) {
    try {
      const t = JSON.parse(JSON.stringify(tpl)); delete t.preset;
      const n = await saveTemplateFile({ name: customTpl && tpl.preset === 'custom' ? customTpl.name : docTitle() + ' sablon', tpl: t }, (customTpl && tpl.preset === 'custom' ? customTpl.name : docTitle() + ' sablon'));
      if (n) {
        if (customTpl && tpl.preset !== 'custom' && !await confirmBox(`A dokumentumban már van egy sablonfájl („${customTpl.name}”). Egyszerre csak egy lehet – ez lép a helyére: „${n.replace(/\.mdsab$/i, '')}”?`, 'Csere')) { toast('Sablon elmentve: ' + n); return; }
        customTpl = { name: n.replace(/\.mdsab$/i, ''), tpl: t, path: templateFilePath() }; tpl.preset = 'custom'; presetName(); markDirty(); saveSoon();
        toast('Sablon elmentve és használatban: ' + n);
      }
    } catch (err) { toast('A sablon mentése nem sikerült: ' + (err && err.message || err)); }
    return;
  }
  if (e.target.closest('#tplFromFile')) {
    let r;
    try { r = await openTemplateFile(); } catch (err) { toast(err && err.message || String(err)); return; }
    if (!r) return;
    if (customTpl && !await confirmBox(`A dokumentumban már van egy sablonfájl („${customTpl.name}”). Egyszerre csak egy lehet – lecseréled erre: „${r.name.replace(/\.mdsab$/i, '')}”?`, 'Csere')) return;
    if (hfOpen) closeHF();
    customTpl = { name: r.name.replace(/\.mdsab$/i, ''), tpl: r.data.tpl, path: templateFilePath() };
    tpl = normalizeTpl(JSON.parse(JSON.stringify(customTpl.tpl))); tpl.preset = 'custom';
    fillPanel(); markDirty(); applyTpl(true); saveSoon(); noteTplChange();
    toast('Sablonfájl használatban: ' + customTpl.name);
    return;
  }
  const b = e.target.closest('[data-preset]'); if (!b) return;
  if (b.classList.contains('locked')) { toast('Ez a sablon hamarosan érkezik.'); return; }
  if (b.dataset.preset === tpl.preset) return;
  const label = b.dataset.preset === 'custom' ? customTpl.name : (PRESETS.find(p => p[0] === b.dataset.preset) || [])[1];
  if (!await confirmBox(`A(z) „${label}” sablon lép a mostani helyére (oldal, élőfej és élőláb, vízjel, szövegstílusok)${b.dataset.preset === 'ures' ? ' – a dokumentum formázása az alapbeállításra áll vissza' : ''}. A dokumentum szövege megmarad. Folytatod?`, 'Sablon alkalmazása')) return;
  if (hfOpen) closeHF();
  let src = DEFAULT_TPL;
  if (b.dataset.preset === 'custom') src = JSON.parse(JSON.stringify(customTpl.tpl));
  else if (b.dataset.preset !== 'ures') {                    // a ready-made template of the app (public/presets)
    try { const r = await fetch(`./presets/${b.dataset.preset}.mdsab`); src = (await r.json()).tpl; } catch (err) { toast('A sablon nem tölthető be.'); return; }
  }
  tpl = normalizeTpl(src); tpl.preset = b.dataset.preset;
  fillPanel(); markDirty(); applyTpl(true); saveSoon(); noteTplChange();
  toast('Sablon: ' + presetLabel());
});

/* ------------------------------------------------------------------ */
/* Documents (Matekos Prezi behaviour): own file, Save as, renaming,   */
/* status, autosave, home screen, confirmations                        */
/* ------------------------------------------------------------------ */
let dirty = false, sessionOpen = false, autoT = 0;
let editedNow = false;               // was the document changed in this session? (a draft that only came back is not)
function setStatus(t) {
  const f = currentFileName(), st = $('#status');
  st.className = 'status ' + (t ? 'msg' : dirty || !f ? 'unsaved' : 'saved');
  st.textContent = t || (dirty ? 'Nem mentett' : f ? 'Mentve' : 'Még nincs mentve');
  st.title = f ? 'A dokumentum fájlja: ' + f : 'A dokumentum még nincs fájlba mentve';
}
function flash(t) { setStatus(t); toast(t); clearTimeout(flash._t); flash._t = setTimeout(() => setStatus(), 2600); }
function markDirty() { editedNow = true; if (!dirty) { dirty = true; setStatus(); } }
/** May this window's document be replaced by another one? Unsaved work made in this session asks first; a draft that
 *  only came back from the last session (and was not touched) is put aside as a recoverable draft instead. */
async function okToReplace(msg, yes) {
  if (!dirty) return true;
  if (editedNow) return confirmBox(msg, yes);
  if (await shelveDraft(autoValue())) { toast('Az előző, nem mentett dokumentum megmaradt – a kezdőképernyőn állítható vissza.'); return true; }
  return confirmBox(msg, yes);
}
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
function docData() { return { title: docTitle(), tpl, doc: editor.getJSON(), colors: docColors, ...(customTpl ? { customTpl } : {}), ...(docComments.length ? { comments: docComments } : {}) }; }
const autoValue = () => ({ ...docData(), path: getCurrentPath(), dirty });
function saveSoon() { clearTimeout(autoT); autoT = setTimeout(saveLocal, 900); }
async function saveLocal() {
  if (await autosave(autoValue())) return;
  setStatus('Az automatikus mentés nem sikerült');
}
/** The title box always shows the document's file name (after Save as, opening, renaming). */
function titleFromFile() { const f = currentFileName(); if (f) $('#docTitle').value = titleOfFile(f); }
let titleEnter = false;
async function renameFromTitle() {
  const t = docTitle(); $('#docTitle').value = t;
  const enter = titleEnter; titleEnter = false;
  applyLayout(pageCount); thumbsSoon();
  if (!currentFileName()) { saveSoon(); if (enter) doSave(false); return; }
  try {
    const n = await renameCurrentFile(t);
    if (n) { $('#docTitle').value = titleOfFile(n); toast('Átnevezve: ' + n); }
    saveSoon(); setStatus();
  } catch (e) { toast('Az átnevezés nem sikerült: ' + (e && e.message || e)); titleFromFile(); }
}
$('#docTitle').addEventListener('change', renameFromTitle);
let titleAtFocus = '';
$('#docTitle').addEventListener('focus', e => { titleAtFocus = e.target.value; });
$('#docTitle').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const changed = e.target.value !== titleAtFocus;
  if (!currentFileName()) titleEnter = true;          // not saved yet: Enter saves it (asks for the folder)
  e.target.blur();                                      // a changed name fires "change" -> renameFromTitle
  if (!changed && titleEnter) { titleEnter = false; doSave(false); }
});
function loadData(d) {
  tpl = normalizeTpl(d.tpl || {});
  docColors = Array.isArray(d.colors) ? d.colors : []; refreshPickers();
  customTpl = d.customTpl && d.customTpl.tpl ? d.customTpl : null;
  docComments = Array.isArray(d.comments) ? d.comments : [];
  $('#docTitle').value = d.title || 'Névtelen dokumentum';
  if (d.doc) editor.commands.setContent(d.doc, { emitUpdate: false });
  else if (typeof d.html === 'string') editor.commands.setContent(d.html, { emitUpdate: false });   // documents from the first prototype
  fillPanel(); applyTpl(true);
  resetTplHistory();
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
/* ---------------- table of contents ----------------
   Ordinary paragraphs (marked as lines of the table of contents): the heading's text, a dotted right tab, the page
   number. Written by the app from the headings; refreshed by the same button and before a PDF / printing. */
const CM_PX = 96 / 2.54;
function tocRun() {                                   // the first run of table-of-contents lines: {from, to, json, nodes} or null
  let from = null, to = null; const json = [], nodes = [];
  editor.state.doc.forEach((n, pos) => {
    if (to != null) return;
    if (n.type.name === 'paragraph' && n.attrs.toc) { if (from == null) from = pos; json.push(n.toJSON()); nodes.push(n); }
    else if (from != null) to = pos;
  });
  if (from == null) return null;
  return { from, to: to ?? editor.state.doc.content.size, json, nodes };
}
/** The text of inline content as a comparable signature (formulas by their TeX code). */
const tocSig = content => (content || []).map(c => c.type === 'text' ? c.text : c.type === 'math' ? '$' + (c.attrs && c.attrs.tex) + '$' : c.type === 'tab' ? ' ' : '').join('').replace(/\s+/g, ' ').trim();
const lastTab = content => { let k = -1; (content || []).forEach((c, i) => { if (c.type === 'tab') k = i; }); return k; };
const beforeTab = content => { const k = lastTab(content); return k < 0 ? (content || []) : content.slice(0, k); };
const textMarks = content => { const t = (content || []).find(c => c.type === 'text'); return t && t.marks ? t.marks : null; };
const markAll = (content, marks) => content.map(c => { if (c.type !== 'text') return c; const { marks: _m, ...rest } = c; return marks && marks.length ? { ...rest, marks } : rest; });
/** The headings: {level, content (inline JSON), sig, page}. */
function tocEntries() {
  const g = geometry(tpl), dom = editor.view.dom, top0 = dom.getBoundingClientRect().top, out = [];
  editor.state.doc.forEach((n, pos) => {
    if (n.type.name !== 'heading') return;
    const content = [];
    n.forEach(c => { if (c.isText) content.push({ type: 'text', text: c.text }); else if (c.type.name === 'math') content.push(c.toJSON()); else if (c.type.name === 'tab') content.push({ type: 'text', text: ' ' }); });
    const sig = tocSig(content); if (!sig) return;
    let pg = 0; try { pg = Math.max(0, Math.floor(((editor.view.coordsAtPos(pos + 1).top - top0) / scale + g.mt) / g.P)); } catch (e) { /* not laid out yet */ }
    out.push({ level: n.attrs.level, content, sig, page: String(pg + (+tpl.startPage || 1)) });
  });
  return out;
}
/** The lines of the table of contents. A line that already exists keeps its own text, look and paragraph settings
 *  (only its page number is renewed – and its text, when its heading was renamed); a new line takes the look of an
 *  existing line of the same level. */
function tocLines(olds = []) {
  const entries = tocEntries(), width = Math.round(editor.view.dom.clientWidth / CM_PX * 100) / 100;
  const srcOf = o => o.attrs.tocSrc || tocSig(beforeTab(o.toJSON().content));
  // 1. the same heading text (in order), 2. the remaining ones of the same level, keeping the order
  const used = new Set(), match = entries.map(() => -1);
  entries.forEach((e, i) => { const j = olds.findIndex((o, k) => !used.has(k) && o.attrs.toc === e.level && srcOf(o) === e.sig); if (j >= 0) { match[i] = j; used.add(j); } });
  let last = -1;
  entries.forEach((e, i) => {
    if (match[i] >= 0) { last = match[i]; return; }
    const next = match.slice(i + 1).find(m => m >= 0), lim = next == null ? olds.length : next;
    const j = olds.findIndex((o, k) => k > last && k < lim && !used.has(k) && o.attrs.toc === e.level);
    if (j >= 0) { match[i] = j; used.add(j); last = j; }
  });
  return entries.map((e, i) => {
    const old = match[i] >= 0 ? olds[match[i]] : null;
    const tmpl = old || olds.find(o => o.attrs.toc === e.level) || null;
    if (tmpl) {
      const j = tmpl.toJSON(), c = j.content || [], k = lastTab(c);
      let before = k < 0 ? c : c.slice(0, k);
      const after = k < 0 ? [] : c.slice(k + 1), numMarks = textMarks(after);
      if (!old || tocSig(before) !== e.sig && srcOf(old) !== e.sig) before = markAll(e.content, textMarks(before));   // new line, or the heading was renamed
      return { ...j, attrs: { ...j.attrs, toc: e.level, tocSrc: e.sig }, content: [...before, { type: 'tab' }, { type: 'text', text: e.page, ...(numMarks ? { marks: numMarks } : {}) }] };
    }
    const lvl = e.level;
    return { type: 'paragraph', attrs: { toc: lvl, tocSrc: e.sig, tabStops: JSON.stringify([{ pos: width, align: 'right', leader: 'dot' }]), indentLeft: lvl > 1 ? (lvl - 1) * 0.6 : null, spaceBefore: lvl === 1 ? 4 : 0, spaceAfter: 1, keepNext: false },
      content: [...markAll(e.content, lvl === 1 ? [{ type: 'bold' }] : null), { type: 'tab' }, { type: 'text', text: e.page }] };
  });
}
/** Insert the table of contents before the block the cursor is in – or refresh the one the document has.
 *  The page numbers are worked out again until they stop changing (the table itself may push the text on). */
async function updateTOC(byUser) {
  if (hfEd) return;
  let run = tocRun();
  if (!run && !byUser) return;
  if (!tocEntries().length) { if (byUser) toast('Nincs címsor a dokumentumban – a tartalomjegyzék a Főcím, Cím és Alcím stílusú bekezdésekből készül.'); return; }
  let changed = false;
  for (let round = 0; round < 4; round++) {
    run = tocRun();
    const lines = tocLines(run ? run.nodes : []);
    const st = editor.state, same = run && JSON.stringify(run.json) === JSON.stringify(lines.map(l => st.schema.nodeFromJSON(l).toJSON()));
    if (same) break;
    const nodes = lines.map(l => st.schema.nodeFromJSON(l));
    let from, to;
    if (run) { from = run.from; to = run.to; }
    else { const $f = st.selection.$from; from = to = $f.depth ? $f.before(1) : 0; }
    editor.view.dispatch(st.tr.replaceWith(from, to, nodes));
    changed = true;
    await ready();
  }
  if (byUser) toast(changed ? 'A tartalomjegyzék elkészült / frissült.' : 'A tartalomjegyzék naprakész.');
}

/* ---------------- automatic hyphenation (template: "Automatikus elválasztás") ----------------
   The words standing at the start of a line get their Hungarian hyphenation points (soft hyphens, as decorations –
   see Hyphens in extensions.js), so the browser may pull their first part up to the line before. Only the blocks
   that changed are looked at again; long documents are worked through in small portions. */
let hyphenFn = null, hyT = 0, hyDone = new WeakMap(), hyLoading = false;
const hyphenSoon = (d = 250) => { clearTimeout(hyT); hyT = setTimeout(hyphenPass, d); };
function syncHyphenation() {
  if (!tpl.hyphenate) {
    clearTimeout(hyT);
    const set = hyphenKey.getState(editor.state);
    if (set && set.find().length) { editor.view.dispatch(editor.state.tr.setMeta(hyphenKey, { clear: true }).setMeta('addToHistory', false)); relayout(60); }
    return;
  }
  hyDone = new WeakMap();                              // the line widths may have changed: every block is looked at again
  if (hyphenFn) { hyphenSoon(); return; }
  if (hyLoading) return;
  hyLoading = true;
  import('hyphen/hu').then(m => {
    const fn = m.hyphenateSync || (m.default && m.default.hyphenateSync);
    // break points of a word: the numbers of letters before each point (at least two letters on both sides)
    hyphenFn = word => { const parts = fn(word, { hyphenChar: '\u00AD' }).split('\u00AD'), out = []; let k = 0; for (let i = 0; i < parts.length - 1; i++) { k += parts[i].length; if (k >= 2 && word.length - k >= 2) out.push(k); } return out; };
    hyLoading = false; hyphenSoon(0);
  }).catch(() => { hyLoading = false; toast('Az elválasztási szabályok nem tölthetők be.'); });
}
/** The hyphenation points (document positions) of the words that start a line in paragraph `p`. */
function lineStartPoints(p, set, add) {
  const al = getComputedStyle(p).textAlign; if (al === 'center' || al === 'right' || al === 'end') return;
  const rg = document.createRange(), frags = [];           // everything that stands in the lines: {top, left, h, n?, j?}
  const tw = document.createTreeWalker(p, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: n => {
    if (n.nodeType === 1) return n.matches('.math, .imgw, .tab, .lm, .shy, .pg-sp, .pg-spb, .pin-sp, .pinned') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
    return NodeFilter.FILTER_ACCEPT;
  } });
  for (const e of p.querySelectorAll('.math, .imgw.inl, .tab, .lm')) { const r = e.getBoundingClientRect(); if (r.width > 0.5) frags.push({ top: r.top, left: r.left, h: r.height }); }
  const nodes = [];
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (!n.data.trim()) continue;
    rg.selectNodeContents(n);
    const lines = [];
    for (const r of rg.getClientRects()) { if (r.width < 0.5 || !r.height) continue; const l = lines[lines.length - 1]; if (l && Math.abs(r.top - l.top) < r.height * 0.5) l.left = Math.min(l.left, r.left); else lines.push({ top: r.top, left: r.left, h: r.height }); }
    lines.forEach((l, j) => frags.push({ ...l, n, j }));
    nodes.push({ n, lines });
  }
  if (!nodes.length) return;
  const firstTop = Math.min(...frags.map(f => f.top));
  const charTop = (n, o) => { rg.setStart(n, o); rg.setEnd(n, o + 1); const r = rg.getBoundingClientRect(); return r.height ? r.top : null; };
  for (const { n, lines } of nodes) lines.forEach((l, j) => {
    if (l.top - firstTop < l.h * 0.5) return;                                        // the paragraph's first line
    if (frags.some(f => f !== l && !(f.n === n && f.j === j) && Math.abs(f.top - l.top) < Math.max(f.h, l.h) * 0.6 && f.left < l.left - 0.5)) return;   // something stands before it in the line
    // where this line's part of the text node starts
    let s = 0;
    if (j > 0) {
      let lo = 0, hi = n.data.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1, t = charTop(n, mid); if (t != null && t > l.top - l.h * 0.5) hi = mid; else lo = mid + 1; }
      s = lo;
    } else if (n.previousSibling && n.previousSibling.nodeType === 1 && n.previousSibling.classList.contains('shy')) return;   // the rest of a word already broken here
    while (s < n.data.length && /\s/.test(n.data[s])) s++;
    if (s > 0 && /[\p{L}\p{N}\u00AD-]/u.test(n.data[s - 1])) return;               // inside a word
    const m = /^\p{L}{5,}/u.exec(n.data.slice(s)); if (!m) return;
    const word = m[0];
    if (s + word.length === n.data.length && n.nextSibling && n.nextSibling.nodeType === 1 && n.nextSibling.classList.contains('shy')) return;   // it has its points already
    let base; try { base = editor.view.posAtDOM(n, s); } catch (e) { return; }
    if (set.find(base, base + word.length).length) return;
    for (const k of hyphenFn(word)) add.push(base + k);
  });
}
function hyphenPass() {
  if (!tpl.hyphenate || !hyphenFn || !$('#home').hidden) { if (tpl.hyphenate && hyphenFn) hyphenSoon(800); return; }
  const dom = editor.view.dom, set = hyphenKey.getState(editor.state), add = [], t0 = performance.now();
  let more = false;
  for (const block of dom.children) {
    const ver = verOf(block); if (hyDone.get(block) === ver) continue;
    if (performance.now() - t0 > 14) { more = true; break; }
    try { for (const p of (block.matches('p') ? [block] : block.querySelectorAll('p'))) if (!p.hasAttribute('data-toc')) lineStartPoints(p, set, add); } catch (e) { /* this block is skipped */ }
    hyDone.set(block, ver);
  }
  if (add.length) { editor.view.dispatch(editor.state.tr.setMeta(hyphenKey, { add: [...new Set(add)] }).setMeta('addToHistory', false)); relayout(60); }
  if (add.length || more) hyphenSoon(add.length ? 90 : 0);      // the new line breaks may bring new words to the line starts
}

async function makePdf() {
  const sel = editor.state.selection;
  hideSpell(editor.view); clearFind();          // red underlines and find highlights are not part of the document
  editor.commands.blur();
  editor.commands.setTextSelection(0 < editor.state.doc.content.size ? 1 : 0);
  await ready();
  try {
    return await buildPDF({ editorDom: editor.view.dom, pagesEl, stackEl: stack, scale, tpl, pages: pageCount, title: docTitle() });
  } finally {
    try { editor.view.dispatch(editor.state.tr.setSelection(sel.map(editor.state.doc, editor.state.tr.mapping))); } catch (e) { /* ignore */ }
    showSpell(editor.view);
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
  try { await updateTOC(false); const blob = await makePdf(); busy(''); flash(await savePdfBlob(blob, docTitle())); }
  catch (e) { busy(''); flash('A PDF elkészítése nem sikerült: ' + (e && e.message || e)); }
}
async function doPrint() {
  closePops();
  // the exact PDF opens in the system PDF viewer, which prints it at true paper size
  busy('Nyomtatás előkészítése…');
  try { await updateTOC(false); const blob = await makePdf(); busy(''); flash(await printPdfBlob(blob, docTitle())); }
  catch (e) { busy(''); flash('A nyomtatás nem sikerült: ' + (e && e.message || e)); }
}
function openedDocument(r) {
  if (!r) return false;
  if (r.error) { toast('Ez a fájl nem Matekos Doksi dokumentum.'); return false; }
  setCurrentPath(r.path && /\.mdoksi$/i.test(r.path) ? r.path : null);
  loadData(r.data);
  $('#docTitle').value = titleOfFile(r.name) || r.data.title || 'Névtelen dokumentum';   // the file's own name
  dirty = false; editedNow = false; sessionOpen = true; saveSoon(); setStatus();
  toast('Megnyitva: ' + r.name);
  showHome(false);
  return true;
}
async function doOpen() {
  closePops();
  if (dirty && editedNow && !await confirmBox('A nem mentett módosítások elvesznek. Megnyitsz egy másik dokumentumot?', 'Megnyitás')) return false;
  try {
    const r = await openDocumentFile(); if (!r) return false;
    if (!r.error && dirty && !editedNow && await shelveDraft(autoValue())) toast('Az előző, nem mentett dokumentum megmaradt – a kezdőképernyőn állítható vissza.');   // only once a file was really chosen
    return openedDocument(r);
  }
  catch (e) { toast('A fájl nem nyitható meg: ' + (e && e.message || e)); return false; }
}
async function openPath(p) {
  // a Matekos Doksi Sablon (.mdsab) opened from the system: a new document with that template
  if (/\.mdsab$/i.test(p)) {
    try {
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const data = JSON.parse(await readTextFile(p));
      if (!data || data.app !== 'matekos-doksi-sablon' || !data.tpl) throw new Error('Ez nem Matekos Doksi Sablon.');
      if (!await newDocument()) return false;
      const name = p.split(/[\\/]/).pop().replace(/\.mdsab$/i, '');
      customTpl = { name, tpl: data.tpl, path: p }; tpl = normalizeTpl(JSON.parse(JSON.stringify(data.tpl))); tpl.preset = 'custom';
      fillPanel(); applyTpl(true); resetTplHistory(); markDirty(); saveSoon(); toast('Új dokumentum a sablonnal: ' + name);
      return true;
    } catch (e) { toast('A sablon nem nyitható meg: ' + (e && e.message || e)); return false; }
  }
  if (!await okToReplace('A nem mentett módosítások elvesznek. Megnyitod a másik dokumentumot?', 'Megnyitás')) return false;
  try { return openedDocument(await openPathFile(p)); }
  catch (e) { toast('A fájl nem nyitható meg: ' + (e && e.message || e)); showHome(true); return false; }
}
async function newDocument() {
  closePops();
  if (!await okToReplace('Új dokumentumot kezdesz. A mostani nem mentett módosításai elvesznek. Folytatod?', 'Új dokumentum')) return false;
  tpl = startTpl(); customTpl = null; docComments = []; $('#docTitle').value = 'Névtelen dokumentum'; setCurrentPath(null);
  editor.commands.setContent('<p></p>'); fillPanel(); applyTpl(true); resetTplHistory();
  dirty = false; editedNow = false; sessionOpen = true; setStatus(); saveSoon();
  showHome(false); editor.commands.focus();
  return true;
}
/** Word (.docx) import: a new, unsaved document; MathType and Word equations become TeX formulas. */
async function doImportDocx() {
  closePops();
  if (dirty && editedNow && !await confirmBox('A nem mentett módosítások elvesznek. Importálsz egy Word-dokumentumot?', 'Importálás')) return;
  let picked;
  try { picked = await pickDocx(); } catch (e) { toast('A fájl nem nyitható meg: ' + (e && e.message || e)); return; }
  if (!picked) return;
  if (dirty && !editedNow && await shelveDraft(autoValue())) toast('Az előző, nem mentett dokumentum megmaradt – a kezdőképernyőn állítható vissza.');
  busy('Word-dokumentum importálása…');
  try {
    const r = await importDocx(picked.buf);
    // the document gets the selected template: its page, fonts, sizes and paragraph styles
    setCurrentPath(null);
    $('#docTitle').value = picked.name.replace(/\.docx$/i, '');
    editor.commands.setContent(r.doc, { emitUpdate: false });
    fillPanel(); applyTpl(true); resetTplHistory();
    dirty = true; editedNow = true; sessionOpen = true; setStatus(); saveSoon(); showHome(false);
    busy('');
    const rp = r.report, lines = [`${rp.paragraphs} bekezdés`];
    if (rp.mathtype) lines.push(`${rp.mathtype} MathType-képlet TeX-ként`);
    if (rp.omml) lines.push(`${rp.omml} Word-képlet TeX-ként`);
    if (rp.tables) lines.push(`${rp.tables} táblázat`);
    if (rp.columns) lines.push(`${rp.columns} hasábos rész (keret nélküli táblázatként)`);
    let msg = 'Importálva: ' + lines.join(', ') + '.';
    if (rp.mathtypeFailed) msg += ` ${rp.mathtypeFailed} képletet nem sikerült beolvasni – ezek helyén piros „[képlet]” jelzés áll.`;
    if (rp.objects) msg += ` ${rp.objects} kép, ábra vagy más objektum nem került át (csak a szöveg, a képletek és a táblázatok).`;
    if (rp.skipped.length) msg += ' Kimaradt: ' + rp.skipped.join(', ') + '.';
    await infoBox(msg + ' A dokumentum még nincs elmentve.');
  } catch (e) { busy(''); toast('Az importálás nem sikerült: ' + (e && e.message || e)); }
}
function infoBox(msg) {
  return new Promise(res => {
    const box = $('#cfm'); $('#cfmMsg').textContent = msg; $('#cfmYes').textContent = 'Rendben'; $('#cfmNo').hidden = true; box.hidden = false; $('#cfmYes').focus();
    $('#cfmYes').onclick = () => { box.hidden = true; $('#cfmNo').hidden = false; $('#cfmYes').onclick = null; res(); };
  });
}
/* top bar menus */
$('#bSave').addEventListener('click', () => doSave(false));
$('#fSaveAs').addEventListener('click', () => doSave(true));
$('#fNew').addEventListener('click', newDocument);
$('#fOpen').addEventListener('click', doOpen);
$('#fImport').addEventListener('click', doImportDocx);
/* Markdown: import (a new, unsaved document in the selected template) and export – without pictures */
$('#fImportMd').addEventListener('click', async () => {
  closePops();
  if (dirty && editedNow && !await confirmBox('A nem mentett módosítások elvesznek. Importálsz egy Markdown-fájlt?', 'Importálás')) return;
  let picked; try { picked = await pickMarkdown(); } catch (e) { toast('A fájl nem nyitható meg: ' + (e && e.message || e)); return; }
  if (!picked) return;
  if (dirty && !editedNow && await shelveDraft(autoValue())) toast('Az előző, nem mentett dokumentum megmaradt – a kezdőképernyőn állítható vissza.');
  try {
    const r = importMarkdown(picked.text);
    setCurrentPath(null); customTpl = null; docComments = [];
    $('#docTitle').value = picked.name.replace(/\.(md|markdown|txt)$/i, '');
    editor.commands.setContent(r.doc, { emitUpdate: false });
    fillPanel(); applyTpl(true); resetTplHistory(); dirty = true; editedNow = true; sessionOpen = true; setStatus(); saveSoon(); showHome(false);
    await infoBox(`Importálva: ${r.report.formulas} képlet, ${r.report.tables} táblázat.${r.report.images ? ` ${r.report.images} kép kimaradt.` : ''} A dokumentum még nincs elmentve.`);
  } catch (e) { toast('Az importálás nem sikerült: ' + (e && e.message || e)); }
});
$('#expMd').addEventListener('click', async () => {
  closePops();
  try {
    const r = exportMarkdown(editor.getJSON(), docTitle(), tpl.lists.num);
    toast(await saveMarkdown(r.md, docTitle()) + (r.report.images ? ` (${r.report.images} kép kimaradt)` : ''));
  } catch (e) { toast('A Markdown-export nem sikerült: ' + (e && e.message || e)); }
});
/* light / dark mode (Fájl menu); dark is the default */
function themeLabel() { const dark = document.documentElement.dataset.theme !== 'light'; $('#fTheme').innerHTML = `<span class="cico">${svg(dark ? 'sun' : 'moon')}</span><span class="clbl">${dark ? 'Világos mód' : 'Sötét mód'}</span>`; }
$('#fTheme').addEventListener('click', () => {
  const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = t; lsSet('matekosdoksi.theme', t); themeLabel(); windowTheme(); closePops();
});
/** The window's own title bar follows the mode too (desktop app). */
async function windowTheme() {
  if (!isTauri()) return;
  try { const { getCurrentWindow } = await import('@tauri-apps/api/window'); await getCurrentWindow().setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'); } catch (e) { /* not available */ }
}
themeLabel(); windowTheme();
$('#fHome').addEventListener('click', () => { closePops(); sessionOpen = true; clearTimeout(autoT); saveLocal(); showHome(true); });
$('#expPdf').addEventListener('click', doPdf);
$('#expPrint').addEventListener('click', doPrint);
$('#bZoom').addEventListener('click', e => showPop('popZoom', e.currentTarget));
$('#popZoom').onopen = () => { for (const b of $$('#popZoom [data-zoom]')) b.classList.toggle('on', b.dataset.zoom === String(zoomMode)); };
/** Set the zoom ('auto' = fit, or a percentage). `at` (screen point): that point of the page stays under the pointer. */
function setZoom(z, at) {
  const r0 = outer.getBoundingClientRect(), k0 = scale;
  zoomMode = z === 'auto' ? 'auto' : String(Math.max(25, Math.min(400, Math.round(z))));
  zoomButton(); applyZoom();
  if (at && zoomMode !== 'auto') { const r = outer.getBoundingClientRect(); ws.scrollLeft += r.left + (at.x - r0.left) / k0 * scale - at.x; ws.scrollTop += r.top + (at.y - r0.top) / k0 * scale - at.y; }
  marksSoon(); drawComments();
}
$('#popZoom').addEventListener('click', e => {
  const b = e.target.closest('[data-zoom]'); if (!b) return; closePops();
  setZoom(b.dataset.zoom === 'auto' ? 'auto' : +b.dataset.zoom);
});
/* Zoom at the pointer. Windows (WebView2) reports a touchpad pinch as a wheel event with Ctrl; the Mac as gesture events. */
let zoomRun = null;                  // exact (not rounded) zoom while a wheel / pinch sequence lasts
function zoomBy(factor, at) {
  const pct = Math.round(scale * 100);
  if (!zoomRun || zoomRun.shown !== pct) zoomRun = { v: pct };
  zoomRun.v = Math.max(25, Math.min(400, zoomRun.v * factor));
  setZoom(zoomRun.v, at); zoomRun.shown = Math.round(scale * 100);
}
const zoomable = e => {
  if (!$('#home').hidden) return false;
  const r = ws.getBoundingClientRect(), x = e.clientX, y = e.clientY;
  if (typeof x === 'number' && typeof y === 'number' && (x || y)) return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  return e.target instanceof Node && (ws.contains(e.target) || e.target === document || e.target === document.body || e.target === document.documentElement);
};
window.addEventListener('wheel', e => {
  if (!(e.ctrlKey || e.metaKey) || !zoomable(e)) return;
  e.preventDefault(); e.stopPropagation();
  let d = e.deltaY || e.deltaX; if (e.deltaMode === 1) d *= 33; else if (e.deltaMode === 2) d *= 300;
  if (!d) return;
  zoomBy(Math.abs(d) >= 50 ? (d < 0 ? 1.1 : 1 / 1.1) : Math.exp(-d * 0.01), { x: e.clientX, y: e.clientY });   // a wheel notch: 10%; a touchpad: smooth
}, { passive: false, capture: true });
let pinch = null;
const touchPts = new Map(); let touch0 = null;
ws.addEventListener('pointerdown', e => { if (e.pointerType !== 'touch') return; touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (touchPts.size === 2) { const [a, b] = [...touchPts.values()]; touch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), z: Math.round(scale * 100) }; } });
ws.addEventListener('pointermove', e => {
  if (!touchPts.has(e.pointerId)) return;
  touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touchPts.size !== 2 || !touch0 || !touch0.d) return;
  const [a, b] = [...touchPts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
  setZoom(touch0.z * d / touch0.d, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
});
for (const ev of ['pointerup', 'pointercancel']) ws.addEventListener(ev, e => { touchPts.delete(e.pointerId); if (touchPts.size < 2) touch0 = null; });
for (const t of [window, document]) t.addEventListener('gesturestart', e => { if (!zoomable(e)) return; e.preventDefault(); if (pinch == null) pinch = Math.round(scale * 100); }, { passive: false, capture: true });
for (const t of [window, document]) t.addEventListener('gesturechange', e => { if (pinch == null) return; e.preventDefault(); e.stopPropagation(); setZoom(pinch * (e.scale || 1), { x: e.clientX, y: e.clientY }); }, { passive: false, capture: true });
for (const t of [window, document]) t.addEventListener('gestureend', e => { if (pinch != null) e.preventDefault(); pinch = null; }, { passive: false, capture: true });

function zoomButton() {
  const fit = zoomMode === 'auto';
  $('#bZoom').classList.toggle('fit', fit);
  $('#zoomLabel').textContent = fit ? '' : zoomMode + '%';
  $('#bZoom').title = fit ? 'Nagyítás: illesztés az ablakhoz' : 'Nagyítás: ' + zoomMode + '%';
}
zoomButton();

/* home screen (as in Matekos Prezi) */
let resumeLabel = '';
function showHome(show) {
  $('#home').hidden = !show;
  if (show) {
    const f = currentFileName();
    $('#homeResumeBox').hidden = !(sessionOpen || f || resumeLabel || dirty);
    $('#homeResume b').textContent = f ? titleOfFile(f) : docTitle();
    $('#homeResume span').textContent = dirty ? (f ? 'nem mentett módosításokkal' : 'még nincs fájlba mentve') : sessionOpen ? 'megnyitva' : resumeLabel;
    $('#homeResumeBox').classList.toggle('unsaved', !!dirty);
    renderHomeLists();
  } else { relayout(0); thumbsSoon(true); }
}
const homeDate = t => t ? new Date(t).toLocaleString('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
/** Home screen lists: recoverable unsaved documents and recently used files. */
function renderHomeLists() {
  const dr = recoverableDrafts(), box = $('#homeDrafts');
  box.hidden = !dr.length;
  box.innerHTML = dr.length ? '<h2>Nem mentett munka visszaállítása</h2>' + dr.map(d => `<div class="hrow"><button class="hitem" data-draft="${esc(d.id)}" title="Megnyitás ebben az ablakban"><b>${esc(d.title)}</b><span>${esc(homeDate(d.at))}</span></button><button class="hx" data-dropdraft="${esc(d.id)}" title="Elvetés">${svg('xmark')}</button></div>`).join('') : '';
  const here = getCurrentPath(), rc = isTauri() ? recentFiles().filter(r => r.path !== here).slice(0, 6) : [], rb = $('#homeRecent');
  rb.hidden = !rc.length;
  rb.innerHTML = rc.length ? '<h2>Legutóbbi dokumentumok</h2>' + rc.map(r => { const n = r.path.split(/[\\/]/).pop(); return `<div class="hrow"><button class="hitem" data-recent="${esc(r.path)}" title="${esc(r.path)}"><b>${esc(titleOfFile(n))}</b><span>${esc(homeDate(r.at))}</span></button><button class="hx" data-droprecent="${esc(r.path)}" title="Eltávolítás a listából">${svg('xmark')}</button></div>`; }).join('') : '';
}
/** Home screen: a recently used document. */
async function openRecent(path) {
  if (!await okToReplace('A nem mentett módosítások elvesznek. Megnyitsz egy másik dokumentumot?', 'Megnyitás')) return;
  let r = null;
  try { r = await openPathFile(path); }
  catch (e) { forgetRecent(path); renderHomeLists(); toast(`A(z) „${path.split(/[\\/]/).pop()}” fájl már nincs a korábbi helyén.`); return; }
  openedDocument(r);
}
/** Home screen: continue an unsaved document of a window that is no longer running. */
async function openDraft(id) {
  if (!await okToReplace('A mostani dokumentum nem mentett módosításai elvesznek. Visszaállítod a másikat?', 'Visszaállítás')) return;
  const v = await takeDraft(id);
  if (!v || !(v.doc || v.html)) { renderHomeLists(); toast('Ez a dokumentum már nem állítható vissza (lehet, hogy egy másik ablakban van nyitva).'); return; }
  try {
    setCurrentPath(v.path && /\.mdoksi$/i.test(v.path) ? v.path : null);
    if (getCurrentPath() && !await currentFileExists()) setCurrentPath(null);
    loadData(v);
    if (getCurrentPath()) titleFromFile();
    dirty = true; editedNow = false; sessionOpen = true; setStatus(); saveSoon(); showHome(false);
    toast(getCurrentPath() ? 'Visszaállítva – a módosítások még nincsenek a fájlba mentve.' : 'Visszaállítva – még nincs fájlba mentve.');
  } catch (e) { toast('A dokumentum nem állítható vissza: ' + (e && e.message || e)); }
}
$('#home').addEventListener('click', async e => {
  const b = e.target.closest('[data-draft], [data-dropdraft], [data-recent], [data-droprecent]'); if (!b) return;
  if (b.dataset.draft) return openDraft(b.dataset.draft);
  if (b.dataset.recent) return openRecent(b.dataset.recent);
  if (b.dataset.droprecent) { forgetRecent(b.dataset.droprecent); renderHomeLists(); return; }
  if (await confirmBox('Biztosan elveted ezt a nem mentett dokumentumot? Később már nem állítható vissza.', 'Elvetés')) { await dropDraft(b.dataset.dropdraft); renderHomeLists(); }
});
/* "a new version is out": checked once at start-up (see src/updates.js and update.json) */
async function runUpdateCheck(url) {
  const u = await checkForUpdate(url); if (!u) return false;
  $('#updVer').textContent = u.version + ` (most: ${APP_VERSION})`;
  $('#updMsg').innerHTML = esc(u.message || '').replace(/\n/g, '<br>');
  $('#updBox').hidden = false;
  $('#updLater').onclick = () => { $('#updBox').hidden = true; };
  $('#updGo').onclick = () => { $('#updBox').hidden = true; if (u.url) openLink(u.url); };
  return true;
}
setTimeout(() => runUpdateCheck(), 2500);
$('#homeNew').addEventListener('click', newDocument);
$('#homeOpen').addEventListener('click', doOpen);
$('#homeResume').addEventListener('click', () => { sessionOpen = true; showHome(false); });

document.addEventListener('keydown', e => {
  const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
  if (!mod) return;
  const k = e.key.toLowerCase();
  if ((k === 'z' || k === 'y') && $('#home').hidden && !hfEd && !(e.target.closest && e.target.closest('.ProseMirror, .pop, #mathDlg, #cmtView, #docTitle'))) { e.preventDefault(); if (k === 'y' || e.shiftKey) unifiedRedo(); else unifiedUndo(); return; }
  if (['0', '+', '=', '-'].includes(k) && $('#home').hidden) { e.preventDefault(); const pct = Math.round(scale * 100); setZoom(k === '0' ? 'auto' : k === '-' ? pct / 1.25 : pct * 1.25); return; }
  if (k === 's') { e.preventDefault(); doSave(e.shiftKey); }
  else if (k === 'f') { e.preventDefault(); showPop('popFind', $('[data-pop="popFind"]')); }
  else if (k === 'o') { e.preventDefault(); doOpen(); }
  else if (k === 'p') { e.preventDefault(); doPrint(); }
});
addEventListener('resize', () => { applyZoom(); closePops(); thumbsSoon(); });
ws.addEventListener('scroll', () => { if (openPop && openPop.id === 'popFind') return; closePops(); }, { passive: true });   // find stays open while it scrolls to the matches
function quitBox() {
  return new Promise(res => {
    const box = $('#cfm'), extra = document.createElement('button');
    extra.className = 'btn'; extra.textContent = 'Mentés és kilépés';
    $('#cfmMsg').textContent = 'A dokumentumban nem mentett módosítások vannak. Kilépsz mentés nélkül?';
    $('#cfmYes').textContent = 'Kilépés mentés nélkül'; $('#cfmNo').after(extra); box.hidden = false;
    const done = v => { box.hidden = true; extra.remove(); removeEventListener('keydown', key, true); $('#cfmYes').onclick = $('#cfmNo').onclick = null; res(v); };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done('stay'); } else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done('save'); } };
    addEventListener('keydown', key, true); extra.focus();
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
  if (lsGet('matekosdoksi.pages') === '0') { mainEl.classList.add('nopages'); document.body.classList.add('nopages-on'); }
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
    resumeLabel = 'legutóbb megnyitva';
  } else {
    tpl = startTpl(); $('#docTitle').value = 'Trigonometria'; editor.commands.setContent(SAMPLE_HTML, { emitUpdate: false }); fillPanel(); applyTpl(true); resetTplHistory();
    resumeLabel = 'mintadokumentum';
  }
  setStatus();
  loadFonts().then(() => relayout(0));
  document.fonts && document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', () => { relayout(30); if (tpl.hyphenate) { hyDone = new WeakMap(); hyphenSoon(400); } });
  mathReady.then(() => { relayout(100); if (tpl.hyphenate) { hyDone = new WeakMap(); hyphenSoon(600); } });
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
window.mdoksi = { runUpdateCheck, editor, editHF, closeHF, importDocx, importMarkdown, exportMarkdown, makePdf, get tpl() { return tpl; }, set tpl(t) { tpl = normalizeTpl(t); applyTpl(true); }, get pages() { return pageCount; }, ready, setZoom: z => { zoomMode = z; applyZoom(); }, setZoomAt: setZoom, renderThumbs };
