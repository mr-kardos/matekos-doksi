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

