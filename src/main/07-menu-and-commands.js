/* ------------------------------------------------------------------ */
/* The app's own right-click menu (the web view's menu is switched off) */
/* ------------------------------------------------------------------ */
/** The icon in front of a menu item (by its text). */
const CTX_ICONS = [[/^Hivatkozás/, 'link'], [/^Nem törő/, 'para'], [/^Kivágás/, 'cut'], [/^Beillesztés/, 'paste'], [/^Mindent/, 'selAll'], [/^TeX-kód/, 'copy'], [/^Másolás/, 'copy'],
  [/^Megjegyzés/, 'comment'], [/^Bekezdés/, 'para'], [/^Tabulátor/, 'tabstop'], [/^Formátummásoló/, 'painter'], [/^Formázás törlése/, 'clear'],
  [/^Szint beljebb/, 'indent'], [/^Szint kijjebb/, 'outdent'], [/Számozás|Kezdő szám/, 'num'], [/beszúrása/, 'tblAdd'], [/^(Sor|Oszlop) törlése/, 'tblDel'],
  [/egyesítése/, 'merge'], [/^Cella kitöltése/, 'fill'], [/^Kép cseréje/, 'image'], [/^Felirat/, 'comment'], [/^A szöveg sorában/, 'inline'], [/^Külön sorban/, 'center'],
  [/^Körbefuttatás/, 'wrapL'], [/^Szöveg fölött/, 'front'], [/^Szöveg mögött/, 'back'], [/törlése$|^Törlés/, 'trash'], [/^Szerkesztés/, 'sigma'], [/Sortörés|Egy sorban/, 'wrapL']];
const ctxIcon = label => (CTX_ICONS.find(([re]) => re.test(label)) || [0, 'para'])[1];
function ctxItems(e) {
  const t = e.target.nodeType === 1 ? e.target : e.target.parentElement;
  const st = editor.state, sel = st.selection, items = [];
  const add = (label, fn, hint = '', on = true) => items.push({ label, fn, hint, on });
  const sep = title => items.push({ sep: true, title });
  // where was it clicked: formula, picture, table, list item
  const mathEl = t.closest('.math'), imgEl = t.closest('.imgw') || (sel.node && sel.node.type.name === 'image' ? editor.view.nodeDOM(sel.from) : null);
  const inTable = !!tableContext(st), inList = editor.isActive('listItem');
  const nodePos = el => { let at = null; st.doc.descendants((n, p) => { if (at == null && editor.view.nodeDOM(p) === el) at = p; }); return at; };
  if (mathEl) {
    const p = nodePos(mathEl), n = p != null ? st.doc.nodeAt(p) : null;
    sep('Képlet');
    add('Szerkesztés…', () => mathEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })), 'dupla kattintás');
    add('TeX-kód másolása', () => n && navigator.clipboard.writeText(n.attrs.tex).then(() => toast('TeX-kód a vágólapon')));
    add(n && n.attrs.wrap ? 'Egy sorban maradjon' : 'Sortörés a sor végén', () => { if (p != null) editor.view.dispatch(editor.state.tr.setNodeMarkup(p, undefined, { ...n.attrs, wrap: !n.attrs.wrap })); });
    add('Képlet törlése', () => { if (p != null) editor.view.dispatch(editor.state.tr.delete(p, p + n.nodeSize)); });
  } else if (imgEl && imgEl._kv) {
    const k = imgEl._kv, w = k.node().attrs.wrap;
    sep('Kép');
    add('Körbefuttatás', () => k.setWrap('wl'), w === 'wl' || w === 'wr' ? '✓' : '');
    add('Szöveg fölött', () => k.setWrap('over'), w === 'over' ? '✓' : '');
    add('Szöveg mögött', () => k.setWrap('under'), w === 'under' ? '✓' : '');
    add('Külön sorban', () => k.setWrap('ctr'), w === 'ctr' ? '✓' : '');
    add('A szöveg sorában', () => k.setWrap('inl'), w === 'inl' ? '✓' : '');
    add('Megjegyzés hozzáadása', () => { const p = nodePos(imgEl); if (p != null) editor.commands.setNodeSelection(p); openCommentBox(); });
    add('Kép cseréje…', () => pickImage(1600, url => { const p = nodePos(imgEl); if (p != null) { const n = editor.state.doc.nodeAt(p); editor.view.dispatch(editor.state.tr.setNodeMarkup(p, undefined, { ...n.attrs, src: url })); } }));
    add('Kép törlése', () => k.remove());
  } else {
    const hasSel = !sel.empty;
    add('Kivágás', () => { editor.view.focus(); document.execCommand('cut'); }, 'Ctrl/⌘+X', hasSel);
    add('Másolás', () => { editor.view.focus(); document.execCommand('copy'); }, 'Ctrl/⌘+C', hasSel);
    add('Beillesztés', async () => {
      editor.view.focus();
      try {
        const items2 = await navigator.clipboard.read();
        for (const it of items2) if (it.types.includes('text/html')) { const h = await (await it.getType('text/html')).text(); editor.view.pasteHTML(h); return; }
        const tx = await navigator.clipboard.readText(); editor.view.pasteText(tx);
      } catch (err) { try { editor.view.pasteText(await navigator.clipboard.readText()); } catch (e2) { toast('A beillesztéshez használd a Ctrl/⌘+V-t.'); } }
    }, 'Ctrl/⌘+V');
    add('Beillesztés formázás nélkül', async () => { editor.view.focus(); try { editor.view.pasteText(await navigator.clipboard.readText()); } catch (err) { toast('A beillesztéshez használd a Ctrl/⌘+Shift+V-t.'); } });
    add('Mindent kijelöl', () => { editor.view.focus(); editor.commands.selectAll(); }, 'Ctrl/⌘+A');
    add('Nem törő szóköz', () => { editor.chain().focus().insertContent('\u00a0').run(); }, 'Ctrl/⌘+Shift+Szóköz');
    if (editor.isActive('link')) add('Hivatkozás megnyitása', () => openLink(editor.getAttributes('link').href));
    add(editor.isActive('link') ? 'Hivatkozás szerkesztése…' : 'Hivatkozás…', () => showPop('popLink', $('[data-pop="popLink"]')), 'Ctrl/⌘+K');
    sep();
    add('Megjegyzés hozzáadása', () => openCommentBox(), '', hasSel);
    add('Bekezdés beállításai…', () => showPop('popPara', $('[data-pop="popPara"]')));
    add('Formázás törlése', () => COMMANDS.clearFormat ? COMMANDS.clearFormat() : ch().unsetAllMarks().run());
    add('Formátummásoló', () => COMMANDS.painter());
    if (inList) {
      sep('Lista');
      add('Szint beljebb', () => changeListLevel(editor.view, 1), 'Tab');
      add('Szint kijjebb', () => changeListLevel(editor.view, -1), 'Shift+Tab');
      if (editor.isActive('orderedList')) {
        add('Számozás újrakezdése', () => applyListAttrs('orderedList', { start: 1 }));
        add('Kezdő szám…', () => showPop('popNum', $('[data-pop="popNum"]')));
      }
    }
    if (inTable) {
      const c = tableContext(st);
      sep('Táblázat');
      add('Sor beszúrása fölé', () => tableCmd('addRowBefore'));
      add('Sor beszúrása alá', () => tableCmd('addRowAfter'));
      add('Oszlop beszúrása balra', () => tableCmd('addColumnBefore'));
      add('Oszlop beszúrása jobbra', () => tableCmd('addColumnAfter'));
      add('Sor törlése', () => tableCmd('deleteRow'));
      add('Oszlop törlése', () => tableCmd('deleteColumn'));
      add('Cellák egyesítése / felosztása', () => tableCmd('mergeOrSplit'));
      add(c && c.table.attrs.pin ? 'Vissza a szövegbe' : 'Szabad elhelyezés', () => { toggleTablePin(); updateToolbar(); });
      add('Cella kitöltése…', () => showPop('popCell', $('[data-pop="popCell"]')));
      add('Táblázat törlése', () => tableCmd('deleteTable'));
    }
  }
  return items;
}
function openCommentBox() { if (panelView() !== 'cmt') panelVisible(true, 'cmt'); setTimeout(() => $('#cmtText').focus(), 50); }
let ctxActions = [];
document.addEventListener('contextmenu', e => {
  const t = e.target.nodeType === 1 ? e.target : e.target.parentElement;
  if (t && t.closest('input, textarea, select')) return;                    // text boxes keep the system's copy / paste menu
  e.preventDefault();                                                       // never the web view's own (browser) menu
  if (!t || !t.closest('#editorHost')) return;                              // panels, top bar: no menu
  if (t.closest('.spell-err')) return;                                      // misspelled word: the spelling popup
  // a right-click outside the selection moves the cursor there first
  const hit = editor.view.posAtCoords({ left: e.clientX, top: e.clientY }), sel = editor.state.selection;
  if (hit && !t.closest('.imgw,.math') && (sel.empty || hit.pos < sel.from || hit.pos > sel.to)) editor.commands.setTextSelection(hit.pos);
  const items = ctxItems(e); ctxActions = items;
  const m = $('#ctxMenu');
  m.innerHTML = items.map((it, i) => it.sep ? (it.title ? `<div class="psep"></div><div class="ctitle">${it.title}</div>` : '<div class="psep"></div>') : `<button class="pitem" data-ci="${i}"${it.on ? '' : ' disabled'}><span class="cico">${svg(ctxIcon(it.label))}</span><span class="clbl">${it.label}</span><span class="phint">${it.hint || ''}</span></button>`).join('').replace(/^<div class="psep"><\/div>/, '');
  closePops();
  m.hidden = false;
  const W = m.offsetWidth, H = m.offsetHeight;
  m.style.left = Math.min(e.clientX, innerWidth - W - 6) + 'px'; m.style.top = Math.min(e.clientY, innerHeight - H - 6) + 'px';
  openPop = m; openAnchor = null;
}, true);
$('#ctxMenu').addEventListener('mousedown', e => e.preventDefault());       // the selection stays
$('#ctxMenu').addEventListener('click', e => {
  const b = e.target.closest('[data-ci]'); if (!b) return;
  const it = ctxActions[+b.dataset.ci]; closePops();
  if (it && it.fn) it.fn();
});

