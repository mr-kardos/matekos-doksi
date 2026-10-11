import { Extension, Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { BulletList, OrderedList } from '@tiptap/extension-list';
import { TableCell, TableHeader } from '@tiptap/extension-table';
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
/* Formulas                                                            */
/* ------------------------------------------------------------------ */
const mathKey = new PluginKey('mathTools');
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
    return ({ node, getPos }) => {
      let cur = node;
      const dom = document.createElement('span');
      dom.contentEditable = 'false';
      const paint = () => {
        dom.className = 'math' + (cur.attrs.display ? ' disp' : '');
        dom.setAttribute('data-tex', cur.attrs.tex);
        renderInto(dom, cur.attrs.tex, cur.attrs.display, () => ext.options.onRendered && ext.options.onRendered());
      };
      paint();
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
        selectNode() { dom.classList.add('ProseMirror-selectednode'); },
        deselectNode() { dom.classList.remove('ProseMirror-selectednode'); },
        ignoreMutation: () => true,
        stopEvent: e => e.type === 'dblclick'
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
    return [new Plugin({
      key: mathKey,
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
        // math nodes inside a text selection are highlighted exactly like the text around them
        decorations(state) {
          const sel = state.selection;
          if (sel.empty || sel instanceof NodeSelection) return null;
          const decos = [];
          state.doc.nodesBetween(sel.from, sel.to, (n, pos) => {
            if (n.type === type && pos >= sel.from && pos + n.nodeSize <= sel.to) decos.push(Decoration.node(pos, pos + n.nodeSize, { class: 'in-sel' }));
          });
          return decos.length ? DecorationSet.create(state.doc, decos) : null;
        }
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
/* Images: text wrap, corner resize, drag & drop                       */
/* ------------------------------------------------------------------ */
const WRAPS = ['wl', 'wr', 'ctr', 'inl'];
export const KvImage = Node.create({
  name: 'image',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  addOptions() { return { getScale: () => 1, icons: {} }; },
  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: '' },
      width: { default: null, parseHTML: el => parseFloat(el.style.width) || numOrNull(el.getAttribute('width')) },
      wrap: { default: 'wl', parseHTML: el => el.getAttribute('data-wrap') || WRAPS.find(w => el.classList.contains(w)) || 'wl' }
    };
  },
  parseHTML() { return [{ tag: 'img[src]' }]; },
  renderHTML({ node }) {
    const a = node.attrs;
    return ['img', { src: a.src, alt: a.alt || '', 'data-wrap': a.wrap, class: a.wrap, style: a.width ? `width:${a.width}px` : null }];
  },
  addNodeView() {
    const ext = this;
    return ({ node, getPos, editor }) => {
      let cur = node;
      const dom = document.createElement('span');
      dom.draggable = true;
      const img = document.createElement('img');
      img.draggable = false;
      dom.appendChild(img);
      for (const h of ['nw', 'ne', 'sw', 'se']) { const i = document.createElement('i'); i.className = 'ih no-print ' + h; i.dataset.h = h; dom.appendChild(i); }
      const bar = document.createElement('span');
      bar.className = 'ibar no-print';
      const I = ext.options.icons;
      bar.innerHTML = `<button class="tb" data-wrap="wl" title="Text wraps, picture on the left">${I.wrapL || 'L'}</button>`
        + `<button class="tb" data-wrap="wr" title="Text wraps, picture on the right">${I.wrapR || 'R'}</button>`
        + `<button class="tb" data-wrap="ctr" title="Own line, centered">${I.center || 'C'}</button>`
        + `<button class="tb" data-wrap="inl" title="In line with text">${I.inline || 'I'}</button><span class="sep"></span>`
        + `<button class="tb" data-act="del" title="Delete picture">${I.trash || '×'}</button>`;
      dom.appendChild(bar);
      const size = document.createElement('span'); size.className = 'isize no-print'; dom.appendChild(size);
      let selected = false;
      const paint = () => {
        dom.className = 'imgw ' + (cur.attrs.wrap || 'wl') + (selected ? ' ProseMirror-selectednode' : '');
        if (img.getAttribute('src') !== cur.attrs.src) img.src = cur.attrs.src;
        img.alt = cur.attrs.alt || '';
        dom.style.width = cur.attrs.width ? cur.attrs.width + 'px' : '';
        for (const b of bar.querySelectorAll('[data-wrap]')) b.classList.toggle('on', b.dataset.wrap === cur.attrs.wrap);
      };
      paint();
      img.addEventListener('load', () => {
        if (!cur.attrs.width && img.naturalWidth) {
          const col = editor.view.dom.clientWidth || 600;
          const w = Math.round(Math.min(img.naturalWidth, col * 0.45));
          const pos = getPos();
          if (typeof pos === 'number') editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, width: w }).setMeta('addToHistory', false));
        }
        editor.view.dom.dispatchEvent(new CustomEvent('kv-relayout', { bubbles: true }));
      });
      const setAttrs = attrs => { const pos = getPos(); if (typeof pos === 'number') editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, ...attrs })); };
      bar.addEventListener('mousedown', e => e.preventDefault());
      bar.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.wrap) setAttrs({ wrap: b.dataset.wrap });
        else if (b.dataset.act === 'del') { const pos = getPos(); if (typeof pos === 'number') editor.view.dispatch(editor.view.state.tr.delete(pos, pos + cur.nodeSize)); }
      });
      dom.addEventListener('pointerdown', e => {
        const h = e.target.dataset && e.target.dataset.h;
        if (!h) return;
        e.preventDefault(); e.stopPropagation();
        const scale = ext.options.getScale() || 1;
        const sx = e.clientX, startW = dom.getBoundingClientRect().width / scale, sign = h.includes('e') ? 1 : -1;
        const maxW = editor.view.dom.clientWidth;
        let w = startW;
        const mv = ev => {
          w = Math.max(16, Math.min(maxW, startW + sign * (ev.clientX - sx) / scale));
          dom.style.width = Math.round(w) + 'px';
          size.textContent = Math.round(w / (96 / 25.4)) + ' mm';
        };
        const up = () => {
          removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
          size.textContent = '';
          setAttrs({ width: Math.round(w) });
        };
        addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
      });
      return {
        dom,
        update(n) { if (n.type !== cur.type) return false; cur = n; paint(); return true; },
        selectNode() { selected = true; dom.classList.add('ProseMirror-selectednode'); },
        deselectNode() { selected = false; dom.classList.remove('ProseMirror-selectednode'); },
        stopEvent: e => !!(e.target.closest && e.target.closest('.ibar,.ih')),
        ignoreMutation: () => true
      };
    };
  },
  addCommands() {
    return {
      insertImage: attrs => ({ commands }) => commands.insertContent({ type: this.name, attrs })
    };
  }
});
