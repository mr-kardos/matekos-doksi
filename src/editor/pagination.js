// Real pagination for one continuous ProseMirror document.
// After every change the natural layout is measured and invisible spacer widgets are
// inserted so that each line, table row or picture lands inside a page's text area:
//   • inside a paragraph: an inline spacer at the start of the first line that does not fit
//     (the paragraph splits across pages; justified lines stay justified)
//   • before a block / list item / table: a block spacer
//   • between table rows: a spacer row
// Orphan/widow control and keep-with-next (headings) are applied.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { geometry } from '../template.js';

export const pgKey = new PluginKey('pagination');

const SKIP_CLASSES = ['lm', 'pg-sp', 'pg-spb', 'ibar', 'isize', 'ih', 'fcaret', 'column-resize-handle'];

function lineBoxes(dom, Y, LH) {
  const groups = [];
  const range = document.createRange();
  const add = (r, isText) => {
    if (r.height <= 0) return;
    groups.push({ top: r.top, bottom: r.bottom, left: r.left, width: r.width, text: isText });
  };
  const walk = el => {
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        if (!n.data.length) continue;
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) add(r, true);
      } else if (n.nodeType === 1) {
        const c = n.classList;
        if (SKIP_CLASSES.some(k => c.contains(k))) continue;
        if (c.contains('imgw')) { if (c.contains('inl') || c.contains('ctr')) for (const r of n.getClientRects()) add(r, false); continue; }
        if (c.contains('math')) { for (const r of n.getClientRects()) add(r, false); continue; }
        if (n.tagName === 'BR') continue;
        walk(n);
      }
    }
  };
  walk(dom);
  groups.sort((a, b) => (a.top + a.bottom) - (b.top + b.bottom));
  const lines = [];
  for (const r of groups) {
    const mid = (r.top + r.bottom) / 2;
    const L = lines.length ? lines[lines.length - 1] : null;
    if (L && mid >= L.top - 0.5 && mid <= L.bottom + 0.5) {
      L.top = Math.min(L.top, r.top); L.bottom = Math.max(L.bottom, r.bottom);
      if (r.width > 0) L.left = Math.min(L.left, r.left);
      if (r.text) { L.tTop = Math.min(L.tTop, r.top); L.tH = Math.max(L.tH, r.bottom - r.top); }
    } else {
      lines.push({ top: r.top, bottom: r.bottom, left: r.width > 0 ? r.left : Infinity, tTop: r.text ? r.top : Infinity, tH: r.text ? r.bottom - r.top : 0 });
    }
  }
  return lines.map(L => {
    const ttop = Number.isFinite(L.tTop) ? L.tTop : L.top;
    const th = L.tH || (L.bottom - L.top);
    let boxTop = ttop - Math.max(0, (LH - th) / 2);
    boxTop = Math.min(boxTop, L.top);
    const boxBottom = Math.max(boxTop + LH, L.bottom);
    return { top: Y(boxTop), bottom: Y(boxBottom), cx: Number.isFinite(L.left) ? L.left : null, cy: (L.top + L.bottom) / 2 };
  });
}