/* format painter: applied when the mouse is released over a selection */
function applyPainter() {
  const ed = editor, st = ed.state, { from, to, empty } = st.selection;
  if (!painter || empty) return;
  const tr = st.tr;
  const FORMAT = ['bold', 'italic', 'underline', 'strike', 'superscript', 'subscript', 'highlight', 'textStyle'];
  for (const n of FORMAT) { const t = st.schema.marks[n]; if (t) tr.removeMark(from, to, t); }
  for (const m of painter.marks) tr.addMark(from, to, m);
  st.doc.nodesBetween(from, to, (n, pos) => {
    if (n.type.name === 'paragraph' || n.type.name === 'heading') {
      if (painter.heading && n.type.name === 'paragraph') tr.setNodeMarkup(pos, st.schema.nodes.heading, { ...n.attrs, ...painter.para, level: painter.heading });
      else if (!painter.heading && n.type.name === 'heading') tr.setNodeMarkup(pos, st.schema.nodes.paragraph, { ...n.attrs, ...painter.para });
      else tr.setNodeMarkup(pos, undefined, { ...n.attrs, ...painter.para, ...(n.type.name === 'heading' ? { level: painter.heading || n.attrs.level } : {}) });
      return false;
    }
  });
  ed.view.dispatch(tr);
  if (painter.list) {                          // the list format: the selected items get it (a new list if needed)
    const L = painter.list;
    if (!ed.isActive(L.type)) ed.chain().focus()[L.type === 'bulletList' ? 'toggleBulletList' : 'toggleOrderedList']().run();
    applyListAttrs(L.type, { ...L.attrs });
  }
  painter = null; document.body.classList.remove('painting'); updateToolbar();
}
editor.view.dom.addEventListener('mouseup', () => { if (painter) setTimeout(applyPainter, 0); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && painter) { painter = null; document.body.classList.remove('painting'); updateToolbar(); } });

/* spell checking (Hunspell + Magyar Ispell, the same on every computer) */
queueMicrotask(() => { editor.registerPlugin(spellPlugin()); setSpellEnabled(editor.view, spellOn); });   // after the whole module is set up
let spellTarget = null;
editor.view.dom.addEventListener('contextmenu', e => {
  const el = e.target.closest && e.target.closest('.spell-err'); if (!el || !spellOn) return;
  e.preventDefault();
  const word = el.dataset.word || el.textContent;
  let from; try { from = editor.view.posAtDOM(el, 0); } catch (err) { return; }
  spellTarget = { word, from, to: from + word.length };
  const sg = suggestions(word);
  $('#spellList').innerHTML = (sg.length ? sg.map(w => `<button class="pitem" data-sug="${esc(w)}"><b>${esc(w)}</b></button>`).join('') : '<div class="phint">Nincs javaslat.</div>');
  $('#spellWord').textContent = `„${word}”`;
  closePops();
  const p = $('#popSpell'); p.hidden = false;
  p.style.left = Math.min(e.clientX, innerWidth - p.offsetWidth - 8) + 'px'; p.style.top = Math.min(e.clientY + 6, innerHeight - p.offsetHeight - 8) + 'px';
  openPop = p; openAnchor = el;
});
$('#popSpell').addEventListener('click', e => {
  const t = spellTarget; if (!t) return;
  const sug = e.target.closest('[data-sug]');
  if (sug) { const tr = editor.state.tr, marks = editor.state.doc.resolve(t.from + 1).marks(); tr.replaceWith(t.from, t.to, editor.state.schema.text(sug.dataset.sug, marks)); editor.view.dispatch(tr); }
  else if (e.target.closest('#spellAdd')) addToDictionary(t.word, editor.view);
  else if (e.target.closest('#spellIgnore')) ignoreWord(t.word, editor.view);
  else return;
  closePops(); editor.view.focus();
});

