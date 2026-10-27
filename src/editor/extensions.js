import { Extension, Node, Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { BulletList, OrderedList } from '@tiptap/extension-list';
import { Table, TableRow, TableCell, TableHeader, TableView } from '@tiptap/extension-table';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { renderInto, isReady, mathReady, mathFontFromCSS } from '../math.js';
import { layoutTabs } from '../tabs.js';

const numOrNull = v => (v === '' || v === null || v === undefined || isNaN(+v)) ? null : +v;

/* ------------------------------------------------------------------ */
/* Paragraph formatting: spacing, indents, line height, line shading   */
/* ------------------------------------------------------------------ */
const ruleVars = (k, v) => { const [w, c] = String(v).split(' '); return `--r${k}w:${parseFloat(w) || 0.75}pt;--r${k}c:${c || '#111111'}`; };
export const ParaFormat = Extension.create({
  name: 'paraFormat',
  addGlobalAttributes() {
    const css = (key, name, prop, unit) => ({
      default: null,
      parseHTML: el => numOrNull(el.getAttribute('data-' + name)),
      renderHTML: a => a[key] == null ? {} : { style: `${prop}:${a[key]}${unit}`, ['data-' + name]: a[key] }
    });
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        lineHeight: {
          default: null,
          parseHTML: el => { const v = el.style.lineHeight; return v && /^[\d.]+$/.test(v) ? +v : numOrNull(el.getAttribute('data-lh')); },
          renderHTML: a => a.lineHeight ? { style: `line-height:${a.lineHeight}`, 'data-lh': a.lineHeight } : {}
        },
        spaceBefore: css('spaceBefore', 'sb', '--sb', 'pt'),
        spaceAfter: css('spaceAfter', 'sa', '--sa', 'pt'),
        indentLeft: css('indentLeft', 'il', 'margin-left', 'cm'),
        indentRight: css('indentRight', 'ir', 'margin-right', 'cm'),
        firstLine: css('firstLine', 'fl', 'text-indent', 'cm'),
        shade: {
          default: null,
          parseHTML: el => el.getAttribute('data-shade') || null,
          renderHTML: a => a.shade ? { class: 'shaded', style: `--shade:${a.shade}`, 'data-shade': a.shade } : {}
        },
        keepNext: {
          default: false,
          parseHTML: el => el.getAttribute('data-kn') === '1',
          renderHTML: a => a.keepNext ? { 'data-kn': '1' } : {}
        },
        // tab stops: "hf" (centre + right of a header/footer) or JSON [{pos: cm, align: left|center|right}]
        tabStops: {
          default: null,
          parseHTML: el => el.getAttribute('data-tabs') || null,
          renderHTML: a => a.tabStops ? { 'data-tabs': typeof a.tabStops === 'string' ? a.tabStops : JSON.stringify(a.tabStops) } : {}
        },
        // margin-to-margin line above / below the paragraph: "width color", e.g. "0.75 #111111"
        ruleTop: { default: null, parseHTML: el => el.getAttribute('data-rt') || null, renderHTML: a => a.ruleTop ? { 'data-rt': a.ruleTop, style: ruleVars('t', a.ruleTop) } : {} },
        ruleBottom: { default: null, parseHTML: el => el.getAttribute('data-rb') || null, renderHTML: a => a.ruleBottom ? { 'data-rb': a.ruleBottom, style: ruleVars('b', a.ruleBottom) } : {} }
      }
    }];
  },
  addCommands() {
    return {
      setParaAttrs: attrs => ({ tr, state, dispatch }) => {
        const { from, to } = state.selection;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name === 'paragraph' || node.type.name === 'heading') tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
        });
        if (dispatch) dispatch(tr);
        return true;
      },
      shiftIndent: delta => ({ tr, state, dispatch }) => {
        const { from, to } = state.selection;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name === 'paragraph' || node.type.name === 'heading') {
            const v = Math.max(0, Math.round(((node.attrs.indentLeft || 0) + delta) * 100) / 100);
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, indentLeft: v || null });
          }
        });
        if (dispatch) dispatch(tr);
        return true;
      }
    };
  }
});

/* ------------------------------------------------------------------ */
/* Lists with custom symbol / picture bullets and numbering styles     */
/* ------------------------------------------------------------------ */
function legacyBullet(el) {
  const v = el.style && el.style.getPropertyValue('--bullet');
  if (!v) return '';
  try { return JSON.parse(v.trim().replace(/^'|'$/g, '"')); } catch (e) { return v.replace(/["']/g, ''); }
}
export const KvBulletList = BulletList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      bulletChar: { default: '', parseHTML: el => el.getAttribute('data-bullet') || legacyBullet(el) || '', renderHTML: a => a.bulletChar ? { 'data-bullet': a.bulletChar } : {} },
      bulletImage: { default: '', parseHTML: el => el.getAttribute('data-bullet-img') || '', renderHTML: a => a.bulletImage ? { 'data-bullet-img': a.bulletImage } : {} },
      bulletSize: { default: 0.9, parseHTML: el => numOrNull(el.getAttribute('data-bullet-size')) ?? 0.9, renderHTML: a => a.bulletImage ? { 'data-bullet-size': a.bulletSize } : {} }
    };
  }
});
export const KvOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      numStyle: { default: null, parseHTML: el => el.getAttribute('data-num') || null, renderHTML: a => a.numStyle ? { 'data-num': a.numStyle } : {} }
    };
  }
});