function measure(view, tpl, scale) {
  const g = geometry(tpl);
  const er = view.dom.getBoundingClientRect();
  const Y = cy => (cy - er.top) / scale + g.mt;
  const pageOf = y => Math.max(0, Math.floor(y / g.P));
  const contentH = g.H - g.mt - g.mb;
  const decos = [];
  let shift = 0, maxBottom = g.mt;
  let last = null;            // previous block (for keep-with-next)

  const blockSpacer = (pos, h) => decos.push(Decoration.widget(pos, () => {
    const d = document.createElement('div'); d.className = 'pg-spb'; d.style.height = h + 'px'; return d;
  }, { side: -1, key: 'b' + pos + ':' + h.toFixed(1), ignoreSelection: true }));
  const inlineSpacer = (pos, h) => decos.push(Decoration.widget(pos, () => {
    const s = document.createElement('span'); s.className = 'pg-sp'; s.style.height = h + 'px'; return s;
  }, { side: -1, marks: [], key: 'i' + pos + ':' + h.toFixed(1), ignoreSelection: true }));
  const rowSpacer = (pos, cols, h) => decos.push(Decoration.widget(pos, () => {
    const tr = document.createElement('tr'); tr.className = 'pg-row';
    const td = document.createElement('td'); td.colSpan = cols; td.style.height = h + 'px'; tr.appendChild(td); return tr;
  }, { side: -1, key: 'r' + pos + ':' + h.toFixed(1), ignoreSelection: true }));

  const targetOf = (pos, chain) => {
    let t = { pos };
    for (let i = chain.length - 1; i >= 0; i--) { if (chain[i].pos + 1 === t.pos) t = { pos: chain[i].pos }; else break; }
    return t.pos;
  };
  const topOfPos = pos => { const d = view.nodeDOM(pos); return d && d.getBoundingClientRect ? Y(d.getBoundingClientRect().top) : null; };

  // Push a whole block (or the keep-with-next block before it) to the next page.
  const pushBlock = (targetPos, natTop, page) => {
    if (last && last.keep && last.page === page && !last.atTop) {
      const h = g.contentTop(page + 1) - (last.top + last.shiftAt);
      if (h > 0.5) { blockSpacer(last.pos, h); shift += h; last.atTop = true; return; }
    }
    const h = g.contentTop(page + 1) - (natTop + shift);
    if (h > 0.5) { blockSpacer(targetPos, h); shift += h; }
  };

  const doTextblock = (node, pos, chain) => {
    const dom = view.nodeDOM(pos);
    if (!dom || !dom.getBoundingClientRect) return;
    const cs = getComputedStyle(dom);
    const fs = parseFloat(cs.fontSize) || 16;
    const LH = cs.lineHeight === 'normal' ? fs * 1.2 : parseFloat(cs.lineHeight);
    const br = dom.getBoundingClientRect();
    const blockTop = Y(br.top);
    let lines = lineBoxes(dom, Y, LH);
    if (!lines.length) {
      const pt = parseFloat(cs.paddingTop) || 0;
      lines = [{ top: blockTop + pt, bottom: blockTop + pt + LH, cx: null, cy: null }];
    }
    // floating pictures belong to the line they are anchored on
    for (const f of dom.querySelectorAll('.imgw.wl, .imgw.wr')) {
      const r = f.getBoundingClientRect(), fb = Y(r.bottom);
      const anchorTop = Y(r.top) - (parseFloat(getComputedStyle(f).marginTop) || 0);   // the line the picture is anchored to
      let k = 0;
      for (let i = 0; i < lines.length; i++) if (lines[i].top <= anchorTop + 1) k = i;
      lines[k].bottom = Math.max(lines[k].bottom, fb);
    }
    const target = targetOf(pos, chain);
    const targetTop = topOfPos(target) ?? blockTop;
    const bands = [];
    let localShift = 0, pushedAt = -1, k = 0, guard = 0;
    while (k < lines.length && guard++ < 1000) {
      const L = lines[k];
      const t = L.top + shift, b = L.bottom + shift;
      const p = pageOf(t), cTop = g.contentTop(p), cBot = g.contentBottom(p);
      const inHeaderZone = t < cTop - 0.5;
      const overflow = b > cBot + 0.5 && (b - t) <= contentH;
      if ((inHeaderZone || overflow || t >= cBot - 0.5) && pushedAt !== k) {
        let kb = k;
        if (!inHeaderZone && lines.length > 1) {
          if (kb === 1) kb = 0;                                         // no single orphan line at the bottom
          else if (kb === lines.length - 1 && kb >= 2) kb = kb - 1;     // no single widow line at the top
        }
        if (kb === 0) {
          if (inHeaderZone) { const h = cTop - (targetTop + shift); if (h > 0.5) { blockSpacer(target, h); shift += h; } }
          else pushBlock(target, targetTop, pageOf(targetTop + shift));
        } else {
          const Lk = lines[kb], tk = Lk.top + shift, pk = pageOf(tk);
          const dest = inHeaderZone && kb === k ? g.contentTop(pk) : g.contentTop(pk + 1);
          const h = dest - tk;
          let lpos = null;
          if (Lk.cx != null) { const hit = view.posAtCoords({ left: Lk.cx + 0.5, top: Lk.cy }); if (hit) lpos = hit.pos; }
          if (h > 0.5 && lpos != null && lpos > pos && lpos < pos + node.nodeSize - 1) {
            inlineSpacer(lpos, h);
            if (node.attrs.shade) bands.push([Lk.top - blockTop + localShift, h]);
            shift += h; localShift += h;
          }
        }
        pushedAt = kb; k = kb;
        continue;
      }
      k++;
    }
    if (bands.length) {
      const c = 'var(--shade)';
      let stops = [], at = 0;
      for (const [a, h] of bands) { stops.push(`${c} ${at}px`, `${c} ${a}px`, `transparent ${a}px`, `transparent ${a + h}px`); at = a + h; }
      stops.push(`${c} ${at}px`, `${c} 100%`);
      decos.push(Decoration.node(pos, pos + node.nodeSize, { style: `background-color:transparent;background-image:linear-gradient(to bottom,${stops.join(',')})` }));
    }
    const bottom = Y(br.bottom) + shift;
    maxBottom = Math.max(maxBottom, bottom, lines[lines.length - 1].bottom + shift);
    const keep = node.type.name === 'heading' || !!node.attrs.keepNext;
    last = { pos: target, top: targetTop, shiftAt: shift, page: pageOf(targetTop + shift), keep, atTop: Math.abs(targetTop + shift - g.contentTop(pageOf(targetTop + shift))) < 1 };
  };

  const doTable = (node, pos, chain) => {
    const wrap = view.nodeDOM(pos);
    if (!wrap) return;
    const target = targetOf(pos, chain);
    const tTop = topOfPos(target) ?? Y(wrap.getBoundingClientRect().top);
    let cols = 0; node.firstChild && node.firstChild.forEach(c => { cols += c.attrs.colspan || 1; });
    node.forEach((row, off, i) => {
      const rpos = pos + 1 + off;
      const tr = view.nodeDOM(rpos);
      if (!tr || !tr.getBoundingClientRect) return;
      const r = tr.getBoundingClientRect();
      const t = Y(r.top) + shift, b = Y(r.bottom) + shift;
      const p = pageOf(t), cTop = g.contentTop(p), cBot = g.contentBottom(p);
      if (t < cTop - 0.5 || (b > cBot + 0.5 && (b - t) <= contentH) || t >= cBot - 0.5) {
        if (i === 0) { pushBlock(target, tTop, pageOf(tTop + shift)); }
        else {
          const dest = t < cTop - 0.5 ? cTop : g.contentTop(p + 1);
          const h = dest - t;
          if (h > 0.5) { rowSpacer(rpos, Math.max(1, cols), h); shift += h; }
        }
      }
      maxBottom = Math.max(maxBottom, Y(r.bottom) + shift);
    });
    const wr = wrap.getBoundingClientRect();
    maxBottom = Math.max(maxBottom, Y(wr.bottom) + shift);
    last = { pos: target, top: tTop, shiftAt: shift, page: pageOf(tTop + shift), keep: false, atTop: true };
  };

  const visit = (node, pos, chain) => {
    if (node.isTextblock) return doTextblock(node, pos, chain);
    if (node.type.name === 'table') return doTable(node, pos, chain);
    if (node.type.name === 'pageBreak') {
      const d = view.nodeDOM(pos);
      if (d) {
        const bot = Y(d.getBoundingClientRect().bottom) + shift;
        const h = g.contentTop(pageOf(bot - 0.5) + 1) - bot;
        if (h > 0.5 && pos + node.nodeSize < view.state.doc.content.size) { blockSpacer(pos + node.nodeSize, h); shift += h; }
        maxBottom = Math.max(maxBottom, bot);
        last = null;
      }
      return;
    }
    const next = chain.concat([{ pos }]);
    node.forEach((child, off) => visit(child, pos + 1 + off, next));
  };
  view.state.doc.forEach((child, off) => visit(child, off, []));

  const pages = Math.max(1, pageOf(maxBottom - 1) + 1);
  return { decos, pages };
}