/* all matches are highlighted; the current one is shown and scrolled into the middle of the view */
const findKey = new PluginKey('find');
queueMicrotask(() => editor.registerPlugin(new Plugin({
  key: findKey,
  state: { init: () => DecorationSet.empty,
    apply(tr, old) { const m = tr.getMeta(findKey); if (m) return m.clear ? DecorationSet.empty : DecorationSet.create(tr.doc, m.all.map((x, i) => (x.math ? Decoration.node : Decoration.inline)(x.from, x.to, { class: i === m.cur ? 'find-hit cur' : 'find-hit' }))); return tr.docChanged ? DecorationSet.empty : old; } },
  props: { decorations(st) { return findKey.getState(st); } }
})));
function showFind(all, cur) {
  editor.view.dispatch(editor.state.tr.setMeta(findKey, { all, cur }).setMeta('addToHistory', false));
  const m = all[cur]; if (!m) return;
  requestAnimationFrame(() => {
    try {
      const c = editor.view.coordsAtPos(m.from), wr = ws.getBoundingClientRect();
      ws.scrollTo({ top: ws.scrollTop + (c.top - wr.top) - ws.clientHeight / 2, behavior: 'smooth' });
    } catch (e) { /* ignore */ }
  });
}
/* ---- find also in the headers and footers (search everywhere; replace in their text, never in formulas) ---- */
const HF_NAMES = { header: 'élőfejben', footer: 'élőlábban' }, HF_VARS = { odd: 'páratlan oldalak', even: 'páros oldalak', first: 'első oldal' };
/** Text matches inside one header / footer cell document (JSON): [{p (paragraph index), from, to}] in the run texts. */
function hfDocMatches(json, re) {
  const out = []; let pi = 0;
  (function walk(n) {
    if (n.type === 'paragraph' || n.type === 'heading') {
      const t = (n.content || []).map(c => c.type === 'text' ? c.text : '\ufffc').join('');
      re.lastIndex = 0; let m; while ((m = re.exec(t))) { if (!m[0]) { re.lastIndex++; continue; } out.push({ p: pi, from: m.index, to: m.index + m[0].length }); }
      pi++; return;
    }
    (n.content || []).forEach(walk);
  })(json || {});
  return out;
}
/** Every match in the headers / footers of the page types in use: [{kind, v, cell, k (its number in the cell)}]. */
function hfMatches(re) {
  const out = [];
  const vars = ['odd', ...(tpl.oddEven ? ['even'] : []), ...(tpl.firstDiff ? ['first'] : [])];
  for (const kind of ['header', 'footer']) for (const v of vars) for (const cell of ['l', 'c', 'r']) {
    const json = hfOpen && hfOpen.kind === kind && hfOpen.v === v ? (hfEds.find(e => e._cell === cell) || {}).getJSON?.() : (tpl[kind] && tpl[kind][v] && tpl[kind][v][cell]);
    hfDocMatches(json, re).forEach((m, k) => out.push({ kind, v, cell, k }));
  }
  return out;
}
let findHf = -1;                      // the header / footer match shown now (-1: in the text)
function showHfMatch(list, j, total, before) {
  const m = list[j]; findHf = j; clearFind();
  if (!hfOpen || hfOpen.kind !== m.kind || hfOpen.v !== m.v) editHF(m.kind, m.v, { cell: m.cell });
  const ed = hfEds.find(e => e._cell === m.cell); if (!ed) return;
  // the k-th match in this cell editor
  const re = findRegex(); let k = 0, hit = null;
  ed.state.doc.descendants((n, pos) => {
    if (hit || !n.isTextblock) return hit ? false : undefined;
    let run = '', at = 0;
    const flush = () => { if (run && !hit) { re.lastIndex = 0; let x; while ((x = re.exec(run))) { if (!x[0]) { re.lastIndex++; continue; } if (k++ === m.k) { hit = { from: at + x.index, to: at + x.index + x[0].length }; break; } } } run = ''; };
    n.forEach((c, off) => { if (c.isText) { if (!run) at = pos + 1 + off; run += c.text; } else flush(); });
    flush(); return false;
  });
  hfEd = ed;
  if (hit) ed.chain().focus().setTextSelection(hit).run();
  $('#findInfo').textContent = `${before + j + 1}. / ${total} találat – ${HF_NAMES[m.kind]} (${HF_VARS[m.v] || ''})`;
}
function clearFind() { const f = findKey.getState(editor.state); if (f && f !== DecorationSet.empty) editor.view.dispatch(editor.state.tr.setMeta(findKey, { clear: true })); }
let findAt = -1;
function findNext() {
  const re = findRegex(); if (!re) { clearFind(); return; }
  const all = findMatches(re), hf = hfMatches(re), total = all.length + hf.length;
  if (!total) { clearFind(); $('#findInfo').textContent = 'Nincs találat.'; return; }
  // after the last match in the text come the headers / footers, then the text again from its start
  if (findHf >= 0) {
    if (findHf + 1 < hf.length) { showHfMatch(hf, findHf + 1, total, all.length); return; }
    findHf = -1; findAt = -1;
    if (hfOpen) closeHF();
    if (!all.length) { showHfMatch(hf, 0, total, 0); return; }
    findAt = -2;                     // from the start of the text
  }
  if (!all.length) { showHfMatch(hf, 0, total, 0); return; }
  const from = findAt === -2 ? -1 : findAt >= 0 ? findAt : editor.state.selection.from;
  let i = all.findIndex(x => x.from > from);
  if (i < 0) { if (hf.length) { showHfMatch(hf, 0, total, all.length); return; } i = 0; }
  if (hfOpen) closeHF();
  findAt = all[i].from;
  editor.view.dispatch(editor.state.tr.setSelection(all[i].math ? NodeSelection.create(editor.state.doc, all[i].from) : TextSelection.create(editor.state.doc, all[i].from, all[i].to)));
  showFind(all, i);
  $('#findInfo').textContent = `${i + 1}. / ${total} találat` + (all[i].math ? ' – képletben (a csere a képleteket nem módosítja)' : '');
}
function replaceOne() {
  const re = findRegex(); if (!re) return;
  if (findHf >= 0 && hfEd) {                     // a match in the header / footer being edited
    const { from, to } = hfEd.state.selection, t = hfEd.state.doc.textBetween(from, to);
    re.lastIndex = 0; const m = from !== to && t.match(re);
    if (m && m[0] === t) { hfEd.chain().insertContentAt({ from, to }, $('#replIn').value).run(); findHf--; }
    findNext(); return;
  }
  const { from, to } = editor.state.selection, sel = editor.state.selection instanceof NodeSelection ? '' : editor.state.doc.textBetween(from, to);
  re.lastIndex = 0;
  if (from !== to && re.test(sel) && sel.match(re)[0] === sel) { editor.chain().insertContentAt({ from, to }, $('#replIn').value).run(); findAt = from - 1 + $('#replIn').value.length; }
  findNext();
}
function replaceAll() {
  const re = findRegex(); if (!re) return;
  const found = findMatches(re), all = found.filter(m => !m.math), inMath = found.length - all.length, tr = editor.state.tr, rep = $('#replIn').value;
  for (const m of all.reverse()) { const marks = editor.state.doc.resolve(m.from + 1).marks(); if (rep) tr.replaceWith(m.from, m.to, editor.state.schema.text(rep, marks)); else tr.delete(m.from, m.to); }
  if (all.length) editor.view.dispatch(tr);
  // the headers and footers: in their text runs (a formula there is not changed either)
  if (hfOpen) closeHF();
  let nHf = 0;
  const replIn = json => {
    (function walk(n) {
      if (n.content) for (const c of n.content) {
        if (c.type === 'text') { re.lastIndex = 0; const t = c.text.replace(re, () => { nHf++; return rep; }); c.text = t; }
        else walk(c);
      }
      if (n.content) n.content = n.content.filter(c => c.type !== 'text' || c.text);
    })(json || {});
  };
  for (const kind of ['header', 'footer']) for (const v of Object.keys(tpl[kind] || {})) for (const cell of ['l', 'c', 'r']) if (tpl[kind][v] && tpl[kind][v][cell]) replIn(tpl[kind][v][cell]);
  if (nHf) tplChanged();
  findHf = -1;
  const n = all.length + nHf;
  $('#findInfo').textContent = (n ? `${n} csere${nHf ? ` (ebből ${nHf} az élőfejben / élőlábban)` : ''}.` : inMath ? 'A szövegben nincs találat.' : 'Nincs találat.') + (inMath ? ` ${inMath} képlet változatlan maradt (bennük csak keresni lehet).` : '');
}
$('#findNext').onclick = findNext; $('#findRepl').onclick = replaceOne; $('#findAll').onclick = replaceAll;
$('#findIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); findNext(); } });
$('#findIn').addEventListener('input', () => {        // live highlighting while typing
  findAt = -1; findHf = -1; const re = findRegex(); if (!re) { clearFind(); $('#findInfo').textContent = ''; return; }
  const all = findMatches(re), nHf = hfMatches(re).length; if (!all.length && !nHf) { clearFind(); $('#findInfo').textContent = 'Nincs találat.'; return; }
  editor.view.dispatch(editor.state.tr.setMeta(findKey, { all, cur: -1 })); $('#findInfo').textContent = `${all.length + nHf} találat` + (nHf ? ` (ebből ${nHf} az élőfejben / élőlábban)` : '');
});
$('#findCase').addEventListener('change', () => $('#findIn').dispatchEvent(new Event('input')));
$('#popFind').onclose = () => { clearFind(); findAt = -1; };
$('#popFind').onopen = () => { const { from, to } = editor.state.selection; if (from !== to) $('#findIn').value = editor.state.doc.textBetween(from, to).slice(0, 80); $('#findInfo').textContent = ''; setTimeout(() => { $('#findIn').focus(); $('#findIn').select(); }); };

/* fonts (Matekos Prezi): the template's font set, or any family on the selected text */
registerAllFamilies();
{ const fams = allFamilies(), item = ([f, l]) => `<button class="pitem fitem" data-fam="${f}" style="font-family:${familyCSS(f)}">${l}</button>`;
  $('#fontMath').innerHTML = fams.math.map(item).join(''); $('#fontOther').innerHTML = fams.other.map(item).join(''); }
/** Font family at the cursor ('' = the template font). */
const currentFamily = () => { const ff = AE().getAttributes('textStyle').fontFamily; return ff ? (familyFromCSS(ff) || '') : ''; };
$('#popFont').onopen = () => { const f = currentFamily(); for (const b of $$('#popFont [data-fam]')) b.classList.toggle('on', b.dataset.fam === f); };
$('#popFont').addEventListener('click', e => {
  const b = e.target.closest('[data-fam]'); if (!b) return; closePops();
  const fam = b.dataset.fam;
  if (fam) loadTextFamily(fam).then(() => relayout(30));
  (fam ? ch().setFontFamily(familyCSS(fam)) : ch().unsetFontFamily()).run();
});
const setSize = v => { const p = parseFloat(String(v).replace(',', '.')); if (p > 0 && p < 500) ch().setFontSize(p + 'pt').run(); };
$('#sizeIn').addEventListener('change', e => setSize(e.target.value));
$('#sizeIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); setSize(e.target.value); } });
const SIZES = [8, 9, 10, 10.5, 11, 12, 13, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 48, 60, 72];
$('#sizeGrid').innerHTML = SIZES.map(v => `<button class="pitem" data-size="${v}">${String(v).replace('.', ',')}</button>`).join('');
$('#popSize').onopen = () => { const c = parseFloat(String($('#sizeIn').value).replace(',', '.')); for (const b of $('#sizeGrid').children) b.classList.toggle('on', +b.dataset.size === c); };
$('#sizeGrid').addEventListener('click', e => { const b = e.target.closest('[data-size]'); if (!b) return; closePops(); $('#sizeIn').value = b.textContent; setSize(b.dataset.size); });

/* popovers */
let openPop = null, openAnchor = null;
function rememberTable() { if (tblCtx) return; const c = tableContext(AE().state); tblCtx = c ? { pos: c.pos, rect: c.rect } : null; }
function showPop(id, anchor) {
  const p = $('#' + id);
  if (/^pop(Borders|Cell)$/.test(id)) rememberTable();
  if (openPop === p) return closePops();
  closePops();
  if (p.onopen) p.onopen();
  p.hidden = false;
  const r = anchor.getBoundingClientRect();
  p.style.left = Math.max(8, Math.min(r.left, innerWidth - p.offsetWidth - 8)) + 'px';
  let top = r.bottom + 6; if (top + p.offsetHeight > innerHeight - 8) top = Math.max(8, innerHeight - p.offsetHeight - 8);
  p.style.top = top + 'px';
  openPop = p; openAnchor = anchor;
}
function closePops() { if (openPop) { const p = openPop; p.hidden = true; openPop = null; openAnchor = null; if (p.onclose) p.onclose(); } }
document.addEventListener('pointerdown', e => { if (openPop && !openPop.contains(e.target) && !(openAnchor && openAnchor.contains(e.target))) closePops(); }, true);
for (const p of $$('.pop')) p.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });

