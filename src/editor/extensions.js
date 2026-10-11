import { Extension, Node, Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { BulletList, OrderedList } from '@tiptap/extension-list';
import { Table, TableRow, TableCell, TableHeader, TableView } from '@tiptap/extension-table';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { renderInto, isReady, mathReady } from '../math.js';

const numOrNull = v => (v === '' || v === null || v === undefined || isNaN(+v)) ? null : +v;

/* ------------------------------------------------------------------ */
/* Paragraph formatting: spacing, indents, line height, line shading   */
/* ------------------------------------------------------------------ */
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
        }
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
      numStyle: { default: 'decimal', parseHTML: el => el.getAttribute('data-num') || el.style.listStyleType || 'decimal', renderHTML: a => ({ 'data-num': a.numStyle }) }
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
/** Real (measurable, printable) list markers, rendered as widgets at the start of each item's first line. */
export const ListMarkers = Extension.create({
  name: 'listMarkers',
  addProseMirrorPlugins() {
    const build = doc => {
      const decos = [];
      const walk = (node, pos, depth) => {
        node.forEach((child, off) => {
          const cpos = pos + off + 1;
          if (child.type.name === 'bulletList' || child.type.name === 'orderedList') {
            const ordered = child.type.name === 'orderedList';
            const start = ordered ? (child.attrs.start || 1) : 1;
            child.forEach((item, ioff, idx) => {
              const ipos = cpos + 1 + ioff;          // position of listItem
              const first = item.firstChild;
              if (first && first.isTextblock) {
                const key = ordered ? 'o' + ordinal(start + idx, child.attrs.numStyle)
                  : child.attrs.bulletImage ? 'i' + child.attrs.bulletSize + child.attrs.bulletImage.length + child.attrs.bulletImage.slice(-24)
                    : 'b' + (child.attrs.bulletChar || DEFAULT_BULLETS[depth % 3]);
                decos.push(Decoration.widget(ipos + 2, () => {
                  const s = document.createElement('span');
                  s.className = 'lm';
                  s.contentEditable = 'false';
                  if (ordered) s.textContent = ordinal(start + idx, child.attrs.numStyle);
                  else if (child.attrs.bulletImage) {
                    const im = document.createElement('img');
                    im.src = child.attrs.bulletImage; im.alt = '';
                    im.style.height = (child.attrs.bulletSize || 0.9) + 'em';
                    s.appendChild(im);
                  } else s.textContent = child.attrs.bulletChar || DEFAULT_BULLETS[depth % 3];
                  return s;
                }, { side: -1, key, ignoreSelection: true }));
              }
              walk(item, ipos, depth + 1);
            });
          } else if (!child.isTextblock && child.childCount) walk(child, cpos, depth);
        });
      };
      walk(doc, -1, 0);
      return DecorationSet.create(doc, decos);
    };
    return [new Plugin({
      key: new PluginKey('listMarkers'),
      state: {
        init: (_, state) => build(state.doc),
        apply: (tr, old, _o, state) => tr.docChanged ? build(state.doc) : old
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
  }
}
export const KvTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null, parseHTML: el => numOrNull(el.getAttribute('data-width')), renderHTML: a => a.width ? { 'data-width': a.width, style: `width:${a.width}%` } : {} }
    };
  }
}).configure({ View: KvTableView, resizable: true, cellMinWidth: 24, lastColumnResizable: false });
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
      display: { default: false, parseHTML: el => el.getAttribute('data-display') === '1' || el.classList.contains('disp') }
    };
  },
  parseHTML() { return [{ tag: 'span[data-tex]' }]; },
  renderHTML({ node }) {
    return ['span', { class: 'math' + (node.attrs.display ? ' disp' : ''), 'data-tex': node.attrs.tex, 'data-display': node.attrs.display ? '1' : '0' }];
  },
  renderText({ node }) { return node.attrs.display ? `$$${node.attrs.tex}$$` : `$${node.attrs.tex}$`; },
  addNodeView() {
    const ext = this;
    return ({ node, getPos, editor }) => {
      let cur = node;
      const dom = document.createElement('span');
      dom.contentEditable = 'false';
      const paint = () => {
        dom.className = 'math' + (cur.attrs.display ? ' disp' : '') + (dom._sel ? ' ProseMirror-selectednode' : '');
        dom.setAttribute('data-tex', cur.attrs.tex);
        renderInto(dom, cur.attrs.tex, cur.attrs.display, () => ext.options.onRendered && ext.options.onRendered());
      };
      paint();
      // Mouse: click = select the formula; click on its left/right edge = cursor before/after it;
      // press and drag = select text (or table cells) starting at the formula; double click = edit.
      dom.addEventListener('mousedown', e => {
        if (e.button !== 0 || e.detail > 1) return;
        e.preventDefault();
        const view = editor.view, pos = getPos();
        if (typeof pos !== 'number') return;
        view.focus();
        const r = dom.getBoundingClientRect();
        const edge = Math.max(3, Math.min(r.width * 0.22, 9));
        const zone = e.clientX < r.left + edge ? 'before' : e.clientX > r.right - edge ? 'after' : 'node';
        const anchor = e.clientX < r.left + r.width / 2 ? pos : pos + cur.nodeSize;
        if (e.shiftKey) {
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.anchor, zone === 'before' ? pos : pos + cur.nodeSize)));
          return;
        }
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
        const up = () => {
          removeEventListener('mousemove', mv); removeEventListener('mouseup', up);
          if (moved) return;
          const doc = view.state.doc, p = getPos();
          if (typeof p !== 'number') return;
          if (zone === 'node') view.dispatch(view.state.tr.setSelection(NodeSelection.create(doc, p)));
          else view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, zone === 'before' ? p : p + cur.nodeSize)));
        };
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
          const changed = n.attrs.tex !== cur.attrs.tex || n.attrs.display !== cur.attrs.display;
          cur = n;
          if (changed) paint();
          return true;
        },
        selectNode() { dom._sel = true; dom.classList.add('ProseMirror-selectednode'); },
        deselectNode() { dom._sel = false; dom.classList.remove('ProseMirror-selectednode'); },
        ignoreMutation: () => true,
        stopEvent: e => e.type === 'mousedown' || e.type === 'dblclick' || e.type === 'dragstart'
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
        const tr = state.tr;
        for (const h of hits.reverse()) tr.replaceWith(h.from, h.to, type.create({ tex: h.tex, display: h.display }, null, h.marks));
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
          const tr = view.state.tr.replaceWith(start, to, type.create({ tex, display }));
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
          // a clearly visible text cursor right before / after a formula
          if (nearMath(state)) decos.push(Decoration.widget(sel.from, () => { const c = document.createElement('span'); c.className = 'fcaret no-print'; return c; }, { side: 0, key: 'fc' + sel.from, ignoreSelection: true }));
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
  addOptions() { return { getScale: () => 1, icons: {} }; },
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
      for (const h of ['nw', 'ne', 'sw', 'se']) { const i = document.createElement('i'); i.className = 'ih no-print ' + h; i.dataset.h = h; dom.appendChild(i); }
      const bar = document.createElement('span');
      bar.className = 'ibar no-print';
      const I = ext.options.icons;
      bar.innerHTML = `<button class="tb" data-wrap="wl" title="Text wraps – drag the picture anywhere">${I.wrapL || 'L'}</button>`
        + `<button class="tb" data-wrap="wr" title="Text wraps, picture on the right">${I.wrapR || 'R'}</button>`
        + `<button class="tb" data-wrap="ctr" title="Own line, centered">${I.center || 'C'}</button>`
        + `<button class="tb" data-wrap="inl" title="In line with text">${I.inline || 'I'}</button><span class="sep"></span>`
        + `<button class="tb" data-act="del" title="Delete picture">${I.trash || '×'}</button>`;
      dom.appendChild(bar);
      const size = document.createElement('span'); size.className = 'isize no-print'; dom.appendChild(size);
      const paint = () => {
        dom.className = 'imgw ' + (cur.attrs.wrap || 'wl') + (selected ? ' ProseMirror-selectednode' : '');
        if (img.getAttribute('src') !== cur.attrs.src) img.src = cur.attrs.src;
        img.alt = cur.attrs.alt || '';
        dom.style.cssText = imgStyle(cur.attrs);
        for (const b of bar.querySelectorAll('[data-wrap]')) b.classList.toggle('on', b.dataset.wrap === cur.attrs.wrap);
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
      bar.addEventListener('mousedown', e => e.preventDefault());
      bar.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.wrap) { setAttrs({ wrap: b.dataset.wrap, dx: 0, dy: 0 }); reselect(); }
        else if (b.dataset.act === 'del') { const pos = getPos(); if (typeof pos === 'number') view().dispatch(view().state.tr.delete(pos, pos + cur.nodeSize)); }
      });

      // corner handles: resize (keeps proportions)
      const resize = (e, h) => {
        const scale = ext.options.getScale() || 1;
        const sx = e.clientX, startW = dom.getBoundingClientRect().width / scale, sign = h.includes('e') ? 1 : -1;
        const maxW = view().dom.clientWidth;
        let w = startW;
        const mv = ev => {
          w = Math.max(16, Math.min(maxW, startW + sign * (ev.clientX - sx) / scale));
          dom.style.width = Math.round(w) + 'px';
          size.textContent = Math.round(w / (96 / 25.4)) + ' mm';
        };
        const up = () => {
          removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
          size.textContent = '';
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
          v.focus();
        };
        addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
      };

      dom.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        if (e.target.closest('.ibar')) return;
        e.preventDefault(); e.stopPropagation();
        const p = getPos();
        if (typeof p === 'number' && !selected) view().dispatch(view().state.tr.setSelection(NodeSelection.create(view().state.doc, p)));
        view().focus();
        const h = e.target.dataset && e.target.dataset.h;
        if (h) resize(e, h); else move(e);
      });
      return {
        dom,
        update(n) { if (n.type !== cur.type) return false; cur = n; paint(); return true; },
        selectNode() { selected = true; dom.classList.add('ProseMirror-selectednode'); },
        deselectNode() { selected = false; dom.classList.remove('ProseMirror-selectednode'); },
        stopEvent: e => e.type.startsWith('pointer') || e.type.startsWith('mouse') || e.type.startsWith('drag') || !!(e.target.closest && e.target.closest('.ibar,.ih')),
        ignoreMutation: () => true
      };
    };
  },
  addCommands() {
    return { insertImage: attrs => ({ commands }) => commands.insertContent({ type: this.name, attrs }) };
  }
});