export const Pagination = Extension.create({
  name: 'pagination',
  addOptions() { return { getTpl: null, getScale: () => 1, onLayout: null }; },
  addStorage() { return { relayout: () => {}, pages: 1 }; },
  addProseMirrorPlugins() {
    const opts = this.options, storage = this.storage;
    let timer = 0, running = false;
    const run = view => {
      if (running || !view.dom.isConnected || !opts.getTpl) return;
      running = true;
      try {
        view.dispatch(view.state.tr.setMeta(pgKey, DecorationSet.empty).setMeta('addToHistory', false));
        const res = measure(view, opts.getTpl(), opts.getScale() || 1);
        view.dispatch(view.state.tr.setMeta(pgKey, DecorationSet.create(view.state.doc, res.decos)).setMeta('addToHistory', false));
        storage.pages = res.pages;
        opts.onLayout && opts.onLayout(res.pages);
      } finally { running = false; }
    };
    return [new Plugin({
      key: pgKey,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, old) { const m = tr.getMeta(pgKey); return m || old.map(tr.mapping, tr.doc); }
      },
      props: { decorations(state) { return pgKey.getState(state); } },
      view(view) {
        const schedule = (d = 120) => { clearTimeout(timer); timer = setTimeout(() => run(view), d); };
        storage.relayout = (d = 0) => schedule(d);
        storage.relayoutNow = () => { clearTimeout(timer); run(view); };
        view.dom.addEventListener('kv-relayout', () => schedule(20));
        schedule(0);
        return { update(v, prev) { if (v.state.doc !== prev.doc) schedule(); }, destroy() { clearTimeout(timer); } };
      }
    })];
  }
});