/* colour pickers (Matekos Prezi): base colours, the document's own saved colours, any colour + eyedropper */
let docColors = [];                 // saved with the document
const pickers = [];
function swatches(box, colors, onPick, noneLabel) {
  box.className = 'cpicker';
  box.innerHTML = `<div class="swg">${colors.map(c => `<button class="sw" data-c="${c}" style="background:${c}" title="${c}" aria-label="${c}"></button>`).join('')}</div>
    <div class="libwrap" hidden><div class="ptitle">A dokumentum saját színei</div><div class="swg lib"></div></div>
    <div class="ccust"><button class="tb eyed" title="Pipetta: szín felvétele a képernyőről">${svg('eyedrop')}</button>
      <label class="sw custom" title="Egyéni szín választása"><input type="color" aria-label="Egyéni szín"></label>
      <span class="chex">#000000</span><span class="sp"></span>
      <button class="btn cok" disabled>OK</button><button class="btn csave" disabled title="Hozzáadás a dokumentum saját színeihez">Mentés</button></div>
    ${noneLabel ? `<button class="sw none" data-c="none">${noneLabel}</button>` : ''}`;
  const inp = box.querySelector('input[type=color]'), hex = box.querySelector('.chex'), ok = box.querySelector('.cok'), save = box.querySelector('.csave');
  const pending = c => { inp.value = c; hex.textContent = c; ok.disabled = save.disabled = false; };
  box.addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (del) { docColors = docColors.filter(c => c !== del.dataset.del); refreshPickers(); markDirty(); saveSoon(); e.stopPropagation(); return; }
    const b = e.target.closest('button[data-c]'); if (b) { onPick(b.dataset.c); closePops(); }
  });
  inp.addEventListener('input', () => pending(inp.value));
  inp.addEventListener('change', () => pending(inp.value));
  ok.onclick = () => { onPick(inp.value); closePops(); };
  save.onclick = () => { const c = inp.value.toLowerCase(); docColors = [...new Set([...docColors, c])]; refreshPickers(); markDirty(); saveSoon(); onPick(c); closePops(); };
  box.querySelector('.eyed').onclick = async () => {
    if (!window.EyeDropper) { toast('A pipetta ezen a gépen nem érhető el.'); return; }
    const pop = openPop, anchor = openAnchor;
    try { const r = await new window.EyeDropper().open(); if (pop && anchor && pop.hidden) showPop(pop.id, anchor); pending(r.sRGBHex); } catch (e) { /* cancelled */ }
  };
  pickers.push(box); refreshPickers();
}
function refreshPickers() {
  for (const box of pickers) {
    box.querySelector('.libwrap').hidden = !docColors.length;
    box.querySelector('.lib').innerHTML = docColors.map(c => `<span class="libsw"><button class="sw" data-c="${c}" style="background:${c}" title="${c}"></button><button class="del" data-del="${c}" title="Törlés a dokumentum színei közül">×</button></span>`).join('');
  }
}
swatches($('#swText'), ['#111111', '#5d6875', '#ffffff', '#da291c', '#c0392b', '#d35400', '#b7950b', '#1e8449', '#117a65', '#1f5f74', '#2e4a9e', '#7d3c98'], c => ch().setColor(c).run());
swatches($('#swHi'), ['#fff176', '#c5f0a4', '#b3ecf5', '#f8bbd0', '#ffd59e', '#e1bee7', '#e0e0e0'], c => c === 'none' ? ch().unsetHighlight().run() : ch().setHighlight({ color: c }).run(), 'Nincs kiemelés');
swatches($('#swShade'), ['#d9d9d9', '#dbe9ee', '#e8eef5', '#eaf4e4', '#fdf3d7', '#f9e1e1', '#ece6f5', '#eeeeee'], c => {
  const empty = AE().state.selection.empty;
  if (c === 'none') return ch().unsetMark('lineShade').setParaAttrs({ shade: null }).run();
  if (empty) {                                                // cursor only: just the line the cursor is in
    const r = currentLineRange();
    if (r) AE().chain().focus(null, { scrollIntoView: false }).setTextSelection(r).setMark('lineShade', { color: c }).setTextSelection(AE().state.selection.from).run();
    else ch().setParaAttrs({ shade: c }).run();               // empty paragraph: shade its (single) line
  } else ch().setMark('lineShade', { color: c }).run();       // selection: exactly the lines it touches
}, 'Nincs sorárnyék');
/* colour settings of the template panel: the same palette as the ribbon (with the document's colours) */
let anyColorCb = null;
swatches($('#swAny'), ['#111111', '#5d6875', '#9aa3ad', '#ffffff', '#da291c', '#c0392b', '#d35400', '#b7950b', '#1e8449', '#117a65', '#1f5f74', '#2e4a9e', '#7d3c98', '#d9d9d9', '#dbe9ee', '#e8eef5', '#eaf4e4', '#fdf3d7', '#f9e1e1', '#ece6f5'], c => anyColorCb && anyColorCb(c), 'Nincs');
$('#props').addEventListener('click', e => {
  const inp = e.target.closest('input[type=color]') || (e.target.closest('.colbtn') && e.target.closest('.colbtn').querySelector('input[type=color]'));
  if (!inp) return;
  e.preventDefault();
  const host = inp.closest('.colbtn') || inp, none = host.dataset && host.dataset.none;
  $('#anyColorTitle').textContent = (host.getAttribute('title') || 'Szín').replace(/\s*\(.*$/, '');
  $('#popAnyColor').classList.toggle('nonone', !none);
  const nb = $('#swAny .sw.none'); if (nb) nb.textContent = none || 'Nincs';
  anyColorCb = c => {
    if (c === 'none') { setPath(tpl, inp.dataset.k, ''); const dot = host.querySelector && host.querySelector('.dot'); if (dot) { dot.style.setProperty('--c', 'transparent'); dot.classList.add('none'); } tplChanged(); return; }
    inp.value = c; const dot = host.querySelector && host.querySelector('.dot'); if (dot) dot.classList.remove('none');
    inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true }));
  };
  showPop('popAnyColor', host);
}, true);
swatches($('#swCell'), ['#da291c', '#e8eef5', '#eaf4e4', '#fdf3d7', '#f9e1e1', '#ece6f5', '#eeeeee', '#d6e4f0'], c => forCells('cells', () => ({ background: c === 'none' ? null : c })), 'Nincs kitöltés');

