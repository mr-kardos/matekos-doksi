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
function docData() { return { title: docTitle(), tpl, doc: editor.getJSON(), colors: docColors, ...(customTpl ? { customTpl } : {}), ...(docComments.length ? { comments: docComments } : {}), ...(docToc ? { toc: docToc } : {}) }; }
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
  docToc = d.toc && typeof d.toc === 'object' ? d.toc : (d.tpl && d.tpl.toc) || null;     // 1.2.0 kept it in the template
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
    const lvl = e.level, look = tocLook();
    return { type: 'paragraph', attrs: { toc: lvl, tocSrc: e.sig, tabStops: tocTabs(width, look), indentLeft: tocIndent(lvl, look), spaceBefore: lvl === 1 ? 4 : 0, spaceAfter: 1, keepNext: false },
      content: [...markAll(e.content, lvl === 1 && look.bold ? [{ type: 'bold' }] : null), { type: 'tab' }, { type: 'text', text: e.page }] };
  });
}
/* the look of the table of contents (template → toc): no indent by default, bold main headings, dots to the number */
const tocLook = () => ({ indent: false, bold: true, leader: 'dot', ...(docToc || {}) });
const tocIndent = (lvl, look) => look.indent && lvl > 1 ? (lvl - 1) * 0.6 : null;
const tocTabs = (width, look) => JSON.stringify([{ pos: width, align: 'right', ...(look.leader ? { leader: look.leader } : {}) }]);
/** A new look for the existing lines: their indent, the fill to the number and the bold main headings (the rest stays). */
function restyleTOC() {
  const run = tocRun(); if (!run) return;
  const look = tocLook(), width = Math.round(editor.view.dom.clientWidth / CM_PX * 100) / 100, tr = editor.state.tr, bold = editor.schema.marks.bold;
  run.nodes.forEach((n, k) => {
    let pos = run.from; for (let j = 0; j < k; j++) pos += run.nodes[j].nodeSize;
    const lvl = n.attrs.toc;
    tr.setNodeMarkup(pos, undefined, { ...n.attrs, indentLeft: tocIndent(lvl, look), tabStops: tocTabs(width, look) });
    if (lvl === 1 && bold) {
      let end = pos + 1; n.forEach((c, off) => { if (c.type.name === 'tab') end = pos + 1 + off; });
      if (end > pos + 1) { if (look.bold) tr.addMark(pos + 1, end, bold.create()); else tr.removeMark(pos + 1, end, bold); }
    }
  });
  editor.view.dispatch(tr);
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
  tpl = startTpl(); customTpl = null; docComments = []; docToc = null; $('#docTitle').value = 'Névtelen dokumentum'; setCurrentPath(null);
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
    setCurrentPath(null); customTpl = null; docComments = []; docToc = null;
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
  if (k === 'k' && $('#home').hidden && !hfEd) { e.preventDefault(); showPop('popLink', $('[data-pop="popMore"]')); return; }
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