function ordinal(n, style) {
  const alpha = (k, up) => { let s = ''; while (k > 0) { k--; s = String.fromCharCode(97 + k % 26) + s; k = Math.floor(k / 26); } return up ? s.toUpperCase() : s; };
  const roman = (k, up) => { const t = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let s = ''; for (const [v, r] of t) while (k >= v) { s += r; k -= v; } return up ? s.toUpperCase() : s; };
  switch (style) {
    case 'decimal-paren': return n + ')';
    case 'lower-alpha': return alpha(n) + ')';
    case 'upper-alpha': return alpha(n, true) + '.';
    case 'lower-roman': return roman(n) + '.';
    case 'upper-roman': return roman(n, true) + '.';
    default: return n + '.';
  }
}
const DEFAULT_BULLETS = ['•', '◦', '▪'];
/** Default list symbol and numbering of the document template (Normál stílus). */
export const listDefaults = { bullet: '•', num: 'decimal' };
const bulletAt = depth => depth % 3 === 0 ? (listDefaults.bullet || '•') : DEFAULT_BULLETS[depth % 3];
/** Real (measurable, printable) list markers, rendered as widgets at the start of each item's first line. */
export const ListMarkers = Extension.create({
  name: 'listMarkers',
  addProseMirrorPlugins() {
    const build = doc => {
      const decos = [];
      /** carry: markers of outer items whose first line is the first line of a nested list (same-line nesting) */
      const walk = (node, pos, depth, carry) => {
        node.forEach((child, off) => {
          const cpos = pos + off + 1;
          if (child.type.name === 'bulletList' || child.type.name === 'orderedList') {
            const ordered = child.type.name === 'orderedList';
            const start = ordered ? (child.attrs.start ?? 1) : 1;
            child.forEach((item, ioff, idx) => {
              const ipos = cpos + 1 + ioff;          // position of listItem
              const first = item.firstChild;
              const mk = {
                key: ordered ? 'o' + ordinal(start + idx, child.attrs.numStyle || listDefaults.num)
                  : child.attrs.bulletImage ? 'i' + child.attrs.bulletSize + child.attrs.bulletImage.length + child.attrs.bulletImage.slice(-24)
                    : 'b' + (child.attrs.bulletChar || bulletAt(depth)),
                text: ordered ? ordinal(start + idx, child.attrs.numStyle || listDefaults.num) : child.attrs.bulletImage ? null : (child.attrs.bulletChar || bulletAt(depth)),
                img: !ordered && child.attrs.bulletImage ? child.attrs.bulletImage : null, size: child.attrs.bulletSize || 0.9
              };
              const here = idx === 0 && carry ? carry : [];
              // an item that starts with an empty line and a list: the nested list's first item shares the line
              const sameLine = first && first.isTextblock && !first.content.size && item.childCount > 1 && /List$/.test(item.child(1).type.name);
              if (sameLine) {
                decos.push(Decoration.node(ipos + 1, ipos + 1 + first.nodeSize, { class: 'lm-collapsed' }));
                walk(item, ipos, depth + 1, [...here.map(m => ({ ...m, up: m.up + 1 })), { ...mk, up: 1 }]);
                return;
              }
              if (first && first.isTextblock) {
                for (const m of [{ ...mk, up: 0 }, ...here]) {
                  decos.push(Decoration.widget(ipos + 2, () => {
                    const s = document.createElement('span');
                    s.className = 'lm' + (m.up ? ' lm-up' : '');
                    if (m.up) s.style.setProperty('--up', m.up);
                    s.contentEditable = 'false';
                    if (m.img) { const im = document.createElement('img'); im.src = m.img; im.alt = ''; im.style.height = m.size + 'em'; s.appendChild(im); }
                    else s.textContent = m.text;
                    return s;
                  }, { side: -1, key: m.key + '|' + m.up, ignoreSelection: true }));
                }
              }
              walk(item, ipos, depth + 1, null);
            });
          } else if (!child.isTextblock && child.childCount) walk(child, cpos, depth, null);
        });
      };
      walk(doc, -1, 0, null);
      return DecorationSet.create(doc, decos);
    };
    return [new Plugin({
      key: new PluginKey('listMarkers'),
      state: {
        init: (_, state) => build(state.doc),
        apply: (tr, old, _o, state) => tr.docChanged || tr.getMeta('listDefaults') ? build(state.doc) : old
      },
      props: { decorations(state) { return this.getState(state); } }
    })];
  }
});

