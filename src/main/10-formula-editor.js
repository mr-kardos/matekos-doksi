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

