import { Extension, Node, Mark, mergeAttributes, wrappingInputRule, InputRule } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
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
        // no space between this paragraph and its neighbours of the same style (and between list items):
        // null = as the style says, true / false = set on this paragraph
        ctx: {
          default: null,
          parseHTML: el => el.getAttribute('data-ctx') === '1' ? true : el.getAttribute('data-ctx') === '0' ? false : null,
          renderHTML: a => a.ctx === true ? { 'data-ctx': '1' } : a.ctx === false ? { 'data-ctx': '0' } : {}
        },
        // null = as the paragraph style says (titles: kept with the next paragraph); true / false = set here
        keepNext: {
          default: null,
          parseHTML: el => el.getAttribute('data-kn') === '1' ? true : el.getAttribute('data-kn') === '0' ? false : null,
          renderHTML: a => a.keepNext === true ? { 'data-kn': '1' } : a.keepNext === false ? { 'data-kn': '0' } : {}
        },
        // a line of the table of contents (its heading's level): written and refreshed by the app
        toc: { default: null, parseHTML: el => numOrNull(el.getAttribute('data-toc')), renderHTML: a => a.toc ? { 'data-toc': a.toc } : {} },
        // the heading text the line was made from (refreshing keeps the line's own text and look while it matches)
        tocSrc: { default: null, parseHTML: el => el.getAttribute('data-tocsrc') || null, renderHTML: a => a.tocSrc ? { 'data-tocsrc': a.tocSrc } : {} },
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
        for (const r of state.selection.ranges) state.doc.nodesBetween(r.$from.pos, r.$to.pos, (node, pos) => {
          if (node.type.name === 'paragraph' || node.type.name === 'heading') tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
        });
        if (dispatch) dispatch(tr);
        return true;
      },
      shiftIndent: delta => ({ tr, state, dispatch }) => {
        for (const r of state.selection.ranges) state.doc.nodesBetween(r.$from.pos, r.$to.pos, (node, pos) => {
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
  // typing "- " at the start of a line starts a list; "+ " and "* " do not (they are ordinary signs in maths)
  addInputRules() { return [wrappingInputRule({ find: /^\s*(-)\s$/, type: this.type })]; },
  addAttributes() {
    return {
      ...this.parent?.(),
      bulletChar: { default: '', parseHTML: el => el.getAttribute('data-bullet') || legacyBullet(el) || '', renderHTML: a => a.bulletChar ? { 'data-bullet': a.bulletChar } : {} },
      bulletImage: { default: '', parseHTML: el => el.getAttribute('data-bullet-img') || '', renderHTML: a => a.bulletImage ? { 'data-bullet-img': a.bulletImage } : {} },
      // hanging indent of the whole list (all levels): the text starts this far from its symbol, and an inner
      // list's symbol stands where the outer text starts – so the gaps are equal on every level
      gap: { default: null, parseHTML: el => numOrNull(el.getAttribute('data-gap')), renderHTML: a => a.gap ? { 'data-gap': a.gap, style: `--gap:${a.gap}cm` } : {} },
      bulletSize: { default: 0.9, parseHTML: el => numOrNull(el.getAttribute('data-bullet-size')) ?? 0.9, renderHTML: a => a.bulletImage ? { 'data-bullet-size': a.bulletSize } : {} }
    };
  }
});
/* Hyphenation: invisible "may break here" points (soft hyphens) inside words, shown as decorations – the document's
   text is never changed. The app adds them to the words that stand at the start of a line (src/main.js); a word that
   is edited loses its points and gets new ones when it is laid out again. */
export const hyphenKey = new PluginKey('hyphens');
const shyWidget = pos => Decoration.widget(pos, () => { const s = document.createElement('span'); s.className = 'shy'; s.textContent = '\u00AD'; return s; }, { side: -1, key: 'shy', ignoreSelection: true });
/** The whole word(s) around a changed range of a text block. */
function wordRange(doc, from, to) {
  const size = doc.content.size; from = Math.max(0, Math.min(from, size)); to = Math.max(from, Math.min(to, size));
  const $f = doc.resolve(from); if (!$f.parent.isTextblock) return [from, to];
  const start = $f.start(), text = $f.parent.textBetween(0, $f.parent.content.size, undefined, '\ufffc');
  let a = from - start, b = Math.min(text.length, to - start);
  while (a > 0 && /\p{L}/u.test(text[a - 1])) a--;
  while (b < text.length && /\p{L}/u.test(text[b])) b++;
  return [start + a, start + b];
}
export const Hyphens = Extension.create({
  name: 'hyphens',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: hyphenKey,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, set) {
          const m = tr.getMeta(hyphenKey);
          if (m && m.clear) return DecorationSet.empty;
          if (tr.docChanged) {
            set = set.map(tr.mapping, tr.doc);
            const drop = [];
            tr.mapping.maps.forEach((map, i) => map.forEach((os, oe, ns, ne) => {
              const rest = tr.mapping.slice(i + 1), [a, b] = wordRange(tr.doc, rest.map(ns, -1), rest.map(ne, 1));
              drop.push(...set.find(a, b));
            }));
            if (drop.length) set = set.remove(drop);
          }
          if (m && m.add) { const size = tr.doc.content.size; set = set.add(tr.doc, m.add.filter(p => p > 0 && p < size).map(shyWidget)); }
          return set;
        }
      },
      props: { decorations(st) { return hyphenKey.getState(st); } }
    })];
  }
});
/** Typing corrections: Hungarian quotation marks („ ”) for ", and a dash (–) for two hyphens. Never inside a formula
 *  that is being typed ($…), and Backspace right after a correction brings back what was typed. */