/* ------------------------------------------------------------------ */
/* Table cells: fill colour and vertical alignment                     */
/* ------------------------------------------------------------------ */
const cellAttrs = {
  background: {
    default: null,
    parseHTML: el => el.getAttribute('data-bg') || el.style.backgroundColor || null,
    renderHTML: a => a.background ? { 'data-bg': a.background, style: `background-color:${a.background}` } : {}
  },
  vAlign: {
    default: 'top',
    parseHTML: el => el.getAttribute('data-valign') || el.style.verticalAlign || 'top',
    renderHTML: a => a.vAlign && a.vAlign !== 'top' ? { 'data-valign': a.vAlign, style: `vertical-align:${a.vAlign}` } : {}
  }
};
cellAttrs.borderWidth = {
  default: null,
  parseHTML: el => numOrNull(el.getAttribute('data-bw')),
  renderHTML: a => a.borderWidth == null ? {} : { 'data-bw': a.borderWidth, style: a.borderWidth > 0 ? `border-width:${a.borderWidth}pt;border-style:solid` : 'border-style:hidden' }
};
cellAttrs.borderColor = {
  default: null,
  parseHTML: el => el.getAttribute('data-bc') || null,
  renderHTML: a => a.borderColor ? { 'data-bc': a.borderColor, style: `border-color:${a.borderColor}` } : {}
};
export const KvTableCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...cellAttrs }; } });
export const KvTableHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...cellAttrs }; } });

/* ------------------------------------------------------------------ */
/* Page break                                                          */
/* ------------------------------------------------------------------ */
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() { return [{ tag: 'div[data-pagebreak]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { class: 'pagebreak', 'data-pagebreak': '1' })]; },
  addCommands() {
    return { setPageBreak: () => ({ chain }) => chain().insertContent([{ type: 'pageBreak' }, { type: 'paragraph' }]).run() };
  },
  addKeyboardShortcuts() { return { 'Mod-Enter': () => this.editor.commands.setPageBreak() }; }
});

/* ------------------------------------------------------------------ */
/* Tables: width, row height                                           */
/* ------------------------------------------------------------------ */
class KvTableView extends TableView {
  constructor(node, cellMinWidth, view, attrs) { super(node, cellMinWidth, view, attrs); this.kv(node); }
  update(node) { const ok = super.update(node); if (ok) this.kv(node); return ok; }
  kv(node) {
    const w = node.attrs.width;
    if (w && (!this.table.style.width || this.table.style.width.endsWith('%'))) this.table.style.width = w + '%';
    else if (!w && this.table.style.width.endsWith('%')) this.table.style.width = '';
    const al = node.attrs.align || 'left';
    this.table.style.marginLeft = al === 'left' ? '0' : 'auto';
    this.table.style.marginRight = al === 'right' ? '0' : 'auto';
  }
}
export const KvTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null, parseHTML: el => numOrNull(el.getAttribute('data-width')), renderHTML: a => a.width ? { 'data-width': a.width, style: `width:${a.width}%` } : {} },
      align: {
        default: 'left',
        parseHTML: el => el.getAttribute('data-align') || 'left',
        renderHTML: a => a.align && a.align !== 'left' ? { 'data-align': a.align, style: a.align === 'center' ? 'margin-left:auto;margin-right:auto' : 'margin-left:auto;margin-right:0' } : {}
      }
    };
  }
}).configure({ View: KvTableView, resizable: false, cellMinWidth: 24 });
export const KvTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      height: { default: null, parseHTML: el => numOrNull(el.getAttribute('data-h')), renderHTML: a => a.height ? { 'data-h': a.height, style: `height:${a.height}mm` } : {} }
    };
  }
});

