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
      link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https', HTMLAttributes: { target: null, rel: null, class: null } },
      bulletList: false, orderedList: false, listItem: false, trailingNode: false,   // no extra empty line under a final list
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