export const HunTyping = Extension.create({
  name: 'hunTyping',
  addInputRules() {
    const before = (state, pos) => { const $p = state.doc.resolve(pos); return $p.parent.textBetween(0, $p.parentOffset, undefined, '\ufffc'); };
    const inFormula = t => (t.split('$').length - 1) % 2 === 1;
    return [
      new InputRule({ find: /"$/, handler: ({ state, range }) => {
        const t = before(state, range.from); if (inFormula(t)) return null;
        state.tr.insertText(!t || /[\s(\[{„–—-]$/.test(t) ? '„' : '”', range.from, range.to);
      } }),
      new InputRule({ find: /--$/, handler: ({ state, range }) => {
        const t = before(state, range.from); if (inFormula(t) || /-$/.test(t)) return null;
        state.tr.insertText('–', range.from, range.to);
      } })
    ];
  }
});
export const KvOrderedList = OrderedList.extend({
  addInputRules() { return []; },
  addAttributes() {
    return {
      ...this.parent?.(),
      // hanging indent of the whole list (all levels): the text starts this far from its symbol, and an inner
      // list's symbol stands where the outer text starts – so the gaps are equal on every level
      gap: { default: null, parseHTML: el => numOrNull(el.getAttribute('data-gap')), renderHTML: a => a.gap ? { 'data-gap': a.gap, style: `--gap:${a.gap}cm` } : {} },
      numStyle: { default: null, parseHTML: el => el.getAttribute('data-num') || null, renderHTML: a => a.numStyle ? { 'data-num': a.numStyle } : {} },
      cont: { default: false, parseHTML: el => el.getAttribute('data-cont') === '1', renderHTML: a => a.cont ? { 'data-cont': '1' } : {} }
    };
  }
});

export function ordinal(n, style) {
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
export const listDefaults = { bullet: '•', num: 'decimal', img: null };   // img: the template's picture symbol (Matekos végtelen)
const bulletAt = depth => depth % 3 === 0 ? (listDefaults.img ? '•' : (listDefaults.bullet || '•')) : DEFAULT_BULLETS[depth % 3];
/** Real (measurable, printable) list markers, rendered as widgets at the start of each item's first line. */
export const ListMarkers = Extension.create({
  name: 'listMarkers',
  addProseMirrorPlugins() {
    const build = doc => {
      const decos = [];
      /** carry: markers of outer items whose first line is the first line of a nested list (same-line nesting) */
      const walk = (node, pos, depth, carry) => {
        const ends = {};                              // last number of the lists on this level, per numbering style
        node.forEach((child, off) => {
          const cpos = pos + off + 1;
          if (child.type.name === 'bulletList' || child.type.name === 'orderedList') {
            const ordered = child.type.name === 'orderedList';
            const sty = child.attrs.numStyle || listDefaults.num;
            const start = ordered ? (child.attrs.cont ? (ends[sty] ?? 0) + 1 : (child.attrs.start ?? 1)) : 1;
            if (ordered) { let n = 0; child.forEach(it => { if (!it.attrs.ghost) n++; }); ends[sty] = start + n - 1; }
            let real = -1;                           // holder items are not counted
            child.forEach((item, ioff) => {
              if (!item.attrs.ghost) real++;
              const idx = Math.max(0, real);
              const ipos = cpos + 1 + ioff;          // position of listItem
              const first = item.firstChild;
              const mk = {
                key: ordered ? 'o' + ordinal(start + idx, child.attrs.numStyle || listDefaults.num)
                  : child.attrs.bulletImage ? 'i' + child.attrs.bulletSize + child.attrs.bulletImage.length + child.attrs.bulletImage.slice(-24)
                    : 'b' + (child.attrs.bulletChar || bulletAt(depth)) + (!child.attrs.bulletChar && depth % 3 === 0 && listDefaults.img ? 'img' : ''),
                text: ordered ? ordinal(start + idx, child.attrs.numStyle || listDefaults.num) : (child.attrs.bulletImage || (!child.attrs.bulletChar && depth % 3 === 0 && listDefaults.img)) ? null : (child.attrs.bulletChar || bulletAt(depth)),
                img: !ordered && child.attrs.bulletImage ? child.attrs.bulletImage : (!ordered && !child.attrs.bulletChar && depth % 3 === 0 && listDefaults.img) || null,
                size: child.attrs.bulletImage ? (child.attrs.bulletSize || 0.9) : 0.7
              };
              const here = idx === 0 && carry ? carry : [];
              // all the text of the item's first line bold -> the symbol bold too
              let allBold = false;
              if (first && first.isTextblock && first.textContent.trim()) { allBold = true; first.descendants(c => { if (c.isText && c.text.trim() && !c.marks.some(m => m.type.name === 'bold')) allBold = false; }); }
              mk.bold = allBold;
              // the size and colour the item's text starts with (set on that text itself): the symbol takes them
              if (first && first.isTextblock) for (let k = 0; k < first.childCount; k++) {
                const c = first.child(k); if (c.isText && !c.text.trim()) continue;
                const ts = c.marks.find(m => m.type.name === 'textStyle');
                if (ts) { mk.fs = ts.attrs.fontSize || ''; mk.col = ts.attrs.color || ''; }
                break;
              }
              // an item that starts with an empty line and a list: the nested list's first item shares the line
              const sameLine = !!item.attrs.sameLine && first && first.isTextblock && !first.content.size && item.childCount > 1 && /List$/.test(item.child(1).type.name);
              if (sameLine) {
                decos.push(Decoration.node(ipos + 1, ipos + 1 + first.nodeSize, { class: 'lm-collapsed' }));
                walk(item, ipos, depth + 1, [...here.map(m => ({ ...m, up: m.up + 1 })), { ...mk, up: 1 }]);
                return;
              }
              if (item.attrs.ghost) { walk(item, ipos, depth + 1, null); return; }
              if (first && first.isTextblock) {
                for (const m of [{ ...mk, up: 0 }, ...here]) {
                  decos.push(Decoration.widget(ipos + 2, () => {
                    const s = document.createElement('span');
                    s.className = 'lm' + (m.up ? ' lm-up' : '') + (m.bold ? ' lm-b' : '');
                    if (m.up) s.style.setProperty('--up', m.up);
                    if (m.fs) s.style.fontSize = m.fs;
                    if (m.col) s.style.color = m.col;
                    s.contentEditable = 'false';
                    if (m.img) { const im = document.createElement('img'); im.src = m.img; im.alt = ''; im.style.height = m.size + 'em'; s.appendChild(im); }
                    else s.textContent = m.text;
                    return s;
                  }, { side: -1, key: m.key + '|' + m.up + (m.bold ? 'b' : '') + '|' + (m.fs || '') + '|' + (m.col || ''), ignoreSelection: true }));
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
cellAttrs.cmt = { default: null, parseHTML: el => el.getAttribute('data-cmt') || null, renderHTML: a => a.cmt ? { 'data-cmt': a.cmt } : {} };
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
    if (node.attrs.pin) {                  // free: the frame takes the width (share of the text width), the table fills it
      this.dom.style.width = (w || 60) + '%'; this.table.style.width = '100%';
    } else {
      this.dom.style.width = '';
      if (w && (!this.table.style.width || this.table.style.width.endsWith('%'))) this.table.style.width = w + '%';
      else if (!w && this.table.style.width.endsWith('%')) this.table.style.width = '';
    }
    placePinned(this.dom, node.attrs);
    // cell margins of the whole table (mm): inner space between the cell borders and the text
    if (node.attrs.padV != null) this.table.style.setProperty('--cpv', node.attrs.padV + 'mm'); else this.table.style.removeProperty('--cpv');
    if (node.attrs.padH != null) this.table.style.setProperty('--cph', node.attrs.padH + 'mm'); else this.table.style.removeProperty('--cph');
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
      ...PIN_ATTRS,
      padV: { default: null, parseHTML: el => numOrNull(el.getAttribute('data-padv')), renderHTML: a => a.padV != null ? { 'data-padv': a.padV, style: `--cpv:${a.padV}mm` } : {} },
      padH: { default: null, parseHTML: el => numOrNull(el.getAttribute('data-padh')), renderHTML: a => a.padH != null ? { 'data-padh': a.padH, style: `--cph:${a.padH}mm` } : {} },
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
/** The look a formula gets at a place in the text (element there): font of the text, bold. */
export function lookAtDom(el, bold = false) {
  if (!el) return { font: docMathFont === 'bonum' ? null : docMathFont, bold };
  const cs = getComputedStyle(el);
  let font = mathFontFromCSS(cs.fontFamily) || docMathFont;
  if (font === 'bonum') font = null;
  return { font, bold: bold || (parseInt(cs.fontWeight, 10) || 400) >= 600 };
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
        dom.className = 'math' + (cur.attrs.wrap || cur.attrs.display ? ' wrap' : '') + (dom._sel ? ' ProseMirror-selectednode' : '');
        dom.setAttribute('data-tex', cur.attrs.tex);
        const lk = lookOf(cur, dom); dom._lk = lk.font + '|' + lk.bold;
        renderInto(dom, cur.attrs.tex, false, () => ext.options.onRendered && ext.options.onRendered(), lk.bold, cur.attrs.wrap || cur.attrs.display, lk.font);
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
/* ------------------------------------------------------------------ */
/* Freely placed pictures and tables ("pinned"): drawn on their own   */
/* layer at a fixed place of a page (pg, px, py – from the top left   */
/* corner of the page's text area), independent of the text; the text */
/* wraps around them through invisible floats (see setPinSpacers).    */
/* ------------------------------------------------------------------ */
export const PIN_ATTRS = {
  pin: { default: false, parseHTML: el => el.getAttribute('data-pin') === '1', renderHTML: a => a.pin ? { 'data-pin': '1' } : {} },
  pg: { default: 0, parseHTML: el => +(el.getAttribute('data-pg') || 0), renderHTML: a => a.pin ? { 'data-pg': a.pg } : {} },
  px: { default: 0, parseHTML: el => +(el.getAttribute('data-px') || 0), renderHTML: a => a.pin ? { 'data-px': a.px } : {} },
  py: { default: 0, parseHTML: el => +(el.getAttribute('data-py') || 0), renderHTML: a => a.pin ? { 'data-py': a.py } : {} },
  // rel: placed relative to the paragraph it is anchored in (moves with the text, as in Word): px from the left margin,
  // py from the top of that paragraph
  rel: { default: false, parseHTML: el => el.getAttribute('data-rel') === '1', renderHTML: a => a.rel ? { 'data-rel': '1' } : {} }
};
let pinTopFn = null;                     // (page, py) -> top in the editor's own coordinates (set by the app)
export function setPinTop(fn) { pinTopFn = fn; }
export function placePinned(el, a, pinTop = pinTopFn) {
  pinTop = pinTop || pinTopFn;
  if (!a.pin) { if (el.classList.contains('pinned')) { el.classList.remove('pinned'); el.style.position = ''; el.style.left = ''; el.style.top = ''; } return; }
  el.classList.add('pinned');
  el.dataset.pg = a.pg; el.dataset.px = a.px; el.dataset.py = a.py;
  if (a.rel) el.dataset.rel = '1'; else delete el.dataset.rel;
  el.style.position = 'absolute';
  el.style.left = (a.px || 0) + 'px';
  el.style.top = (pinTop ? pinTop(a.pg || 0, a.py || 0) : (a.py || 0)) + 'px';
  // the app measures and corrects the exact place, and keeps the text clear of it
  requestAnimationFrame(() => el.isConnected && el.dispatchEvent(new CustomEvent('kv-pin', { bubbles: true })));
}
/** The table the cursor is in gets a class: its invisible borders show as dashed lines while working in it. */
export const ActiveTable = Extension.create({
  name: 'activeTable',
  addProseMirrorPlugins() {
    return [new Plugin({ props: { decorations(state) {
      const $f = state.selection.$from;
      for (let d = $f.depth; d > 0; d--) if ($f.node(d).type.name === 'table') return DecorationSet.create(state.doc, [Decoration.node($f.before(d), $f.after(d), { class: 'tbl-active' })]);
      return null;
    } } })];
  }
});
export const pinKey = new PluginKey('pins');
export const Pins = Extension.create({
  name: 'pins',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: pinKey,
      state: { init: () => DecorationSet.empty, apply(tr, old) { const m = tr.getMeta(pinKey); if (m) return m; return old.map(tr.mapping, tr.doc); } },
      props: { decorations(st) { return pinKey.getState(st); } }
    })];
  }
});
/** specs: [{pos, side: 'left'|'right', w, h, dy, key}] -> invisible floats that keep the text clear */
export function setPinSpacers(view, specs) {
  const decos = specs.map(sp => Decoration.widget(sp.pos, () => {
    const d = document.createElement('span');
    d.className = 'pin-sp'; d.contentEditable = 'false';
    d.style.cssText = `float:${sp.side};clear:${sp.side};width:${sp.w}px;height:${sp.h}px;margin-top:${sp.dy}px;`;   // never beside another one
    return d;
  }, { side: sp.after ? 0 : -2, key: sp.key, ignoreSelection: true }));   // before / after a page-break spacer at the same place
  // paragraphs whose first line is beside a free object: no first-line / hanging indent (the text starts at the object's margin)
  for (const sp of specs) if (sp.flat != null) { const n = view.state.doc.nodeAt(sp.flat); if (n && n.isTextblock) decos.push(Decoration.node(sp.flat, sp.flat + n.nodeSize, { class: 'wrap-flat' })); }
  view.dispatch(view.state.tr.setMeta(pinKey, DecorationSet.create(view.state.doc, decos)).setMeta('addToHistory', false));
}

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
  addOptions() { return { getScale: () => 1, onChange: null, pageBox: null, pinTop: null, anchorAt: null }; },
  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: '' },
      width: { default: null, parseHTML: el => numOrNull(el.getAttribute('data-w')) || parseFloat(el.style.width) || numOrNull(el.getAttribute('width')) },
      wrap: { default: 'wl', parseHTML: el => el.getAttribute('data-wrap') || WRAPS.find(w => el.classList.contains(w)) || 'wl' },
      dx: { default: 0, parseHTML: el => numOrNull(el.getAttribute('data-dx')) || 0 },
      dy: { default: 0, parseHTML: el => numOrNull(el.getAttribute('data-dy')) || 0 },
      cmt: { default: null },                // id of a comment attached to the picture
      crop: { default: null, parseHTML: el => { try { return el.getAttribute('data-crop') ? JSON.parse(el.getAttribute('data-crop')) : null; } catch (e) { return null; } } },   // {l, t, r, b}: the parts cut off, as fractions
      opacity: { default: 1, parseHTML: el => el.hasAttribute('data-op') ? +el.getAttribute('data-op') : 1 },
      radius: { default: 0, parseHTML: el => +(el.getAttribute('data-rad') || 0) },                // corner rounding, % of the smaller side
      // captions: a line of text above and / or below the picture, centred to it; they move with the picture
      capTop: { default: '', parseHTML: el => el.getAttribute('data-cap-top') || '' },
      capBot: { default: '', parseHTML: el => el.getAttribute('data-cap-bot') || '' },
      ...PIN_ATTRS
    };
  },
  parseHTML() { return [{ tag: 'img[src]' }]; },
  renderHTML({ node }) {
    const a = node.attrs;
    return ['img', { src: a.src, alt: a.alt || '', 'data-wrap': a.wrap, 'data-dx': a.dx || 0, 'data-dy': a.dy || 0, ...(a.pin ? { 'data-pin': '1', 'data-pg': a.pg, 'data-px': a.px, 'data-py': a.py, ...(a.rel ? { 'data-rel': '1' } : {}) } : {}), ...(a.crop ? { 'data-crop': JSON.stringify(a.crop) } : {}), ...(a.opacity != null && a.opacity < 1 ? { 'data-op': a.opacity } : {}), ...(a.radius ? { 'data-rad': a.radius } : {}), ...(a.width ? { 'data-w': a.width } : {}), ...(a.capTop ? { 'data-cap-top': a.capTop } : {}), ...(a.capBot ? { 'data-cap-bot': a.capBot } : {}), class: a.wrap, style: imgStyle(a) || null }];
  },
  addNodeView() {
    const ext = this;
    return ({ node, getPos, editor }) => {
      let cur = node, selected = false;
      const dom = document.createElement('span');
      dom.draggable = false;
      const img = document.createElement('img');
      img.draggable = false;
      // the picture sits in its own clipping box (cropping, rounded corners), so the captions outside it stay visible
      const clip = document.createElement('span'); clip.className = 'imgclip';
      clip.appendChild(img); dom.appendChild(clip);
      const capT = document.createElement('span'), capB = document.createElement('span');
      capT.className = 'icap top'; capB.className = 'icap bot'; capT.hidden = capB.hidden = true;
      dom.append(capT, capB);
      // the captions hang outside the picture's box; the room they need is kept free around it (--capT / --capB)
      let capH = '0|0';
      const fitCaps = () => {
        const t = capT.hidden ? 0 : capT.offsetHeight, b = capB.hidden ? 0 : capB.offsetHeight;
        dom.style.setProperty('--capT', t + 'px'); dom.style.setProperty('--capB', b + 'px');
        dom.dataset.capT = t; dom.dataset.capB = b;
        if (capH !== t + '|' + b) { capH = t + '|' + b; ext.options.onChange && ext.options.onChange(); try { editor.view.dom.dispatchEvent(new CustomEvent('kv-relayout', { bubbles: true })); } catch (e) { /* the view is not ready yet */ } }
      };
      const capWatch = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => fitCaps()) : null;
      if (capWatch) { capWatch.observe(capT); capWatch.observe(capB); }
      // cropping: the frame (dom) shows only a part of the picture; the picture inside is larger and shifted
      const applyCrop = (c = cur.attrs.crop, w = cur.attrs.width) => {
        img.style.opacity = cur.attrs.opacity != null && cur.attrs.opacity < 1 ? cur.attrs.opacity : '';
        // corner rounding: a share of the shorter side (the same in the PDF)
        if (cur.attrs.radius && w && img.naturalWidth) {
          const cc = c || { l: 0, t: 0, r: 0, b: 0 }, fw0 = w / Math.max(0.05, 1 - cc.l - cc.r), h0 = fw0 * img.naturalHeight / img.naturalWidth * Math.max(0.05, 1 - cc.t - cc.b);
          dom.style.borderRadius = Math.min(w, h0) * cur.attrs.radius / 100 + 'px';
        } else dom.style.borderRadius = cur.attrs.radius ? cur.attrs.radius + '%' : '';
        dom.dataset.rad = cur.attrs.radius || 0;
        dom.classList.toggle('rounded', !!cur.attrs.radius);
        if (!c || !w || !img.naturalWidth) { dom.classList.remove('cropped'); img.style.width = ''; img.style.maxWidth = ''; img.style.marginLeft = ''; img.style.marginTop = ''; if (!c) dom.style.height = ''; return; }
        const fw = w / Math.max(0.05, 1 - c.l - c.r), fh = fw * img.naturalHeight / img.naturalWidth;
        dom.classList.add('cropped');
        img.style.width = fw + 'px'; img.style.maxWidth = 'none';
        img.style.marginLeft = -c.l * fw + 'px'; img.style.marginTop = -c.t * fh + 'px';
        dom.style.height = fh * Math.max(0.05, 1 - c.t - c.b) + 'px';
      };
      const paint = () => {
        dom.className = 'imgw ' + (cur.attrs.pin ? 'pinned' + (cur.attrs.wrap === 'over' ? ' over' : cur.attrs.wrap === 'under' ? ' under' : '') : (cur.attrs.wrap || 'wl')) + (selected ? ' ProseMirror-selectednode' : '');
        if (cur.attrs.cmt) dom.dataset.cmt = cur.attrs.cmt; else delete dom.dataset.cmt;
        if (img.getAttribute('src') !== cur.attrs.src) img.src = cur.attrs.src;
        img.alt = cur.attrs.alt || '';
        dom.style.cssText = cur.attrs.pin ? (cur.attrs.width ? `width:${cur.attrs.width}px` : '') : imgStyle(cur.attrs);
        capT.textContent = cur.attrs.capTop || ''; capT.hidden = !cur.attrs.capTop;
        capB.textContent = cur.attrs.capBot || ''; capB.hidden = !cur.attrs.capBot;
        fitCaps();
        applyCrop();
        placePinned(dom, cur.attrs);
        ext.options.onChange && ext.options.onChange();
      };
      paint();
      const view = () => editor.view;
      img.addEventListener('load', () => { if (cur.attrs.crop || cur.attrs.radius) { applyCrop(); ext.options.onChange && ext.options.onChange(); } });
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
      // corner handles: resize (keeps proportions); the opposite corner stays where it is, and a free picture
      // never grows beyond the page margins
      const resize = (e, h, size) => {
        const scale = ext.options.getScale() || 1;
        const r0 = dom.getBoundingClientRect(), sx = e.clientX, startW = r0.width / scale, ratio = r0.height / (r0.width || 1);
        const east = h.includes('e'), south = h.includes('s'), sign = east ? 1 : -1;
        const pinned = !!cur.attrs.pin && ext.options.pageBox;
        const bx = pinned ? ext.options.pageBox(r0.top + 1) : null;
        // room towards the dragged corner (from the fixed corner to the margin)
        let maxW = view().dom.clientWidth;
        if (bx) {
          const roomX = (east ? bx.right - r0.left : r0.right - bx.left) / scale;
          const roomY = (south ? bx.bottom - r0.top : r0.bottom - bx.top) / scale / (ratio || 1);
          maxW = Math.max(16, Math.floor(Math.min(roomX, roomY)));
        }
        const fixL = r0.left, fixR = r0.right, fixT = r0.top, fixB = r0.bottom;
        let w = startW;
        const mv = ev => {
          w = Math.max(16, Math.min(maxW, startW + sign * (ev.clientX - sx) / scale)); if (bx) w = Math.floor(w);
          dom.style.width = Math.round(w) + 'px';
          if (bx) {                           // keep the fixed corner in place while dragging
            const hNew = w * ratio;
            const left = east ? fixL : fixR - w * scale, top = south ? fixT : fixB - hNew * scale;
            dom.style.left = (parseFloat(dom.style.left) || 0) + (left - dom.getBoundingClientRect().left) / scale + 'px';
            dom.style.top = (parseFloat(dom.style.top) || 0) + (top - dom.getBoundingClientRect().top) / scale + 'px';
          }
          if (size) size.textContent = Math.round(w / (96 / 25.4)) + ' mm';
          ext.options.onChange && ext.options.onChange();
        };
        const up = () => {
          removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
          if (size) size.textContent = '';
          if (bx) {
            const r = dom.getBoundingClientRect();
            // a picture that moves with its paragraph keeps its offset from that paragraph (not from the page)
            const host = cur.attrs.rel && dom.parentElement && dom.parentElement.closest('p,h1,h2,h3');
            const py = host ? (r.top - host.getBoundingClientRect().top) / scale : (r.top - bx.top) / scale;
            setAttrs({ width: Math.round(w), px: Math.round((r.left - bx.left) / scale * 10) / 10, py: Math.round(py * 10) / 10, pg: bx.page });
          } else setAttrs({ width: Math.round(w) });
          reselect();
        };
        addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
      };

      // body: click selects (nothing else changes); drag moves the picture freely
      const move = e => {
        const v = view(), scale = ext.options.getScale() || 1;
        const r0 = dom.getBoundingClientRect(), ox = e.clientX - r0.left, oy = e.clientY - r0.top;
        const sx = e.clientX, sy = e.clientY;
        let ghost = null, ind = null, last = { clientX: e.clientX, clientY: e.clientY };
        const wrapped = cur.attrs.pin || cur.attrs.wrap === 'wl' || cur.attrs.wrap === 'wr' || cur.attrs.wrap === 'over' || cur.attrs.wrap === 'under';
        // the system's own drag & drop must not take over while the picture is being moved (it would swallow the drop)
        const noNative = ev => ev.preventDefault();
        document.addEventListener('dragstart', noNative, true);
        try { if (e.target && e.target.setPointerCapture && e.pointerId != null) e.target.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
        const mv = ev => {
          last = { clientX: ev.clientX, clientY: ev.clientY };
          if (!ghost) {
            if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
            ghost = img.cloneNode(); ghost.className = 'img-ghost';
            ghost.style.width = r0.width + 'px'; ghost.style.height = r0.height + 'px';
            document.body.appendChild(ghost);
            if (!wrapped) { ind = document.createElement('div'); ind.className = 'drop-ind'; document.body.appendChild(ind); }
            dom.classList.add('moving');
            ext.options.onChange && ext.options.onChange('moving');
          }
          let gx = ev.clientX - ox, gy = ev.clientY - oy;
          if (wrapped && ext.options.pageBox) {
            const bx = ext.options.pageBox(ev.clientY);
            if (bx) { gx = Math.min(Math.max(gx, bx.left), bx.right - r0.width); gy = Math.min(Math.max(gy, bx.top), bx.bottom - r0.height); }
          }
          ghost.style.left = gx + 'px'; ghost.style.top = gy + 'px';
          if (ind) {
            const hit = v.posAtCoords({ left: ev.clientX, top: ev.clientY });
            if (hit) { const c = v.coordsAtPos(hit.pos); ind.style.left = c.left + 'px'; ind.style.top = c.top + 'px'; ind.style.height = (c.bottom - c.top) + 'px'; }
          }
          const ws = document.getElementById('ws');
          if (ws) { const wr = ws.getBoundingClientRect(); if (ev.clientY < wr.top + 40) ws.scrollTop -= 14; else if (ev.clientY > wr.bottom - 40) ws.scrollTop += 14; }
        };
        const up = ev0 => {
          removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
          document.removeEventListener('dragstart', noNative, true);
          dom.classList.remove('moving');
          if (!ghost) return;
          // a cancelled pointer (e.g. the system started a drag anyway): place it where the mouse last was
          const ev = ev0.type === 'pointercancel' ? { ...last, type: 'pointerup' } : ev0;
          if (ev0.type === 'pointercancel') mv(last);
          ext.options.onChange && ext.options.onChange();
          const gr = ghost.getBoundingClientRect();
          ghost.remove(); if (ind) ind.remove();
          const pos = getPos(); if (typeof pos !== 'number' || ev.type === 'pointercancel') return;
          if (wrapped && ext.options.pageBox) {
            const bx = ext.options.pageBox(gr.top + 1);
            if (bx) {
              const sc = ext.options.getScale() || 1;
              const px = Math.round((gr.left - bx.left) / sc * 10) / 10;
              const anchor = ext.options.anchorAt ? ext.options.anchorAt(gr.top + 1, dom) : null;
              let trp;
              if (anchor) {                       // into the paragraph at that height: it moves with the text from now on
                const nn = cur.type.create({ ...cur.attrs, pin: true, rel: true, pg: bx.page, px, py: Math.round((gr.top - anchor.top) / sc * 10) / 10 });
                trp = v.state.tr.delete(pos, pos + cur.nodeSize);
                const at = trp.mapping.map(anchor.pos);
                trp.insert(at, nn); trp.setSelection(NodeSelection.create(trp.doc, at));
              } else {
                trp = v.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, pin: true, rel: false, pg: bx.page, px, py: Math.round((gr.top - bx.top) / sc * 10) / 10 });
                trp.setSelection(NodeSelection.create(trp.doc, pos));
              }
              v.dispatch(trp);
              if (!v.hasFocus()) v.dom.focus({ preventScroll: true });
              return;
            }
          }
          const er = v.dom.getBoundingClientRect();
          let target, attrs = { ...cur.attrs };
          if (wrapped) {
            // anchor the picture to the start of the line at its new top edge (found with the picture itself taken out
            // of the layout, so it cannot get in the way), and keep the exact offset from that line and the margin
            const oldDisplay = dom.style.display;
            dom.style.display = 'none';
            void v.dom.offsetHeight;
            const er2 = v.dom.getBoundingClientRect();
            const y = Math.min(Math.max(gr.top + 1, er2.top + 1), er2.bottom - 2);
            // a text line outside tables at that height, or the nearest one above it (over a table, a display formula…)
            const okAt = h => { if (!h) return false; const $h = v.state.doc.resolve(h.pos); if (!$h.parent.isTextblock) return false; for (let d = $h.depth; d > 0; d--) if ($h.node(d).type.spec.tableRole) return false; return true; };
            let hit = null;
            for (let yy = y; yy > er2.top - 1 && !hit; yy -= 6) { const h = v.posAtCoords({ left: er2.left + 3, top: yy }); if (okAt(h)) hit = h; }
            let lineTop = null;
            if (hit) { target = hit.pos; try { lineTop = v.coordsAtPos(target, 1).top; } catch (err) { lineTop = null; } }
            dom.style.display = oldDisplay;
            if (!hit || lineTop == null || !v.state.doc.resolve(target).parent.isTextblock) return;
            if (target > pos && target <= pos + cur.nodeSize) target = pos;      // its own place
            const colW = er.width / scale, w = gr.width / scale;
            const leftX = (gr.left - er.left) / scale;
            const toLeft = leftX + w / 2 < colW / 2;
            attrs.wrap = toLeft ? 'wl' : 'wr';
            attrs.dx = Math.round(Math.max(0, Math.min(colW - w, toLeft ? leftX : colW - leftX - w)));
            // the picture's top edge = line top + .2em (its margin) + dy
            const em = parseFloat(getComputedStyle(dom.parentElement || v.dom).fontSize) || 16;
            attrs.dy = Math.round(Math.max(0, (gr.top - lineTop) / scale - 0.2 * em));
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
          if (wrapped) {
            // measure where it really is and correct the offsets until it sits exactly where it was released
            const want = { left: gr.left, top: gr.top };
            let curPos = at;                                    // the moved picture is a new node with a new view
            const fix = tries => {
              const p = curPos;
              const n = v.state.doc.nodeAt(p); if (!n || n.type.name !== 'image') return;
              const nd = v.nodeDOM(p); if (!nd || !nd.isConnected) return;
              const r = nd.getBoundingClientRect(), sc = ext.options.getScale() || 1;
              const dyErr = (want.top - r.top) / sc, dxErr = (n.attrs.wrap === 'wl' ? want.left - r.left : r.left - want.left) / sc;
              const a2 = { ...n.attrs };
              if (Math.abs(dxErr) > 0.5) a2.dx = Math.max(0, Math.round((n.attrs.dx || 0) + dxErr));
              if (Math.abs(dyErr) > 0.5) {
                const ndy = (n.attrs.dy || 0) + dyErr;
                if (ndy >= 0) a2.dy = Math.round(ndy);
                else {                                          // its line starts below the wanted place: one line earlier
                  const hit = v.posAtCoords({ left: v.dom.getBoundingClientRect().left + 3, top: want.top - 2 });
                  if (hit && hit.pos < p && v.state.doc.resolve(hit.pos).parent.isTextblock && tries > 0) {
                    const t2 = v.state.tr.delete(p, p + n.nodeSize), at2 = t2.mapping.map(hit.pos);
                    t2.insert(at2, n.type.create({ ...a2, dy: 0 })); t2.setSelection(NodeSelection.create(t2.doc, at2)); t2.setMeta('addToHistory', false);
                    v.dispatch(t2); curPos = at2; requestAnimationFrame(() => fix(tries - 1)); return;
                  }
                  a2.dy = 0;
                }
              }
              if (a2.dx !== n.attrs.dx || a2.dy !== n.attrs.dy) { v.dispatch(v.state.tr.setNodeMarkup(p, undefined, a2).setMeta('addToHistory', false)); if (tries > 0) requestAnimationFrame(() => fix(tries - 1)); }
            };
            requestAnimationFrame(() => requestAnimationFrame(() => fix(4)));
            setTimeout(() => fix(2), 450);                    // once more after the pages have been laid out again
          }
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
      // a click selects the picture; it can be moved by dragging only once it is selected (then its frame takes the drag)
      img.addEventListener('pointerdown', e => {
        if (e.button !== 0 || e.detail > 1) return;
        e.preventDefault(); e.stopPropagation();
        if (selected) move(e); else reselect();
      });
      dom._kv = {
        img, move, resize, node: () => cur,
        // an older wrapped picture (text-anchored float): becomes freely placed where it is now
        cropDrag: (e, h) => {
          const sc = ext.options.getScale() || 1, c0 = { l: 0, t: 0, r: 0, b: 0, ...(cur.attrs.crop || {}) };
          const w0 = cur.attrs.width || dom.getBoundingClientRect().width / sc;
          const fw = w0 / (1 - c0.l - c0.r), fh = fw * (img.naturalHeight || 1) / (img.naturalWidth || 1);
          const sx = e.clientX, sy = e.clientY;
          const left0 = parseFloat(dom.style.left) || 0, top0 = parseFloat(dom.style.top) || 0;
          let c = { ...c0 };
          const mv = ev => {
            const dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc, MIN = 0.05;
            c = { ...c0 };
            if (h.includes('w')) c.l = Math.min(Math.max(0, c0.l + dx / fw), 1 - c0.r - MIN);
            if (h.includes('e')) c.r = Math.min(Math.max(0, c0.r - dx / fw), 1 - c0.l - MIN);
            if (h.includes('n')) c.t = Math.min(Math.max(0, c0.t + dy / fh), 1 - c0.b - MIN);
            if (h.includes('s')) c.b = Math.min(Math.max(0, c0.b - dy / fh), 1 - c0.t - MIN);
            const w = fw * (1 - c.l - c.r);
            dom.style.width = w + 'px'; applyCrop(c, w);
            if (cur.attrs.pin) {             // the picture itself stays where it is: the frame edge moves over it
              dom.style.left = left0 + (c.l - c0.l) * fw + 'px'; dom.style.top = top0 + (c.t - c0.t) * fh + 'px';
            }
            ext.options.onChange && ext.options.onChange();
          };
          const up = () => {
            removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
            const pos = getPos(); if (typeof pos !== 'number') return;
            const w = Math.round(fw * (1 - c.l - c.r) * 10) / 10;
            const crop = c.l + c.t + c.r + c.b > 0.0005 ? { l: c.l, t: c.t, r: c.r, b: c.b } : null;
            const extra = cur.attrs.pin ? { px: Math.round(((cur.attrs.px || 0) + (c.l - c0.l) * fw) * 10) / 10, py: Math.round(((cur.attrs.py || 0) + (c.t - c0.t) * fh) * 10) / 10 } : {};
            const trc = view().state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, crop, width: w, ...extra });
            trc.setSelection(NodeSelection.create(trc.doc, pos)); view().dispatch(trc);
          };
          addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
        },
        uncrop: () => {
          const c = cur.attrs.crop; if (!c) return;
          const fw = (cur.attrs.width || 0) / (1 - c.l - c.r), fh = fw * (img.naturalHeight || 1) / (img.naturalWidth || 1);
          const extra = cur.attrs.pin ? { px: Math.max(0, (cur.attrs.px || 0) - c.l * fw), py: (cur.attrs.py || 0) - c.t * fh } : {};
          setAttrs({ crop: null, width: Math.round(fw), ...extra }); reselect();
        },
        setRadius: v => { setAttrs({ radius: v }); reselect(); },
        setOpacity: v => { setAttrs({ opacity: Math.min(1, Math.max(0.05, v)) }); reselect(); },
        replace: url => { setAttrs({ src: url }); reselect(); },
        makeRel: () => {
          if (!cur.attrs.pin || cur.attrs.rel) return;
          const host = dom.parentElement && dom.parentElement.closest('p,h1,h2,h3'), pos = getPos();
          if (!host || typeof pos !== 'number') return;
          const sc = ext.options.getScale() || 1, r = dom.getBoundingClientRect(), ht = host.getBoundingClientRect().top;
          view().dispatch(view().state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, rel: true, py: Math.round((r.top - ht) / sc * 10) / 10 }).setMeta('addToHistory', false));
        },
        pinHere: () => {
          if (cur.attrs.pin || !(cur.attrs.wrap === 'wl' || cur.attrs.wrap === 'wr' || cur.attrs.wrap === 'over' || cur.attrs.wrap === 'under') || !ext.options.pageBox) return;
          const r = dom.getBoundingClientRect(); if (!r.width) return;
          const bx = ext.options.pageBox(r.top + 1), sc = ext.options.getScale() || 1, pos = getPos();
          if (!bx || typeof pos !== 'number') return;
          const px = Math.min(Math.max(0, (r.left - bx.left) / sc), Math.max(0, (bx.right - bx.left - r.width) / sc));
          const py = Math.min(Math.max(0, (r.top - bx.top) / sc), Math.max(0, (bx.bottom - bx.top - r.height) / sc));
          view().dispatch(view().state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, dx: 0, dy: 0, pin: true, pg: bx.page, px: Math.round(px * 10) / 10, py: Math.round(py * 10) / 10 }).setMeta('addToHistory', false));
        },
        setWrap: w => {
          // text wrapping: the picture is placed freely at its present place on the page (left / right edge of the text)
          if ((w === 'wl' || w === 'wr' || w === 'over' || w === 'under') && ext.options.pageBox) {
            const r = dom.getBoundingClientRect(), bx = ext.options.pageBox(r.top + 1), sc = ext.options.getScale() || 1;
            if (bx) {
              const px = Math.min(Math.max(0, (r.left - bx.left) / sc), Math.max(0, (bx.right - bx.left - r.width) / sc));
              const py = Math.min(Math.max(0, (r.top - bx.top) / sc), Math.max(0, (bx.bottom - bx.top - r.height) / sc));
              const host = dom.parentElement && dom.parentElement.closest('p,h1,h2,h3');
              if (host) { const ht = host.getBoundingClientRect().top; setAttrs({ wrap: w, dx: 0, dy: 0, pin: true, rel: true, pg: bx.page, px: Math.round(px * 10) / 10, py: Math.round((r.top - ht) / sc * 10) / 10 }); reselect(); return; }
              setAttrs({ wrap: w, dx: 0, dy: 0, pin: true, rel: false, pg: bx.page, px: Math.round(px * 10) / 10, py: Math.round(py * 10) / 10 }); reselect(); return;
            }
          }
          setAttrs({ wrap: w, dx: 0, dy: 0, pin: false }); reselect();
        },
        remove: () => { const pos = getPos(); if (typeof pos === 'number') view().dispatch(view().state.tr.delete(pos, pos + cur.nodeSize)); }
      };
      return {
        dom,
        update(n) { if (n.type !== cur.type) return false; cur = n; paint(); return true; },
        destroy() { if (capWatch) capWatch.disconnect(); },
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
  priority: 1000,                 // its Tab / Backspace rules come before the general list keys
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
      // in a list item, right after the symbol: the item moves one level in; anywhere else: a tab
      Tab: () => {
        const ed = this.editor;
        if (ed.isActive('table')) { ed.commands.goToNextCell(1); return true; }       // no new rows from Tab
        const { $from, empty } = ed.state.selection;
        // in a list: right after the symbol, on a selected formula or with several items selected -> one level in
        if (ed.isActive('listItem') && (!empty || $from.parentOffset === 0)) { changeListLevel(ed.view, 1); return true; }
        return ed.commands.insertContent({ type: 'tab' });
      },
      'Shift-Tab': () => { const ed = this.editor; if (ed.isActive('table')) { ed.commands.goToNextCell(-1); return true; } if (!ed.isActive('listItem')) return false; changeListLevel(ed.view, -1); return true; },
      Enter: () => {
        const ed = this.editor, { $from, empty } = ed.state.selection;
        if (!empty || !ed.isActive('listItem') || $from.parent.content.size) return false;
        const li = $from.node($from.depth - 1);
        if (!li || li.type.name !== 'listItem' || li.childCount !== 1 || $from.depth < 4) return false;   // top level: the usual (leaves the list)
        return changeListLevel(ed.view, -1);
      },
      Backspace: () => {
        if (deleteEmptyListItem(this.editor.view)) return true;
        const st = this.editor.state, sel = st.selection;
        if (!sel.empty) return false;
        const $f = sel.$from, d = $f.depth - 1;
        if ($f.parentOffset !== 0 || d < 3) return false;
        if ($f.node(d).type.name !== 'listItem' || $f.index(d) !== 0) return false;
        const L2 = $f.node(d - 1); if (!/List$/.test(L2.type.name) || $f.index(d - 1) !== 0) return false;
        const LI1 = $f.node(d - 2); if (LI1.type.name !== 'listItem' || $f.index(d - 2) !== 1 || !LI1.attrs.sameLine) return false;
        const first = LI1.firstChild; if (!first || !first.isTextblock || first.content.size) return false;
        const inner = L2.firstChild, kids = [];
        inner.forEach(c => kids.push(c));
        if (L2.childCount > 1) { const rest = []; L2.forEach((c, o, i) => { if (i) rest.push(c); }); kids.push(L2.copy(Fragment.from(rest))); }
        LI1.forEach((c, o, i) => { if (i > 1) kids.push(c); });
        const liPos = $f.before(d - 2);
        const tr = st.tr.replaceWith(liPos, liPos + LI1.nodeSize, LI1.type.create({ ...LI1.attrs, sameLine: false }, kids));
        tr.setSelection(TextSelection.create(tr.doc, liPos + 2));
        this.editor.view.dispatch(tr.scrollIntoView());
        return true;
      },
      'Mod-l': () => this.editor.chain().focus().toggleSubscript().run(),
      'Mod-h': () => this.editor.chain().focus().toggleSuperscript().run()
    };
  }
});

/* ------------------------------------------------------------------ */
/* Overriding the paragraph style: not bold / not italic / not         */
/* underlined text inside a style that is (e.g. a bold heading)        */
/* ------------------------------------------------------------------ */
export const FontOverrides = Extension.create({
  name: 'fontOverrides',
  addGlobalAttributes() {
    return [{ types: ['textStyle'], attributes: {
      fontWeight: { default: null, parseHTML: el => el.style.fontWeight || null, renderHTML: a => a.fontWeight ? { style: `font-weight:${a.fontWeight}` } : {} },
      fontStyle: { default: null, parseHTML: el => el.style.fontStyle || null, renderHTML: a => a.fontStyle ? { style: `font-style:${a.fontStyle}` } : {} },
      textDecoration: { default: null, parseHTML: el => el.style.textDecorationLine === 'none' ? 'none' : null, renderHTML: a => a.textDecoration ? { style: `text-decoration:${a.textDecoration}` } : {} }
    } }];
  },
  addProseMirrorPlugins() {
    // a paragraph with its own line shading: its own colour wins over the style's shading (see shading.js)
    return [new Plugin({ props: { decorations(state) {
      const decos = [], type = state.schema.marks.lineShade;
      if (!type) return null;
      state.doc.descendants((n, pos) => {
        if (!n.isTextblock) return true;
        let has = false; n.descendants(c => { if (!has && type.isInSet(c.marks)) has = true; return !has; });
        if (has) decos.push(Decoration.node(pos, pos + n.nodeSize, { class: 'own-shade' }));
        return false;
      });
      return decos.length ? DecorationSet.create(state.doc, decos) : null;
    } } })];
  }
});

/* ------------------------------------------------------------------ */
/* Lists: changing the level of exactly the selected items (as Word)   */
/* The list is flattened to (level, item) pairs, the levels of the     */
/* selected items change, and the list is built again: other items –   */
/* also the ones nested under a selected item – keep their level, and  */
/* every item keeps its own symbol / numbering format.                 */
/* ------------------------------------------------------------------ */
export const ListItemAttrs = Extension.create({
  name: 'listItemAttrs',
  addGlobalAttributes() {
    return [{ types: ['listItem'], attributes: {
      sameLine: { default: false, keepOnSplit: false, parseHTML: el => el.getAttribute('data-same') === '1', renderHTML: a => a.sameLine ? { 'data-same': '1' } : {} },
      // an invisible holder item: lets the first item of a list stand one level deeper
      ghost: { default: false, keepOnSplit: false, parseHTML: el => el.hasAttribute('data-ghost'), renderHTML: a => a.ghost ? { 'data-ghost': '1' } : {} }
    } }];
  }
});
const isList = n => n && (n.type.name === 'bulletList' || n.type.name === 'orderedList');
function flatten(list, level, out, pos) {
  list.forEach((li, off) => {
    const liPos = pos + 1 + off, content = [], subs = [];
    let cOff = 0, contentStart = liPos + 1;
    li.forEach((c, o) => { if (isList(c)) subs.push([c, liPos + 1 + o]); else content.push(c); });
    if (!li.attrs.ghost) out.push({ level, type: list.type, attrs: list.attrs, itemAttrs: li.attrs, content, from: liPos, start: contentStart,
      end: subs.length ? subs[0][1] : liPos + li.nodeSize - 1 });
    void cOff;
    for (const [sub, sp] of subs) flatten(sub, level + 1, out, sp);
  });
}
const sameAttrs = (a, b) => ['bulletChar', 'bulletImage', 'bulletSize', 'numStyle', 'gap'].every(k => (a[k] ?? null) === (b[k] ?? null));
function rebuild(items, schema) {
  let i = 0;
  const build = level => {
    const lists = []; let cur = null;
    while (i < items.length && items[i].level >= level) {
      const it = items[i];
      if (it.level === level) {
        if (!cur || cur.type !== it.type || !sameAttrs(cur.attrs, it.attrs)) {
          const attrs = { ...it.attrs };
          if (cur && it.type.name === 'orderedList' && lists.some(l => l.type === it.type && sameAttrs(l.attrs, it.attrs))) { attrs.cont = true; }
          cur = { type: it.type, attrs, items: [] }; lists.push(cur);
        }
        cur.items.push({ attrs: it.itemAttrs, content: [...it.content], src: it });
        i++;
      } else {
        if (!cur) { cur = { type: it.type, attrs: { ...it.attrs }, items: [{ attrs: { ghost: true }, content: [schema.nodes.paragraph.create()] }] }; lists.push(cur); }
        const subs = build(level + 1);
        cur.items[cur.items.length - 1].content.push(...subs);
      }
    }
    return lists.map(l => l.type.create(l.attrs, l.items.map(x => { const n = schema.nodes.listItem.create(x.attrs, x.content.length ? x.content : [schema.nodes.paragraph.create()]); n._src = x.src; return n; })));
  };
  return build(0);
}
/** Change the level of the selected list items by delta (+1 / -1). Returns false when not in a list. */
export function changeListLevel(view, delta) {
  const st = view.state, { $from, $to, from, to } = st.selection;
  let d = 1; while (d <= $from.depth && !isList($from.node(d))) d++;
  if (d > $from.depth) return false;
  const outer = $from.node(d), outerPos = $from.before(d);
  if (to > outerPos + outer.nodeSize) return false;
  const items = []; flatten(outer, 0, items, outerPos);
  // the selected items: their own content (not their nested items) touches the selection
  const sel = items.filter(it => it.end >= from && it.start <= to);
  if (!sel.length) return false;
  for (const it of items) it.newLevel = it.level;
  for (const it of sel) {
    it.newLevel = Math.max(0, it.level + delta);
    // keep the symbol it shows now (a default bullet would otherwise change with the level)
    if (it.newLevel !== it.level && it.type.name === 'bulletList' && !it.attrs.bulletChar && !it.attrs.bulletImage) it.attrs = { ...it.attrs, bulletChar: bulletAt(it.level) };
  }
  // a list cannot skip a level: an item is at most one level deeper than the one before it
  // the items after a moved one keep their level; holder items fill any gap above a deeper first item
  if (items.every(it => it.newLevel === it.level)) return true;
  // an item moving to another level takes the format (numbering / symbol) of the items already on that level
  const moved = new Set(sel.filter(it => it.newLevel !== it.level));
  for (const it of moved) {
    const i = items.indexOf(it);
    let nb = null;
    for (let k = i - 1; k >= 0; k--) { const o = items[k]; if (o.newLevel < it.newLevel) break; if (o.newLevel === it.newLevel && !moved.has(o)) { nb = o; break; } }
    if (!nb) for (let k = i + 1; k < items.length; k++) { const o = items[k]; if (o.newLevel < it.newLevel) break; if (o.newLevel === it.newLevel && !moved.has(o)) { nb = o; break; } }
    if (nb) { it.type = nb.type; it.attrs = { ...nb.attrs }; }
  }
  for (const it of items) it.level = it.newLevel;
  const nodes = rebuild(items, st.schema);
  // selection: same offset inside the same item
  const offA = (() => { const it = items.find(x => x.start <= st.selection.anchor && st.selection.anchor <= x.end); return it ? [items.indexOf(it), st.selection.anchor - it.start] : null; })();
  const offH = (() => { const it = items.find(x => x.start <= st.selection.head && st.selection.head <= x.end); return it ? [items.indexOf(it), st.selection.head - it.start] : null; })();
  const tr = st.tr.replaceWith(outerPos, outerPos + outer.nodeSize, nodes);
  const starts = []; const walk = (n, p) => n.forEach((c, o) => { const cp = p + 1 + o; if (c.type.name === 'listItem') { if (!c.attrs.ghost) starts.push(cp + 1); c.forEach((g, go) => { if (isList(g)) walk(g, cp + 1 + go); }); } });
  let p = outerPos; for (const n of nodes) { walk(n, p); p += n.nodeSize; }
  try {
    const A = offA && starts[offA[0]] != null ? starts[offA[0]] + offA[1] : null, H = offH && starts[offH[0]] != null ? starts[offH[0]] + offH[1] : null;
    if (A != null && H != null) tr.setSelection(TextSelection.create(tr.doc, A, H));
  } catch (e) { /* keep the mapped selection */ }
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** Backspace in an empty item of an inner list: the item goes, everything else keeps its level (renumbered). */
export function deleteEmptyListItem(view) {
  const st = view.state, sel = st.selection;
  if (!sel.empty) return false;
  const $f = sel.$from;
  if ($f.parent.content.size || $f.depth < 4) return false;
  const li = $f.node($f.depth - 1);
  if (li.type.name !== 'listItem' || li.childCount !== 1) return false;
  let d = 1; while (d <= $f.depth && !isList($f.node(d))) d++;
  const outer = $f.node(d), outerPos = $f.before(d);
  const items = []; flatten(outer, 0, items, outerPos);
  const k = items.findIndex(it => it.start <= sel.from && sel.from <= it.end);
  if (k < 0 || items[k].level === 0) return false;
  const prev = k - 1;
  items.splice(k, 1);
  const nodes = rebuild(items, st.schema);
  const tr = st.tr.replaceWith(outerPos, outerPos + outer.nodeSize, nodes);
  // cursor: end of the previous item's text
  const starts = []; const walk = (n, p) => n.forEach((c, o) => { const cp = p + 1 + o; if (c.type.name === 'listItem') { starts.push([cp, c]); c.forEach((g, go) => { if (isList(g)) walk(g, cp + 1 + go); }); } });
  let p = outerPos; for (const n of nodes) { walk(n, p); p += n.nodeSize; }
  const t = starts[Math.max(0, prev)];
  if (t) { let endPos = t[0] + 1; t[1].forEach((c, o) => { if (!isList(c)) endPos = t[0] + 1 + o + c.nodeSize - 1; }); try { tr.setSelection(TextSelection.create(tr.doc, endPos)); } catch (e) { /* mapped */ } }
  view.dispatch(tr.scrollIntoView());
  return true;
}

/* ------------------------------------------------------------------ */
/* Comments: the commented text carries a mark (only an id – the look */
/* is drawn by the app on its own layer, never printed or exported)   */
/* ------------------------------------------------------------------ */
export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',                 // several comments may cover the same text
  addAttributes() { return { id: { default: null, parseHTML: el => el.getAttribute('data-cmt'), renderHTML: a => ({ 'data-cmt': a.id }) } }; },
  parseHTML() { return [{ tag: 'span[data-cmt]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', HTMLAttributes, 0]; }
});

/* ------------------------------------------------------------------ */
/* Lists that end up right next to each other (e.g. an item added in   */
/* the middle and deleted again) become one list again – their        */
/* numbering goes on instead of starting from 1                        */
/* ------------------------------------------------------------------ */
export const ListJoin = Extension.create({
  name: 'listJoin',
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction(trs, oldState, state) {
        if (!trs.some(t => t.docChanged)) return null;
        const joins = [];
        const scan = (n, start) => {          // start: position of n's first child
          let prev = null;
          n.forEach((c, off) => {
            const cp = start + off;
            if (prev && /^(orderedList|bulletList)$/.test(c.type.name) && prev.type === c.type) {
              const a = prev.attrs, b = c.attrs;
              const same = c.type.name === 'orderedList'
                ? (a.numStyle || null) === (b.numStyle || null) && (b.start == null || b.start === 1) && !b.cont
                : (a.bulletChar || '') === (b.bulletChar || '') && (a.bulletImage || '') === (b.bulletImage || '');
              if (same) joins.push(cp);
            }
            prev = c;
            if (!c.isTextblock && !c.isLeaf) scan(c, cp + 1);
          });
        };
        scan(state.doc, 0);
        if (!joins.length) return null;
        const tr = state.tr;
        for (const j of joins.reverse()) { try { tr.join(tr.mapping.map(j)); } catch (e) { /* leave it */ } }
        return tr.docChanged ? tr.setMeta('addToHistory', false) : null;
      }
    })];
  }
});