/* letter spacing (Prezi) */
const spR = $('#spacingR'), spN = $('#spacingIn');
function setSpacing(v, final) {
  if (!isFinite(v)) return;
  v = Math.round(v * 10) / 10;
  if (!final) return;
  (v ? AE().chain().focus().setLetterSpacing(v + 'pt') : AE().chain().focus().unsetLetterSpacing()).run();
}
spR.oninput = () => { spN.value = spR.value; };
spR.onchange = () => setSpacing(+spR.value, true);
spN.onchange = () => { const v = parseFloat(String(spN.value).replace(',', '.')); if (!isFinite(v)) return; spR.value = v; setSpacing(v, true); };
$('#popSpacing').onopen = () => { const ls = AE().getAttributes('textStyle').letterSpacing; spR.value = spN.value = ls ? parseFloat(ls) : 0; };

/* bullets, numbering */
const BUL = ['•', '◦', '▪', '–', '➤', '➔', '✓', '★', '◆', '❖', '☐', '→'];
$('#bulGrid').innerHTML = BUL.map(b => `<button data-bul="${b}" aria-label="${b}">${b}</button>`).join('')
  + `<button data-bulimg="matekos" title="Matekos végtelen jel" aria-label="Matekos végtelen jel"><img src="${MATEKOS_BULLET}" alt="" style="height:.7em"></button>`;
/* Lists: a change of symbol / numbering on only some items starts a new list for exactly those items */
function listAround(state, typeName) {
  const { $from, $to } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === typeName) {
      const pos = $from.before(d);
      if ($to.pos > pos + n.nodeSize) return null;
      let b = n.childCount - 1;
      const $t = state.doc.resolve(Math.min($to.pos, pos + n.nodeSize - 1));
      for (let e = $t.depth; e > 0; e--) if ($t.node(e) === n) { b = $t.index(e); break; }
      return { node: n, pos, a: $from.index(d), b };
    }
  }
  return null;
}
function applyListAttrs(typeName, attrs) {
  const ed = AE();
  if (!ed.isActive(typeName)) { ed.chain().focus()[typeName === 'bulletList' ? 'toggleBulletList' : 'toggleOrderedList']().run(); }
  const st = ed.state, r = listAround(st, typeName);
  if (!r) return;
  const { node, pos, a, b } = r, ordered = typeName === 'orderedList';
  const own = ordered && 'start' in attrs ? { cont: false } : {};        // a start number set here: numbering starts again
  if (a === 0 && b === node.childCount - 1) { ed.chain().focus().updateAttributes(typeName, { ...attrs, ...own }).run(); return; }
  const items = []; node.forEach(c => items.push(c));
  const parts = [];
  if (a > 0) parts.push(node.type.create(node.attrs, items.slice(0, a)));
  parts.push(node.type.create({ ...node.attrs, ...(ordered ? { start: 1, cont: false } : {}), ...attrs }, items.slice(a, b + 1)));
  // the items after it keep counting on (from the last list of their own numbering style on this level)
  if (b < items.length - 1) parts.push(node.type.create({ ...node.attrs, ...(ordered ? { cont: true } : {}) }, items.slice(b + 1)));
  const tr = st.tr.replaceWith(pos, pos + node.nodeSize, parts);
  ed.view.dispatch(tr.scrollIntoView()); ed.view.focus();
}
function setBullet(attrs) { applyListAttrs('bulletList', attrs); }
/** "1. a) …": the current line becomes the first item of a list inside the current item, on the same line. */
function nestSameLine(numStyle) {
  const ed = AE(), st = ed.state, { $from } = st.selection;
  let d = $from.depth; while (d > 0 && $from.node(d).type.name !== 'listItem') d--;
  if (d <= 0) { ed.chain().focus().toggleOrderedList().updateAttributes('orderedList', { numStyle }).run(); return; }
  const li = $from.node(d), liPos = $from.before(d), i = $from.index(d), S = st.schema.nodes;
  const kids = []; li.forEach(c => kids.push(c));
  const inner = S.orderedList.create({ numStyle, start: 1 }, [S.listItem.create(null, kids.slice(i))]);
  const content = i === 0 ? [S.paragraph.create(), inner] : [...kids.slice(0, i), inner];
  const tr = st.tr.replaceWith(liPos, liPos + li.nodeSize, S.listItem.create({ ...li.attrs, sameLine: i === 0 }, content));
  // cursor: same place, now inside the inner list
  const off = $from.pos - $from.start(d + 1);
  let target = liPos + 1 + (i === 0 ? 2 : kids.slice(0, i).reduce((x, n) => x + n.nodeSize, 0)) + 1 + 1 + 1 + off;
  try { tr.setSelection(TextSelection.create(tr.doc, Math.min(target, tr.doc.content.size))); } catch (e) { /* keep */ }
  ed.view.dispatch(tr.scrollIntoView()); ed.view.focus();
}
$('#popBullet').addEventListener('click', e => {
  if (e.target.closest('[data-bulimg]')) { closePops(); setBullet({ bulletImage: MATEKOS_BULLET, bulletChar: '', bulletSize: 0.7 }); return; }
  const b = e.target.closest('[data-bul]'); if (!b) return;
  closePops();
  if (b.dataset.bul === 'none') { if (AE().isActive('bulletList')) ch().toggleBulletList().run(); return; }
  setBullet({ bulletChar: b.dataset.bul, bulletImage: '' });
});
$('#popBullet').onopen = () => { const a = AE().isActive('bulletList') ? AE().getAttributes('bulletList') : null;
  $('#bulPicOk').disabled = !(bulPicPending || (a && a.bulletImage)); if (a && a.bulletImage) $('#bulPicSize').value = a.bulletSize || 0.9;
  for (const b of $$('#popBullet [data-bul]')) b.classList.toggle('on', !!a && !a.bulletImage && b.dataset.bul === (a.bulletChar || '')); };
$('#bulCustomBtn').addEventListener('click', () => { const v = $('#bulCustom').value.trim(); if (v) { closePops(); setBullet({ bulletChar: v, bulletImage: '' }); } });
$('#bulCustom').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#bulCustomBtn').click(); } });
let bulPicPending = null;          // a chosen picture, used only when OK is pressed
$('#bulPicBtn').addEventListener('click', () => pickImage(512, url => { bulPicPending = url; $('#bulPicPrev').innerHTML = `<img src="${url}" alt="">`; $('#bulPicOk').disabled = false; }));
$('#bulPicOk').addEventListener('click', () => {
  const a = AE().isActive('bulletList') ? AE().getAttributes('bulletList') : {};
  const url = bulPicPending || a.bulletImage; if (!url) return;
  closePops(); setBullet({ bulletImage: url, bulletChar: '', bulletSize: +$('#bulPicSize').value || 0.9 }); bulPicPending = null; $('#bulPicPrev').innerHTML = '';
});
$('#popNum').addEventListener('click', e => {
  const n = e.target.closest('[data-nest]'); if (n) { closePops(); nestSameLine(n.dataset.nest); return; }
  const b = e.target.closest('[data-num]'); if (!b) return; closePops();
  if (b.dataset.num === 'none') { if (AE().isActive('orderedList')) ch().toggleOrderedList().run(); return; }
  applyListAttrs('orderedList', { numStyle: b.dataset.num });
});
$('#nestOther').addEventListener('change', e => { const v = e.target.value; e.target.value = ''; if (v) { closePops(); nestSameLine(v); } });
$('#numStartOk').addEventListener('click', () => { const v = parseInt($('#numStart').value, 10); if (!(v >= 0)) return; closePops(); applyListAttrs('orderedList', { start: v }); });
$('#numStart').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#numStartOk').click(); } });
$('#popNum').onopen = () => { const on = AE().isActive('orderedList'), a = on ? AE().getAttributes('orderedList') : {};
  const st = on ? (a.numStyle || listDefaults.num) : null;
  for (const b of $$('#popNum [data-num]')) b.classList.toggle('on', b.dataset.num === st);
  $('#numStart').value = on ? (a.start ?? 1) : 1; };