/** Find the table around the selection: { table, pos, map, rect (selected cell rectangle) } */
export function tableContext(state) {
  const sel = state.selection;
  const $p = sel instanceof CellSelection ? sel.$anchorCell : sel.$from;
  for (let d = $p.depth; d > 0; d--) {
    const n = $p.node(d);
    if (n.type.spec.tableRole === 'table') {
      const pos = $p.before(d), map = TableMap.get(n), start = pos + 1;
      let rect;
      if (sel instanceof CellSelection) rect = map.rectBetween(sel.$anchorCell.pos - start, sel.$headCell.pos - start);
      else {
        let cellPos = null;
        for (let e = $p.depth; e > d; e--) if ($p.node(e).type.spec.tableRole && $p.node(e).type.spec.tableRole.includes('cell')) { cellPos = $p.before(e); break; }
        rect = cellPos == null ? { left: 0, top: 0, right: 1, bottom: 1 } : map.findCell(cellPos - start);
      }
      return { table: n, pos, start, map, rect };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Line shading: colours whole lines (any lines, not only paragraphs)  */
/* The mark only records which text is shaded; full-width bands are    */
/* drawn behind those lines by the layout code (src/shading.js).        */
/* ------------------------------------------------------------------ */
export const LineShade = Mark.create({
  name: 'lineShade',
  inclusive: true,
  addAttributes() { return { color: { default: '#dbe9ee', parseHTML: el => el.getAttribute('data-lshade') } }; },
  parseHTML() { return [{ tag: 'span[data-lshade]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', { 'data-lshade': HTMLAttributes.color }, 0]; }
});

/* ------------------------------------------------------------------ */
/* Formulas                                                            */
/* ------------------------------------------------------------------ */
const mathKey = new PluginKey('mathTools');
const isBold = n => n.marks.some(m => m.type.name === 'bold');   // bold formulas: \boldsymbol
/* math font of the document's font set (template); null = Bonum, MathJax's main font */
let docMathFont = null;
export function setDocMathFont(key) { const k = key && key !== 'bonum' ? key : null; const ch = k !== docMathFont; docMathFont = k; return ch; }
/** Font and boldness of a formula, as in Matekos Prezi: from its own marks (the text formatting around it), else the template font. */
export function mathLook(n) {
  const ts = n.marks.find(m => m.type.name === 'textStyle');
  const own = ts && ts.attrs.fontFamily ? mathFontFromCSS(ts.attrs.fontFamily) : undefined;
  let font = own === undefined ? docMathFont : own;            // a text font without a math version: the document's math font
  if (own === null) font = docMathFont;
  if (font === 'bonum') font = null;
  return { font, bold: isBold(n) };
}
/** The look from the page itself: the formula's text font and weight (marks, paragraph style, heading). */
export function lookOf(n, dom) {
  const base = mathLook(n);
  if (!dom || !dom.isConnected) return base;
  const cs = getComputedStyle(dom);
  let font = mathFontFromCSS(cs.fontFamily) || docMathFont;
  if (font === 'bonum') font = null;
  return { font, bold: base.bold || (parseInt(cs.fontWeight, 10) || 400) >= 600 };
}
/** Formatting a new formula takes over: the marks in effect at the cursor (bold, colour, size, font…). */
export const marksAt = state => (state.storedMarks || state.selection.$from.marks()).filter(m => !['link', 'code'].includes(m.type.name));
const DOLLAR_RE = /(\\?)\$\$([^$]+?)\$\$|(\\?)\$([^$\s](?:[^$]*?[^$\s\\])?)\$|\\\((.+?)\\\)|\\\[(.+?)\\\]/g;

function cellPosAround(doc, pos) {
  const $p = doc.resolve(pos);
  for (let d = $p.depth; d > 0; d--) { const r = $p.node(d).type.spec.tableRole; if (r === 'cell' || r === 'header_cell') return $p.before(d); }
  return null;
}

export const MathNode = Node.create({
  name: 'math',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addOptions() { return { onEdit: null, onRendered: null, onPreview: null }; },
  addAttributes() {
    return {
      tex: { default: '', parseHTML: el => el.getAttribute('data-tex') || '' },
      display: { default: false, parseHTML: el => el.getAttribute('data-display') === '1' || el.classList.contains('disp') },
      wrap: { default: false, parseHTML: el => el.getAttribute('data-wrap') === '1' }
    };
  },
  parseHTML() { return [{ tag: 'span[data-tex]' }]; },
  renderHTML({ node }) {
    return ['span', { class: 'math' + (node.attrs.display ? ' disp' : '') + (node.attrs.wrap ? ' wrap' : ''), 'data-tex': node.attrs.tex, 'data-display': node.attrs.display ? '1' : '0', ...(node.attrs.wrap ? { 'data-wrap': '1' } : {}) }];
  },
  renderText({ node }) { return node.attrs.display ? `$$${node.attrs.tex}$$` : `$${node.attrs.tex}$`; },
  addNodeView() {
    const ext = this;
    return ({ node, getPos, editor }) => {
      let cur = node;
      const dom = document.createElement('span');
      dom.contentEditable = 'false';
      const paint = () => {
        dom.className = 'math' + (cur.attrs.display ? ' disp' : '') + (cur.attrs.wrap ? ' wrap' : '') + (dom._sel ? ' ProseMirror-selectednode' : '');
        dom.setAttribute('data-tex', cur.attrs.tex);
        const lk = lookOf(cur, dom); dom._lk = lk.font + '|' + lk.bold;
        renderInto(dom, cur.attrs.tex, cur.attrs.display, () => ext.options.onRendered && ext.options.onRendered(), lk.bold, cur.attrs.wrap, lk.font);
        // once on the page: take the font / weight of the paragraph style around it (e.g. a bold heading)
        if (!dom.isConnected) requestAnimationFrame(() => { const l2 = lookOf(cur, dom); if (dom.isConnected && l2.font + '|' + l2.bold !== dom._lk) paint(); });
      };
      paint();
      // Mouse: click = select the formula; click on its left/right edge = cursor before/after it;
      // press and drag = select text (or table cells) starting at the formula; double click = edit.
      dom.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        if (e.detail === 3) {                      // triple click inside a table: select the whole cell
          const pos = getPos(), view = editor.view;
          const cell = typeof pos === 'number' ? cellPosAround(view.state.doc, pos) : null;
          if (cell != null) { e.preventDefault(); view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cell))); }
          return;
        }
        if (e.detail > 1) return;
        e.preventDefault();
        const view = editor.view, pos = getPos();
        if (typeof pos !== 'number') return;
        const r = dom.getBoundingClientRect();
        const edge = Math.max(3, Math.min(r.width * 0.22, 9));
        const zone = e.clientX < r.left + edge ? 'before' : e.clientX > r.right - edge ? 'after' : 'node';
        const anchor = e.clientX < r.left + r.width / 2 ? pos : pos + cur.nodeSize;
        // set the selection first, then focus without scrolling (focusing first would jump to the old cursor)
        const doc0 = view.state.doc;
        const first = e.shiftKey ? TextSelection.create(doc0, view.state.selection.anchor, zone === 'before' ? pos : pos + cur.nodeSize)
          : zone === 'node' ? NodeSelection.create(doc0, pos) : TextSelection.create(doc0, zone === 'before' ? pos : pos + cur.nodeSize);
        view.dispatch(view.state.tr.setSelection(first));
        if (!view.hasFocus()) view.dom.focus({ preventScroll: true });
        if (e.shiftKey) return;
        const anchorCell = cellPosAround(view.state.doc, pos);
        const sx = e.clientX, sy = e.clientY;
        let moved = false;
        const mv = ev => {
          if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
          moved = true;
          const hit = view.posAtCoords({ left: ev.clientX, top: ev.clientY });
          if (!hit) return;
          const doc = view.state.doc;
          const headCell = cellPosAround(doc, hit.pos);
          try {
            if (anchorCell != null && headCell != null && headCell !== anchorCell) view.dispatch(view.state.tr.setSelection(CellSelection.create(doc, anchorCell, headCell)));
            else view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, anchor, hit.pos)));
          } catch (err) { /* position not selectable */ }
        };
        const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
        addEventListener('mousemove', mv); addEventListener('mouseup', up);
      });
      dom.addEventListener('dblclick', e => {
        e.preventDefault(); e.stopPropagation();
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos != null && ext.options.onEdit) ext.options.onEdit(pos, cur);
      });
      return {
        dom,
        update(n) {
          if (n.type !== cur.type) return false;
          const lk = lookOf(n, dom);
          const changed = n.attrs.tex !== cur.attrs.tex || n.attrs.display !== cur.attrs.display || n.attrs.wrap !== cur.attrs.wrap || (lk.font + '|' + lk.bold) !== dom._lk;
          cur = n;
          if (changed) paint();
          return true;
        },
        selectNode() { dom._sel = true; dom.classList.add('ProseMirror-selectednode'); },
        deselectNode() { dom._sel = false; dom.classList.remove('ProseMirror-selectednode'); },
        ignoreMutation: () => true,
        stopEvent: e => e.type === 'mousedown' || e.type === 'mouseup' || e.type === 'click' || e.type === 'dblclick' || e.type === 'dragstart'
      };
    };
  },
  addKeyboardShortcuts() {
    return {
      'Mod-m': () => { this.options.onEdit && this.options.onEdit(null, null); return true; },
      'Mod-M': () => { this.options.onEdit && this.options.onEdit(null, null); return true; }
    };
  },
  addProseMirrorPlugins() {
    const ext = this;
    const type = this.type;
    const nearMath = state => {
      const sel = state.selection;
      if (!sel.empty || !(sel instanceof TextSelection)) return false;
      const $p = sel.$from;
      return ($p.nodeBefore && $p.nodeBefore.type === type) || ($p.nodeAfter && $p.nodeAfter.type === type);
    };
    return [new Plugin({
      key: mathKey,
      // Pasted text: $…$, $$…$$, \(…\) and \[…\] become formulas immediately
      appendTransaction(trs, oldState, state) {
        const paste = trs.find(tr => tr.getMeta('uiEvent') === 'paste' || tr.getMeta('paste'));
        if (!paste) return null;
        let from = Infinity, to = -Infinity;
        trs.forEach((tr, ti) => tr.steps.forEach((step, si) => {
          step.getMap().forEach((a, b, s0, e0) => {
            let s = s0, en = e0;
            for (let k = si + 1; k < tr.steps.length; k++) { s = tr.steps[k].getMap().map(s, -1); en = tr.steps[k].getMap().map(en, 1); }
            for (let t = ti + 1; t < trs.length; t++) { s = trs[t].mapping.map(s, -1); en = trs[t].mapping.map(en, 1); }
            from = Math.min(from, s); to = Math.max(to, en);
          });
        }));
        if (!(to > from)) return null;
        const hits = [];
        state.doc.nodesBetween(Math.max(0, from), Math.min(state.doc.content.size, to), (n, pos) => {
          if (!n.isText) return;
          DOLLAR_RE.lastIndex = 0; let m;
          while ((m = DOLLAR_RE.exec(n.text))) {
            if (m[1] === '\\' || m[3] === '\\') continue;                 // \$ stays a dollar sign
            const display = m[2] !== undefined || m[6] !== undefined;
            const tex = (m[2] ?? m[4] ?? m[5] ?? m[6] ?? '').trim();
            if (tex) hits.push({ from: pos + m.index, to: pos + m.index + m[0].length, tex, display, marks: n.marks });
          }
        });
        if (!hits.length) return null;
        // pasted formulas take the formatting of the text where they were pasted (bold, colour, size, font)
        const here = marksAt(oldState);
        const tr = state.tr;
        for (const h of hits.reverse()) tr.replaceWith(h.from, h.to, type.create({ tex: h.tex, display: h.display, wrap: true }, null, here.length ? here : h.marks));
        return tr;
      },
      props: {
        // $…$ and $$…$$ become formulas the moment the closing $ is typed
        handleTextInput(view, from, to, text) {
          if (text !== '$') return false;
          const $from = view.state.doc.resolve(from);
          if (!$from.parent.isTextblock || $from.parent.type.spec.code) return false;
          const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc') + '$';
          let m = before.match(/(?:^|[^\\])\$\$([^$\ufffc]+?)\$\$$/), display = true, start;
          if (m && m[1].trim()) start = from - (m[1].length + 3);
          else {
            m = before.match(/(?:^|[^\\$])\$([^$\s\ufffc](?:[^$\ufffc]*?[^$\s\\\ufffc])?)\$$/);
            if (!m) return false;
            display = false; start = from - (m[1].length + 1);
          }
          const tex = display ? m[1].trim() : m[1];
          const tr = view.state.tr.replaceWith(start, to, type.create({ tex, display, wrap: true }, null, $from.marks()));
          tr.setSelection(TextSelection.create(tr.doc, start + 1));
          view.dispatch(tr.scrollIntoView());
          return true;
        },
        decorations(state) {
          const sel = state.selection, decos = [];
          // formulas inside a text selection are highlighted exactly like the text around them
          if (!sel.empty && !(sel instanceof NodeSelection)) {
            state.doc.nodesBetween(sel.from, sel.to, (n, pos) => {
              if (n.type === type && pos >= sel.from && pos + n.nodeSize <= sel.to) decos.push(Decoration.node(pos, pos + n.nodeSize, { class: 'in-sel' }));
            });
          }
          // (the visible cursor next to a formula is drawn as an overlay by the app, so nothing in the text changes)
          return decos.length ? DecorationSet.create(state.doc, decos) : null;
        },
        attributes(state) { return nearMath(state) ? { class: 'math-caret' } : {}; }
      },
      view() {
        return {
          update(view) {
            if (!ext.options.onPreview) return;
            const sel = view.state.selection;
            if (!sel.empty || !view.hasFocus()) return ext.options.onPreview(null);
            const $p = sel.$from;
            if (!$p.parent.isTextblock) return ext.options.onPreview(null);
            const before = $p.parent.textBetween(0, $p.parentOffset, undefined, '\ufffc');
            const m = before.match(/(?:^|[^\\$])\$\$?([^$\s\ufffc][^$\ufffc]*)$/);
            if (!m) return ext.options.onPreview(null);
            ext.options.onPreview({ tex: m[1], coords: view.coordsAtPos(sel.from) });
          },
          destroy() { ext.options.onPreview && ext.options.onPreview(null); }
        };
      }
    })];
  }
});
export { isReady as mathIsReady, mathReady };

