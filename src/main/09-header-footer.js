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