/* line spacing (Prezi: list + own value) */
const LH = [1, 1.15, 1.25, 1.5, 2, 2.5];
$('#lineList').innerHTML = LH.map(v => `<button class="pitem" data-lh="${v}">${String(v).replace('.', ',')}</button>`).join('');
function lineOpen() {
  const a = AE().isActive('heading') ? AE().getAttributes('heading') : AE().getAttributes('paragraph');
  const v = a.lineHeight ? +a.lineHeight : tpl.styles[AE().isActive('heading') ? 'h' + AE().getAttributes('heading').level : 'p'].line;
  for (const b of $('#lineList').children) b.classList.toggle('on', +b.dataset.lh === v);
  $('#lhIn').value = String(v).replace('.', ',');            // always the value in effect
}
$('#lineList').addEventListener('click', e => { const b = e.target.closest('[data-lh]'); if (!b) return; closePops(); ch().setParaAttrs({ lineHeight: +b.dataset.lh }).run(); });
$('#lhOk').onclick = () => { const v = parseFloat(String($('#lhIn').value).replace(',', '.')); if (!(v >= 0.5 && v <= 5)) return; closePops(); ch().setParaAttrs({ lineHeight: Math.round(v * 100) / 100 }).run(); };
$('#lhIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#lhOk').click(); } });

/* paragraph: indents, first line / hanging, spacing (Prezi) */
$('#popPara').onopen = () => {
  lineOpen();
  const a = AE().isActive('heading') ? AE().getAttributes('heading') : AE().getAttributes('paragraph');
  const sk = AE().isActive('heading') ? 'h' + AE().getAttributes('heading').level : 'p';
  for (const inp of $$('#popPara [data-pf]')) {
    const k = inp.dataset.pf;
    if (k === 'keepNext') inp.checked = a.keepNext ?? !!(tpl.styles[sk] && tpl.styles[sk].keepNext);
    else if (k === 'ctx') inp.checked = a.ctx ?? (AE().isActive('listItem') ? !!tpl.lists.contextual : !!(tpl.styles[sk] && tpl.styles[sk].contextual));
    else if (inp.type === 'checkbox') inp.checked = !!a[k];
    else {      // the value in effect: set on the paragraph, or the style's (never an empty box)
      const st = AE().isActive('listItem') && !AE().isActive('heading') ? { ...tpl.styles.p, indentLeft: 0, firstLine: 0 } : tpl.styles[sk] || {};
      const fromStyle = { indentLeft: st.indentLeft, indentRight: st.indentRight, spaceBefore: st.spaceBefore, spaceAfter: st.spaceAfter }[k];
      inp.value = a[k] ?? (fromStyle ?? 0);
    }
  }
  const lst = listAroundAny(AE().state);
  // a list item always hangs: the room of its symbol (as wide as the list's widest symbol needs) – shown with its value
  let listHang = 0;
  if (lst && AE().isActive('listItem')) {
    let room = +lst.node.attrs.gap || 0;
    try { const el = AE().view.nodeDOM(lst.pos), px = el && parseFloat(getComputedStyle(el).getPropertyValue('--gap')); if (px > 0) room = Math.max(room, px / (96 / 2.54)); } catch (e) { /* the setting only */ }
    listHang = Math.round(((room || 0.8) + (+a.hang || 0)) * 100) / 100;
  }
  const hang = listHang || (lst && lst.node.attrs.gap) || a.hang || (a.firstLine < 0 ? -a.firstLine : 0);
  const fl = a.firstLine ?? (AE().isActive('listItem') ? 0 : (tpl.styles[sk] || {}).firstLine || 0);
  const hang2 = hang || (fl < 0 ? -fl : 0);
  $('#pfFirstKind').value = hang2 ? 'hang' : fl > 0 ? 'first' : 'none';
  $('#pfFirstVal').value = hang2 || (fl > 0 ? fl : 0);
};
/** The outermost list around the cursor. */
function listAroundAny(state) {
  const $f = state.selection.$from;
  for (let d = 1; d <= $f.depth; d++) if (/List$/.test($f.node(d).type.name)) return { node: $f.node(d), pos: $f.before(d) };
  return null;
}
function applyFirstLine() {
  const kind = $('#pfFirstKind').value, v = Math.max(0, parseFloat(String($('#pfFirstVal').value).replace(',', '.')) || 0);
  const { state } = editor, tr = state.tr;
  const outer = listAroundAny(state);
  if (outer && (kind === 'hang' || (outer.node.attrs.gap && kind === 'none'))) {
    // a list: the same symbol-to-text gap on every level; the inner symbols stand where the outer text starts
    tr.setNodeMarkup(outer.pos, undefined, { ...outer.node.attrs, gap: kind === 'hang' && v ? v : null });
    outer.node.descendants((n, rel) => { if (n.type.name === 'paragraph' && (n.attrs.hang || n.attrs.firstLine)) tr.setNodeMarkup(outer.pos + 1 + rel, undefined, { ...n.attrs, hang: null, firstLine: null }); });
    editor.view.dispatch(tr); return;
  }
  let { from, to } = state.selection;
  if (kind === 'hang') {             // in a list: every level of the whole list gets the same hanging indent
    const $f = state.doc.resolve(from);
    for (let d = 1; d <= $f.depth; d++) if (/List$/.test($f.node(d).type.name)) { from = $f.before(d); to = from + $f.node(d).nodeSize; break; }
  }
  state.doc.nodesBetween(from, to, (n, pos) => {
    if (n.type.name !== 'paragraph' && n.type.name !== 'heading') return;
    const inList = state.doc.resolve(pos).parent.type.name === 'listItem', a = n.attrs;
    const oldHang = a.firstLine < 0 ? -a.firstLine : 0, base = Math.max(0, (a.indentLeft || 0) - oldHang) || null;
    let na;
    if (kind === 'none' || !v) na = { firstLine: null, hang: null, indentLeft: base };
    else if (kind === 'first') na = { firstLine: v, hang: null, indentLeft: base };
    else if (inList && n.type.name === 'paragraph') na = { hang: v, firstLine: null, indentLeft: base };   // list: more room after the symbol
    else na = { firstLine: -v, hang: null, indentLeft: (base || 0) + v };
    tr.setNodeMarkup(pos, undefined, { ...a, ...na });
  });
  AE().view.dispatch(tr);
}
$('#pfFirstKind').addEventListener('change', applyFirstLine);
/* tab stops of the selected paragraphs */
/** The stops of the selected paragraph: its own, or – when it has none – those of its paragraph style in the template. */
function tabInfo() {
  const head = AE().isActive('heading'), a = head ? AE().getAttributes('heading') : AE().getAttributes('paragraph');
  if (a.tabStops === 'hf') return { list: [], fromTpl: false };
  if (a.tabStops) { try { return { list: JSON.parse(a.tabStops), fromTpl: false }; } catch (e) { return { list: [], fromTpl: false }; } }
  const k = head ? 'h' + (a.level || 1) : 'p', st = hfEd ? null : (tpl.styles[k] || {}).tabs;
  return st && st.length ? { list: st.map(x => ({ ...x })), fromTpl: true } : { list: [], fromTpl: false };
}
const curTabs = () => tabInfo().list;
const AL = { left: 'balra', center: 'középre', right: 'jobbra' }, LD = { dot: ', pontozott', line: ', vonallal' };
let tabEditing = -1;                 // the row being edited in the popup
function showTabs() {
  const { list: t, fromTpl } = tabInfo();
  $('#tabFromTpl').hidden = !fromTpl;
  const lead = v => `<option value=""${!v ? ' selected' : ''}>üres</option><option value="dot"${v === 'dot' ? ' selected' : ''}>pont</option><option value="line"${v === 'line' ? ' selected' : ''}>vonal</option>`;
  $('#tabList').innerHTML = t.length ? t.map((x, i) => i === tabEditing
    ? `<div class="tabrow editing"><input type="number" step="0.25" min="0.25" class="tabEdPos" value="${x.pos}" aria-label="Pozíció (cm)"><span class="unit">cm</span><select class="tabEdLead" aria-label="Kitöltés">${lead(x.leader)}</select><button class="btn primary" data-oktab="${i}">OK</button></div>`
    : `<div class="tabrow${fromTpl ? ' tpl' : ''}"><span>${String(x.pos).replace('.', ',')} cm – ${AL[x.align] || 'balra'}${LD[x.leader] || ''}${fromTpl ? ' (sablon)' : ''}</span><span class="tabbtns"><button class="tb mini" data-edtab="${i}" title="Pozíció és kitöltés módosítása">${svg('edit')}</button><button class="tb mini" data-deltab="${i}" title="Tabulátor törlése">✕</button></span></div>`).join('')
    : '<div class="phint" style="margin:2px 0 4px">Nincs tabulátor.</div>';
  const inp = $('#tabList .tabEdPos'); if (inp) { inp.focus(); inp.select(); }
}
/** The stops of the selected paragraphs (an empty list over the template's stops: none here, on purpose). */
function setTabs(list) {
  const fromTpl = tabInfo().fromTpl; tabEditing = -1;
  list.sort((a, b) => a.pos - b.pos);
  AE().chain().setParaAttrs({ tabStops: list.length ? JSON.stringify(list) : (fromTpl ? '[]' : null) }).run(); showTabs(); relayout(0);
}
function okTabEdit(i) {
  const row = $('#tabList .tabrow.editing'); if (!row) return;
  const v = parseFloat(String(row.querySelector('.tabEdPos').value).replace(',', '.')), lead = row.querySelector('.tabEdLead').value;
  if (!(v > 0 && v < 60)) { row.querySelector('.tabEdPos').focus(); return; }
  const t = curTabs(), old = t[i]; if (!old) return;
  const { leader, ...rest } = old;
  t.splice(i, 1);
  setTabs([...t.filter(x => x.pos !== v), { ...rest, pos: v, ...(lead ? { leader: lead } : {}) }]);
}
$('#tabAdd').addEventListener('click', () => { const v = parseFloat(String($('#tabPos').value).replace(',', '.')); if (!(v > 0 && v < 60)) return; setTabs([...curTabs().filter(x => x.pos !== v), { pos: v, align: $('#tabAlign').value, ...($('#tabLeader').value ? { leader: $('#tabLeader').value } : {}) }]); $('#tabPos').value = ''; });
$('#popTabs').onopen = () => { tabEditing = -1; showTabs(); };
$('#tabRightMargin').addEventListener('click', () => {      // right tab exactly at the right margin (width of the text column)
  const v = Math.round(editor.view.dom.clientWidth / (96 / 2.54) * 100) / 100;
  setTabs([...curTabs().filter(x => Math.abs(x.pos - v) > 0.01), { pos: v, align: 'right', ...($('#tabLeader').value ? { leader: $('#tabLeader').value } : {}) }]);
});
$('#tabList').addEventListener('click', e => {
  const ed = e.target.closest('[data-edtab]'); if (ed) { tabEditing = +ed.dataset.edtab; showTabs(); return; }
  const ok = e.target.closest('[data-oktab]'); if (ok) { okTabEdit(+ok.dataset.oktab); return; }
  const b = e.target.closest('[data-deltab]'); if (!b) return; const t = curTabs(); t.splice(+b.dataset.deltab, 1); setTabs(t);
});
$('#tabList').addEventListener('keydown', e => {
  if (!e.target.closest('.tabrow.editing')) return;
  if (e.key === 'Enter') { e.preventDefault(); okTabEdit(tabEditing); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); tabEditing = -1; showTabs(); }
});
/* margin-to-margin line above / below the paragraph */
let ruleW = 0.5, ruleC = '#111111';
$('#ruleW').addEventListener('click', e => { const b = e.target.closest('[data-rw]'); if (!b) return; ruleW = +b.dataset.rw; for (const x of $$('#ruleW [data-rw]')) x.classList.toggle('on', x === b); });
$('#popRule').addEventListener('click', e => {
  const b = e.target.closest('[data-rule]'); if (!b) return;
  const a = AE().isActive('heading') ? AE().getAttributes('heading') : AE().getAttributes('paragraph'), val = `${ruleW} ${ruleC}`;
  if (b.dataset.rule === 'none') AE().chain().focus().setParaAttrs({ ruleTop: null, ruleBottom: null }).run();
  else if (b.dataset.rule === 'top') AE().chain().focus().setParaAttrs({ ruleTop: a.ruleTop ? null : val }).run();
  else AE().chain().focus().setParaAttrs({ ruleBottom: a.ruleBottom ? null : val }).run();
  closePops();
});
$('#popRule').onopen = () => { const a = AE().isActive('heading') ? AE().getAttributes('heading') : AE().getAttributes('paragraph');
  $('[data-rule="top"]').classList.toggle('on', !!a.ruleTop); $('[data-rule="bottom"]').classList.toggle('on', !!a.ruleBottom); };