/* ------------------------------------------------------------------ */
/* Images: text wrap, free placement by drag, corner resize            */
/* ------------------------------------------------------------------ */
const WRAPS = ['wl', 'wr', 'ctr', 'inl'];
const imgStyle = a => {
  const st = [];
  if (a.width) st.push(`width:${a.width}px`);
  if (a.wrap === 'wl') st.push(`margin-left:${a.dx || 0}px`, `margin-top:calc(.2em + ${a.dy || 0}px)`);
  if (a.wrap === 'wr') st.push(`margin-right:${a.dx || 0}px`, `margin-top:calc(.2em + ${a.dy || 0}px)`);
  return st.join(';');
};
export const KvImage = Node.create({
  name: 'image',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addOptions() { return { getScale: () => 1, onChange: null }; },
  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: '' },
      width: { default: null, parseHTML: el => parseFloat(el.style.width) || numOrNull(el.getAttribute('width')) },
      wrap: { default: 'wl', parseHTML: el => el.getAttribute('data-wrap') || WRAPS.find(w => el.classList.contains(w)) || 'wl' },
      dx: { default: 0, parseHTML: el => numOrNull(el.getAttribute('data-dx')) || 0 },
      dy: { default: 0, parseHTML: el => numOrNull(el.getAttribute('data-dy')) || 0 }
    };
  },
  parseHTML() { return [{ tag: 'img[src]' }]; },
  renderHTML({ node }) {
    const a = node.attrs;
    return ['img', { src: a.src, alt: a.alt || '', 'data-wrap': a.wrap, 'data-dx': a.dx || 0, 'data-dy': a.dy || 0, class: a.wrap, style: imgStyle(a) || null }];
  },
  addNodeView() {
    const ext = this;
    return ({ node, getPos, editor }) => {
      let cur = node, selected = false;
      const dom = document.createElement('span');
      dom.draggable = false;
      const img = document.createElement('img');
      img.draggable = false;
      dom.appendChild(img);
      const paint = () => {
        dom.className = 'imgw ' + (cur.attrs.wrap || 'wl') + (selected ? ' ProseMirror-selectednode' : '');
        if (img.getAttribute('src') !== cur.attrs.src) img.src = cur.attrs.src;
        img.alt = cur.attrs.alt || '';
        dom.style.cssText = imgStyle(cur.attrs);
        ext.options.onChange && ext.options.onChange();
      };
      paint();
      const view = () => editor.view;
      img.addEventListener('load', () => {
        if (!cur.attrs.width && img.naturalWidth) {
          const col = view().dom.clientWidth || 600;
          const w = Math.round(Math.min(img.naturalWidth, col * 0.45));
          const pos = getPos();
          if (typeof pos === 'number') view().dispatch(view().state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, width: w }).setMeta('addToHistory', false));
        }
        view().dom.dispatchEvent(new CustomEvent('kv-relayout', { bubbles: true }));
      });
      const setAttrs = attrs => { const pos = getPos(); if (typeof pos === 'number') view().dispatch(view().state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, ...attrs })); };
      const reselect = () => { const p = getPos(); if (typeof p === 'number') view().dispatch(view().state.tr.setSelection(NodeSelection.create(view().state.doc, p))); };
      // corner handles: resize (keeps proportions)
      const resize = (e, h, size) => {
        const scale = ext.options.getScale() || 1;
        const sx = e.clientX, startW = dom.getBoundingClientRect().width / scale, sign = h.includes('e') ? 1 : -1;
        const maxW = view().dom.clientWidth;
        let w = startW;
        const mv = ev => {
          w = Math.max(16, Math.min(maxW, startW + sign * (ev.clientX - sx) / scale));
          dom.style.width = Math.round(w) + 'px';
          if (size) size.textContent = Math.round(w / (96 / 25.4)) + ' mm';
          ext.options.onChange && ext.options.onChange();
        };
        const up = () => {
          removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
          if (size) size.textContent = '';
          setAttrs({ width: Math.round(w) }); reselect();
        };
        addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
      };

      // body: click selects (nothing else changes); drag moves the picture freely
      const move = e => {
        const v = view(), scale = ext.options.getScale() || 1;
        const r0 = dom.getBoundingClientRect(), ox = e.clientX - r0.left, oy = e.clientY - r0.top;
        const sx = e.clientX, sy = e.clientY;
        let ghost = null, ind = null;
        const wrapped = cur.attrs.wrap === 'wl' || cur.attrs.wrap === 'wr';
        const mv = ev => {
          if (!ghost) {
            if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
            ghost = img.cloneNode(); ghost.className = 'img-ghost';
            ghost.style.width = r0.width + 'px'; ghost.style.height = r0.height + 'px';
            document.body.appendChild(ghost);
            if (!wrapped) { ind = document.createElement('div'); ind.className = 'drop-ind'; document.body.appendChild(ind); }
            dom.classList.add('moving');
            ext.options.onChange && ext.options.onChange('moving');
          }
          ghost.style.left = (ev.clientX - ox) + 'px'; ghost.style.top = (ev.clientY - oy) + 'px';
          if (ind) {
            const hit = v.posAtCoords({ left: ev.clientX, top: ev.clientY });
            if (hit) { const c = v.coordsAtPos(hit.pos); ind.style.left = c.left + 'px'; ind.style.top = c.top + 'px'; ind.style.height = (c.bottom - c.top) + 'px'; }
          }
          const ws = document.getElementById('ws');
          if (ws) { const wr = ws.getBoundingClientRect(); if (ev.clientY < wr.top + 40) ws.scrollTop -= 14; else if (ev.clientY > wr.bottom - 40) ws.scrollTop += 14; }
        };
        const up = ev => {
          removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
          dom.classList.remove('moving');
          if (!ghost) return;
          ext.options.onChange && ext.options.onChange();
          const gr = ghost.getBoundingClientRect();
          ghost.remove(); if (ind) ind.remove();
          const pos = getPos(); if (typeof pos !== 'number' || ev.type === 'pointercancel') return;
          const er = v.dom.getBoundingClientRect();
          let target, attrs = { ...cur.attrs };
          if (wrapped) {
            // anchor the picture to the line at its new top edge; keep the exact offset from that line
            const y = Math.min(Math.max(gr.top + 2, er.top + 1), er.bottom - 2);
            const hit = v.posAtCoords({ left: er.left + 2, top: y });
            if (!hit) return;
            target = hit.pos;
            const $t = v.state.doc.resolve(target);
            if (!$t.parent.isTextblock) return;
            if (target > pos && target <= pos + cur.nodeSize) target = pos;      // dropped on its own line start
            const c = v.coordsAtPos(target);
            const lineTop = c.top;
            const colW = er.width / scale, w = gr.width / scale;
            const leftX = (gr.left - er.left) / scale;
            const toLeft = leftX + w / 2 < colW / 2;
            attrs.wrap = toLeft ? 'wl' : 'wr';
            attrs.dx = Math.round(Math.max(0, Math.min(colW - w, toLeft ? leftX : colW - leftX - w)));
            attrs.dy = Math.round(Math.max(0, (gr.top - lineTop) / scale));
          } else {
            const hit = v.posAtCoords({ left: ev.clientX, top: ev.clientY });
            if (!hit) return;
            target = hit.pos;
            if (target >= pos && target <= pos + cur.nodeSize) return;
          }
          const tr = v.state.tr;
          const newNode = cur.type.create(attrs);
          tr.delete(pos, pos + cur.nodeSize);
          const at = tr.mapping.map(target);
          tr.insert(at, newNode);
          tr.setSelection(NodeSelection.create(tr.doc, at));
          v.dispatch(tr);
          if (!v.hasFocus()) v.dom.focus({ preventScroll: true });
        };
        addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
      };

      dom.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const p = getPos();
        if (typeof p === 'number' && !selected) view().dispatch(view().state.tr.setSelection(NodeSelection.create(view().state.doc, p)));
        if (!view().hasFocus()) view().dom.focus({ preventScroll: true });
        move(e);
      });
      // used by the selection frame (drawn outside the text so it can never move anything)
      dom._kv = {
        img, move, resize, node: () => cur,
        setWrap: w => { setAttrs({ wrap: w, dx: 0, dy: 0 }); reselect(); },
        remove: () => { const pos = getPos(); if (typeof pos === 'number') view().dispatch(view().state.tr.delete(pos, pos + cur.nodeSize)); }
      };
      return {
        dom,
        update(n) { if (n.type !== cur.type) return false; cur = n; paint(); return true; },
        selectNode() { selected = true; dom.classList.add('ProseMirror-selectednode'); },
        deselectNode() { selected = false; dom.classList.remove('ProseMirror-selectednode'); },
        stopEvent: e => e.type.startsWith('pointer') || e.type.startsWith('mouse') || e.type.startsWith('drag'),
        ignoreMutation: () => true
      };
    };
  },
  addCommands() {
    return { insertImage: attrs => ({ commands }) => commands.insertContent({ type: this.name, attrs }) };
  }
});