/* ---------- lists: the room for the symbol grows with the widest symbol of the list (big letters, "10.") ------
   Every line of every item then starts at the same place, and the next level's symbol stands exactly where the
   text of this level starts (like a hanging indent of that width). The room is never smaller than the list's own
   setting (0,8 cm by default). */
const CM_PX = 96 / 2.54;
export function neededGapPx(listEl, scale = 1, gapCm = null) {
  let need = 0;
  for (const lm of listEl.querySelectorAll(':scope > li > :first-child > .lm')) {
    const r = document.createRange(); r.selectNodeContents(lm);
    const w = r.getBoundingClientRect().width / (scale || 1), fs = parseFloat(getComputedStyle(lm).fontSize) || 16;
    if (w) need = Math.max(need, w + 0.3 * fs);
  }
  return Math.round(Math.max((gapCm ?? 0.8) * CM_PX, need) * 100) / 100;
}
/** The same for a drawn (not edited) text. */
export function fitListGapsDOM(root, scale = 1) {
  for (const l of root.querySelectorAll('ul, ol')) l.style.setProperty('--gap', neededGapPx(l, scale, numOrNull(l.getAttribute('data-gap'))) + 'px');
}
export const ListGapFit = Extension.create({
  name: 'listGapFit',
  addOptions() { return { getScale: () => 1 }; },
  addProseMirrorPlugins() {
    const ext = this, key = new PluginKey('listGapFit');
    return [new Plugin({
      key,
      state: { init: () => DecorationSet.empty, apply(tr, old) { const m = tr.getMeta(key); return m || old.map(tr.mapping, tr.doc); } },
      props: { decorations(st) { return key.getState(st); } },
      view(view) {
        let raf = 0, sig = '';
        const run = () => {
          raf = 0; if (!view.dom.isConnected) return;
          const sc = ext.options.getScale() || 1, decos = [];
          let stale = false;
          view.state.doc.descendants((n, pos) => {
            if (n.type.name !== 'bulletList' && n.type.name !== 'orderedList') return;
            const dom = view.nodeDOM(pos); if (!dom || !dom.querySelectorAll) return;
            const v = neededGapPx(dom, sc, n.attrs.gap) + 'px';
            if (dom.style.getPropertyValue('--gap').trim() !== v) stale = true;      // a list drawn again (e.g. its setting changed)
            decos.push(Decoration.node(pos, pos + n.nodeSize, { style: `--gap:${v}` }));
          });
          const s = decos.map(d => d.from + d.type.attrs.style).join('|');
          if (s !== sig || stale) { sig = s; view.dispatch(view.state.tr.setMeta(key, DecorationSet.create(view.state.doc, decos)).setMeta('addToHistory', false)); }
        };
        const later = () => { if (!raf) raf = requestAnimationFrame(run); };
        later();
        return { update(v, prev) { if (v.state.doc !== prev.doc) later(); }, destroy() { cancelAnimationFrame(raf); } };
      }
    })];
  }
});