swatches($('#swRule'), ['#111111', '#5d6875', '#9aa3ad', '#da291c', '#1f5f74', '#2e4a9e', '#1e8449'], c => { ruleC = c === 'none' ? '#111111' : c; showPop('popRule', $('[data-pop="popRule"]')); });
$('#pfFirstVal').addEventListener('change', applyFirstLine);
$('#popPara').addEventListener('change', e => {
  const k = e.target.dataset.pf; if (!k) return;
  const v = e.target.type === 'checkbox' ? e.target.checked : (e.target.value === '' ? null : +e.target.value);
  AE().chain().setParaAttrs({ [k]: v }).run();
});
const tg = $('#tgrid');
for (let r = 1; r <= 8; r++) for (let c = 1; c <= 8; c++) { const d = document.createElement('button'); d.className = 'tc'; d.dataset.r = r; d.dataset.c = c; d.setAttribute('aria-label', r + ' × ' + c); tg.appendChild(d); }
const hl = (r, c) => { for (const d of tg.children) d.classList.toggle('on', +d.dataset.r <= r && +d.dataset.c <= c); $('#tlabel').textContent = r ? r + ' × ' + c + ' táblázat' : 'Válassz méretet'; };
tg.addEventListener('pointerover', e => { const d = e.target.closest('.tc'); if (d) hl(+d.dataset.r, +d.dataset.c); });
tg.addEventListener('click', e => { const d = e.target.closest('.tc'); if (d) { closePops(); ch().insertTable({ rows: +d.dataset.r, cols: +d.dataset.c, withHeaderRow: false }).run(); } });
$('#popTable').onopen = () => hl(0, 0);
for (const id of ['#popTblIns', '#popTblDel']) $(id).addEventListener('click', e => {
  const b = e.target.closest('[data-tbl]'); if (!b) return;
  closePops();
  tableCmd(b.dataset.tbl);
});
/** Table commands; a new row / column takes over the look of the one next to it (fill, borders, text position,
 *  paragraph formatting, row height). */
function tableCmd(cmd) {
  const before = tableContext(editor.state);
  editor.chain().focus()[cmd]().run();
  if (!before || !/^add(Row|Column)(Before|After)$/.test(cmd)) return;
  const c = tableContext(editor.state); if (!c) return;
  const { map, table, start } = c, isRow = cmd.startsWith('addRow'), after = cmd.endsWith('After');
  const newIdx = isRow ? (after ? before.rect.bottom : before.rect.top) : (after ? before.rect.right : before.rect.left);
  const srcIdx = after ? newIdx - 1 : newIdx + 1;
  const tr = editor.state.tr, done = new Set();
  const n = isRow ? map.width : map.height;
  for (let k = 0; k < n; k++) {
    const [r, cc, rs, cs] = isRow ? [newIdx, k, srcIdx, k] : [k, newIdx, k, srcIdx];
    if (r >= map.height || cc >= map.width || rs < 0 || cs < 0 || rs >= map.height || cs >= map.width) continue;
    const relN = map.map[r * map.width + cc], relS = map.map[rs * map.width + cs];
    if (relN === relS || done.has(relN)) continue; done.add(relN);
    const nCell = table.nodeAt(relN), sCell = table.nodeAt(relS); if (!nCell || !sCell) continue;
    const keep = { colspan: nCell.attrs.colspan, rowspan: nCell.attrs.rowspan, colwidth: nCell.attrs.colwidth };
    tr.setNodeMarkup(tr.mapping.map(start + relN), undefined, { ...sCell.attrs, ...keep });
    const sp = sCell.firstChild, np = nCell.firstChild;
    if (sp && np && np.type === sp.type) tr.setNodeMarkup(tr.mapping.map(start + relN + 1), undefined, { ...sp.attrs });
  }
  if (isRow) {                                   // the same row height
    let oN = null, oS = null; table.forEach((row, o, i) => { if (i === newIdx) oN = [o, row]; if (i === srcIdx) oS = [o, row]; });
    if (oN && oS) tr.setNodeMarkup(tr.mapping.map(start + oN[0]), undefined, { ...oN[1].attrs, height: oS[1].attrs.height });
  }
  if (tr.docChanged) editor.view.dispatch(tr);
}