/* ------------------------------------------------------------------ */
/* From Matekos Prezi: hanging indent in lists, letter spacing, caps   */
/* ------------------------------------------------------------------ */
/** Hanging indent inside lists: the whole paragraph moves right, the list symbol stays (more space after it). */
export const ListHang = Extension.create({
  name: 'listHang',
  addGlobalAttributes() {
    return [{ types: ['paragraph'], attributes: { hang: {
      default: null,
      parseHTML: el => { const v = parseFloat(el.getAttribute('data-hang')); return isFinite(v) ? v : null; },
      renderHTML: a => a.hang ? { 'data-hang': a.hang, style: `--hang:${a.hang}cm;padding-left:${a.hang}cm` } : {}
    } } }];
  }
});
/** Letter spacing as a text style: <span style="letter-spacing:…">. */
export const LetterSpacing = Extension.create({
  name: 'letterSpacing',
  addGlobalAttributes() {
    return [{ types: ['textStyle'], attributes: { letterSpacing: {
      default: null,
      parseHTML: el => el.style.letterSpacing || null,
      renderHTML: a => a.letterSpacing ? { style: `letter-spacing:${a.letterSpacing}` } : {}
    } } }];
  },
  addCommands() {
    return {
      setLetterSpacing: v => ({ chain }) => chain().setMark('textStyle', { letterSpacing: v }).run(),
      unsetLetterSpacing: () => ({ chain }) => chain().setMark('textStyle', { letterSpacing: null }).removeEmptyTextStyle().run()
    };
  }
});
/** All caps (only the look – the letters stay as typed). */
export const TextCase = Extension.create({
  name: 'textCase',
  addGlobalAttributes() {
    return [{ types: ['textStyle'], attributes: { textTransform: {
      default: null,
      parseHTML: el => el.style.textTransform === 'uppercase' ? 'uppercase' : null,
      renderHTML: a => a.textTransform ? { style: `text-transform:${a.textTransform}` } : {}
    } } }];
  },
  addCommands() {
    return {
      setUppercase: () => ({ chain }) => chain().setMark('textStyle', { textTransform: 'uppercase' }).run(),
      unsetUppercase: () => ({ chain }) => chain().setMark('textStyle', { textTransform: null }).removeEmptyTextStyle().run()
    };
  }
});

/* ------------------------------------------------------------------ */
/* Tabulators: a tab character jumps to the next tab stop              */
/* ------------------------------------------------------------------ */
export const TabNode = Node.create({
  name: 'tab',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  parseHTML() { return [{ tag: 'span.tab' }]; },
  renderHTML() { return ['span', { class: 'tab' }]; },
  renderText() { return '\t'; },
  // the width is set by the tab layout; the editor must not treat that as a change of the text
  addNodeView() { return () => { const dom = document.createElement('span'); dom.className = 'tab'; dom.contentEditable = 'false'; return { dom, ignoreMutation: () => true }; }; },
  addProseMirrorPlugins() {
    const opts = this.options;
    return [new Plugin({ view: () => ({ update: (view, prev) => {
      if (view.state.doc === prev.doc || !view.dom.querySelector('span.tab')) return;
      layoutTabs(view.dom, opts.getScale ? opts.getScale() : 1);
    } }) })];
  },
  addOptions() { return { getScale: () => 1 }; },
  addKeyboardShortcuts() {
    return {
      // lists and tables keep their own Tab behaviour (they run first); anywhere else Tab inserts a tab
      Tab: () => this.editor.isActive('table') ? false : this.editor.commands.insertContent({ type: 'tab' })
    };
  }
});