/** The document range of the visual line the cursor is in. */
function currentLineRange() {
  const v = editor.view, sel = editor.state.selection, $p = sel.$from;
  if (!$p.parent.isTextblock || !$p.parent.content.size) return null;
  const k = v.coordsAtPos(sel.from), y = (k.top + k.bottom) / 2;
  const blk = v.nodeDOM($p.before());
  if (!blk || !blk.getBoundingClientRect) return null;
  const br = blk.getBoundingClientRect();
  const a = v.posAtCoords({ left: br.left + 1, top: y }), b = v.posAtCoords({ left: br.right - 1, top: y });
  const lo = $p.start(), hi = $p.end();
  const from = Math.max(lo, Math.min(hi, a ? a.pos : lo)), to = Math.max(lo, Math.min(hi, b ? b.pos : hi));
  return to > from ? { from, to } : null;
}

/* table tools */
function curTable() {
  if (tblCtx) {
    const table = editor.state.doc.nodeAt(tblCtx.pos);
    if (table && table.type.name === 'table') return { table, pos: tblCtx.pos, start: tblCtx.pos + 1, map: TableMap.get(table), rect: tblCtx.rect };
  }
  return tableContext(editor.state);
}
function reselectCells(c) {
  try {
    const { map, rect, start, table } = c;
    const pa = start + map.positionAt(rect.top, rect.left, table), pb = start + map.positionAt(rect.bottom - 1, rect.right - 1, table);
    if (pa !== pb) editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, pa, pb)));
  } catch (e) { /* ignore */ }
}
// scope: 'cells' = selected cells, 'cols' = selected columns in every row, 'table' = whole table
function forCells(scope, fn) {
  const c = curTable(); if (!c) return;
  const { map, rect, start, table } = c;
  const r = scope === 'table' ? { left: 0, top: 0, right: map.width, bottom: map.height }
    : scope === 'cols' ? { left: rect.left, right: rect.right, top: 0, bottom: map.height } : rect;
  const tr = editor.state.tr, seen = new Set();
  for (let row = r.top; row < r.bottom; row++) for (let col = r.left; col < r.right; col++) {
    const rel = map.map[row * map.width + col];
    if (seen.has(rel)) continue; seen.add(rel);
    const node = table.nodeAt(rel);
    const attrs = fn(node, row, col);
    if (attrs) tr.setNodeMarkup(start + rel, undefined, { ...node.attrs, ...attrs });
  }
  editor.view.dispatch(tr);
  reselectCells(curTable());
}
function fillTableFields() {
  const c = curTable(); if (!c) return;
  const act = document.activeElement;
  if (act !== $('#tpWidth')) $('#tpWidth').value = c.table.attrs.width || 100;
  // always the value in effect (also when it is automatic): measured on the page
  const r1 = n => Math.round(n * 10) / 10;
  const rowIdx = Math.min(c.rect.top, c.table.childCount - 1), row = c.table.child(rowIdx);
  let rowOff = 0; c.table.forEach((r, o, i) => { if (i === rowIdx) rowOff = o; });
  const rowDom = editor.view.nodeDOM(c.start + rowOff);
  if (act !== $('#tpRowH')) $('#tpRowH').value = row.attrs.height || (rowDom ? r1(rowDom.getBoundingClientRect().height / scale / MM) : '');
  const cellRel = c.map.map[c.rect.top * c.map.width + c.rect.left], cell = c.table.nodeAt(cellRel), cellDom = editor.view.nodeDOM(c.start + cellRel);
  if (act !== $('#tpColW')) $('#tpColW').value = cell && cell.attrs.colwidth && cell.attrs.colwidth[0] ? r1(cell.attrs.colwidth[0] / MM) : (cellDom ? r1(cellDom.getBoundingClientRect().width / scale / MM) : '');
  const ccs = cellDom ? getComputedStyle(cellDom) : null;
  $('#tblPin').classList.toggle('on', !!c.table.attrs.pin);
  for (const b of $$('#tableBar [data-talign]')) b.disabled = !!c.table.attrs.pin;   // alignment means nothing for a free table
  if (act !== $('#tpPadV')) $('#tpPadV').value = c.table.attrs.padV ?? (ccs ? r1(parseFloat(ccs.paddingTop) / MM) : '');
  if (act !== $('#tpPadH')) $('#tpPadH').value = c.table.attrs.padH ?? (ccs ? r1(parseFloat(ccs.paddingLeft) / MM) : '');
  for (const b of $$('#tableBar [data-talign]')) b.classList.toggle('on', (c.table.attrs.align || 'left') === b.dataset.talign);
}
for (const [id, k] of [['#tpPadV', 'padV'], ['#tpPadH', 'padH']]) $(id).addEventListener('change', e => {
  const v = e.target.value === '' ? null : Math.max(0, Math.min(20, parseFloat(String(e.target.value).replace(',', '.')) || 0));
  setTableAttrs({ [k]: v });
});
for (const id of ['#tpWidth', '#tpRowH', '#tpColW', '#tpPadV', '#tpPadH']) {
  $(id).addEventListener('focus', rememberTable);
  $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.dispatchEvent(new Event('change')); } });
}
function setTableAttrs(attrs) {
  const c = curTable(); if (!c) return;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(c.pos, undefined, { ...c.table.attrs, ...attrs }));
  reselectCells(curTable());
}
$('#tpWidth').addEventListener('change', e => {
  const pct = Math.max(10, Math.min(100, +e.target.value || 100));
  const c = curTable(); if (!c) return;
  const tr = editor.state.tr;
  tr.setNodeMarkup(c.pos, undefined, { ...c.table.attrs, width: pct === 100 ? null : pct });
  // if every column has a fixed width, scale them so the table gets the requested width
  const cells = []; let all = true, sum = 0;
  c.table.firstChild.forEach(cell => { const w = cell.attrs.colwidth; if (!w || !w[0]) all = false; else sum += w.reduce((x, y) => x + (y || 0), 0); });
  if (all && sum > 0) {
    const k = (editor.view.dom.clientWidth * pct / 100) / sum;
    c.table.descendants((n, rel) => { if (n.type.spec.tableRole && n.type.spec.tableRole.includes('cell') && n.attrs.colwidth) cells.push([rel, n]); return !n.type.spec.tableRole || !n.type.spec.tableRole.includes('cell'); });
    for (const [rel, n] of cells) tr.setNodeMarkup(c.start + rel, undefined, { ...n.attrs, colwidth: n.attrs.colwidth.map(w => Math.round(w * k)) });
  }
  editor.view.dispatch(tr);
  reselectCells(curTable());
});
$('#tpRowH').addEventListener('change', e => {
  const v = e.target.value === '' ? null : Math.max(3, +e.target.value);
  const c = curTable(); if (!c) return;
  const tr = editor.state.tr;
  c.table.forEach((row, o, i) => { if (i >= c.rect.top && i < c.rect.bottom) tr.setNodeMarkup(c.start + o, undefined, { ...row.attrs, height: v }); });
  editor.view.dispatch(tr);
  reselectCells(curTable());
});
$('#tpColW').addEventListener('change', e => {
  const v = e.target.value === '' ? null : Math.round(Math.max(5, +e.target.value) * MM);
  forCells('cols', n => n.attrs.colspan === 1 ? { colwidth: v ? [v] : null } : null);
});
let borderScope = 'cells';
$('#popBorders').addEventListener('click', e => {
  const sc = e.target.closest('[data-scope]');
  if (sc) { borderScope = sc.dataset.scope; for (const b of $$('#popBorders [data-scope]')) b.classList.toggle('on', b === sc); return; }
  const bw = e.target.closest('[data-bw]');
  if (bw) forCells(borderScope === 'table' ? 'table' : 'cells', () => ({ borderWidth: bw.dataset.bw === '' ? null : +bw.dataset.bw }));
});
swatches($('#swBorder'), ['#7d8590', '#111111', '#1f5f74', '#2e4a9e', '#c0392b', '#1e8449', '#b7950b'], c => forCells(borderScope === 'table' ? 'table' : 'cells', () => ({ borderColor: c === 'none' ? null : c })), 'Alapértelmezett');

