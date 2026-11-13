/* ------------------------------------------------------------------ */
/* Comments: attached to text (a mark), a picture or table cells (an  */
/* attribute); listed in the order of the document; saved in the file */
/* ------------------------------------------------------------------ */
let docComments = [];               // [{id, text, at, done, replies:[{text, at}]}]
const cmtDate = t => new Date(t).toLocaleString('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
/** Where each comment is in the document: id -> first position */
function commentPlaces() {
  const at = {};
  editor.state.doc.descendants((n, pos) => {
    if (n.attrs && n.attrs.cmt) for (const id of String(n.attrs.cmt).split(' ')) if (id && at[id] == null) at[id] = pos;
    for (const m of n.marks || []) if (m.type.name === 'comment' && at[m.attrs.id] == null) at[m.attrs.id] = pos;
  });
  return at;
}
let cmtFilter = load('matekosdoksi.cmtfilter') === 'open' ? 'open' : 'all';      // 'open': resolved comments are not listed
/** Every reviewer has a colour of their own (from the name), shown behind the profile icon. */
function avatarColor(name) { let h = 0; for (const ch of String(name).trim().toLowerCase()) h = (h * 31 + ch.codePointAt(0)) % 360; return `hsl(${h} 55% 45%)`; }
/** The name written on new comments and replies (asked once, kept by the app). Null (and a hint) while it is missing. */
function cmtAuthor() {
  const inp = $('#cmtAuthor'), name = inp.value.trim().slice(0, 40);
  if (!name) { toast('Írd be a neved – ez kerül a megjegyzéseidre.'); inp.focus(); return null; }
  store('matekosdoksi.author', name); return name;
}
const orderedComments = (at = commentPlaces()) => [...docComments].sort((a, b) => (at[a.id] ?? 1e12) - (at[b.id] ?? 1e12));
/** Jump to the next / previous unresolved comment (dir = 1 / -1), going round at the ends. */
function stepOpenComment(dir) {
  const open = orderedComments().filter(c => !c.done);
  if (!open.length) { toast('Nincs nyitott megjegyzés.'); return; }
  const i = open.findIndex(c => c.id === activeCmt);
  const c = open[i < 0 ? (dir > 0 ? 0 : open.length - 1) : (i + dir + open.length) % open.length];
  showCommentPlace(c.id); renderComments(); focusCard(c.id);
}
function renderComments() {
  const at = commentPlaces();
  const all = orderedComments(at), nOpen = all.filter(c => !c.done).length;
  const list = cmtFilter === 'open' ? all.filter(c => !c.done) : all;
  $('#cmtCount').textContent = all.length ? `${nOpen} nyitott / ${all.length}` : '';
  for (const b of $$('#cmtView [data-cflt]')) b.classList.toggle('on', b.dataset.cflt === cmtFilter);
  $('#cmtPrev').disabled = $('#cmtNext').disabled = !nOpen;
  const who = x => x.by ? `<span class="cav" style="--c:${avatarColor(x.by)}">${svg('user')}</span><b class="cby">${esc(x.by)}</b>` : '';
  $('#cmtList').innerHTML = list.length ? list.map(c => `<div class="cmtcard${c.done ? ' done' : ''}${c.id === activeCmt ? ' act' : ''}" data-cid="${c.id}">
      <div class="ctop"><span class="cdate">${who(c)}${cmtDate(c.at)}</span>
        <button class="tb mini${c.done ? ' on' : ''}" data-cact="done" title="${c.done ? 'Mégsem megoldott' : 'Megoldva'}">${svg('tick')}</button>
        <button class="tb mini" data-cact="del" title="Megjegyzés törlése">${svg('xmark')}</button></div>
      <div class="ctext">${esc(c.text).replace(/\n/g, '<br>')}</div>
      ${(c.replies || []).map(r => `<div class="creply"><span class="cdate">${who(r)}${cmtDate(r.at)}</span><div>${esc(r.text).replace(/\n/g, '<br>')}</div></div>`).join('')}
      <div class="crow"><input type="text" class="cin" placeholder="Válasz…"><button class="btn mini" data-cact="reply">Válasz</button></div>
    </div>`).join('') : all.length ? '<div class="phint" style="padding:6px 2px">Nincs nyitott megjegyzés – minden meg van oldva. A „Mind” gombbal a megoldottak is látszanak.</div>' : '<div class="phint" style="padding:6px 2px">Még nincs megjegyzés. Jelölj ki valamit a dokumentumban, írd be a megjegyzést fent, és kattints a „Megjegyzés hozzáadása” gombra.</div>';
  drawComments();  thumbsSoon();                       // the comment counts on the page miniatures
}
function addComment() {
  const text = $('#cmtText').value.trim();
  const st = editor.state;
  let sel = st.selection;
  if (cmtSel && sel.empty) { try { sel = cmtSel.node ? NodeSelection.create(st.doc, cmtSel.from) : TextSelection.create(st.doc, cmtSel.from, cmtSel.to); } catch (e) { /* keep */ } }
  if (!text) { toast('Írd be a megjegyzés szövegét.'); $('#cmtText').focus(); return; }
  const by = cmtAuthor(); if (!by) return;
  const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const tr = st.tr;
  const addId = v => (v ? v + ' ' : '') + id;
  if (sel instanceof NodeSelection && sel.node.type.name === 'image') tr.setNodeMarkup(sel.from, undefined, { ...sel.node.attrs, cmt: addId(sel.node.attrs.cmt) });
  else if (sel instanceof CellSelection) sel.forEachCell((cell, pos) => tr.setNodeMarkup(pos, undefined, { ...cell.attrs, cmt: addId(cell.attrs.cmt) }));
  else if (!sel.empty) tr.addMark(sel.from, sel.to, st.schema.marks.comment.create({ id }));
  else { toast('Előbb jelölj ki szöveget, egy képet vagy táblázatcellát.'); return; }
  editor.view.dispatch(tr);
  docComments.push({ id, text, by, at: Date.now(), done: false, replies: [] });
  $('#cmtText').value = ''; cmtSel = null;
  markDirty(); saveSoon(); activeCmt = id; renderComments(); focusCard(id);
}
function removeCommentAnchors(id) {
  const st = editor.state, tr = st.tr, type = st.schema.marks.comment;
  st.doc.descendants((n, pos) => {
    if (n.attrs && n.attrs.cmt && String(n.attrs.cmt).split(' ').includes(id)) { const rest = String(n.attrs.cmt).split(' ').filter(x => x && x !== id).join(' '); tr.setNodeMarkup(pos, undefined, { ...n.attrs, cmt: rest || null }); }
    if (n.isInline) for (const m of n.marks) if (m.type === type && m.attrs.id === id) tr.removeMark(pos, pos + n.nodeSize, m);   // text and formulas
  });
  if (tr.docChanged) editor.view.dispatch(tr);
}
/** The page elements of a comment (text pieces, picture, cells). */
const commentEls = id => [...editor.view.dom.querySelectorAll(`[data-cmt~="${id}"]`)];
/** Scroll `box` to `top` in a short animation of our own. */
const glides = new WeakMap();
function glideTo(box, top) {
  top = Math.max(0, Math.min(top, box.scrollHeight - box.clientHeight));
  cancelAnimationFrame(glides.get(box) || 0);
  const from = box.scrollTop, d = top - from; if (Math.abs(d) < 1) { box.scrollTop = top; return; }
  const t0 = performance.now(), T = Math.min(420, 180 + Math.abs(d) / 12);
  const step = now => { const k = Math.min(1, (now - t0) / T), e = 1 - Math.pow(1 - k, 3); box.scrollTop = from + d * e; if (k < 1) glides.set(box, requestAnimationFrame(step)); };
  glides.set(box, requestAnimationFrame(step));
}
/** Scroll `box` (instantly) so that `el` is fully visible in it. */
function keepVisible(box, el) {
  const b = box.getBoundingClientRect(), r = el.getBoundingClientRect();
  if (r.top < b.top) box.scrollTop += r.top - b.top - 6; else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 6;
}
function focusCard(id) {
  const card = $(`#cmtList [data-cid="${id}"]`); if (!card) return;
  for (const c of $$('#cmtList .cmtcard.act')) c.classList.remove('act');
  card.classList.add('act');
  let box = card.parentElement; while (box && box !== document.body && !(box.scrollHeight > box.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
  if (box && box !== document.body) keepVisible(box, card);
  activeCmt = id; drawComments();
}
/** Scroll the document to a comment's place (its first highlighted part, a third down the window). */
function showCommentPlace(id) {
  const els = commentEls(id);
  let r = els.length ? els[0].getBoundingClientRect() : null;
  if (!r || (!r.width && !r.height)) {                     // not drawn as an element (e.g. on an empty paragraph): its position
    const at = commentPlaces()[id]; if (at == null) return;
    try { const c = editor.view.coordsAtPos(Math.min(at + 1, editor.state.doc.content.size)); r = { top: c.top }; } catch (e) { return; }
  }
  const wr = ws.getBoundingClientRect();
  glideTo(ws, ws.scrollTop + r.top - wr.top - ws.clientHeight / 3);
  activeCmt = id; drawComments();
}
var keptSel = null;                 // the text selection shown while a box of a popup / the panel has the focus
document.addEventListener('focusin', e => {
  const t = e.target;
  if (editor.view.dom.contains(t)) { if (keptSel) { keptSel = null; drawComments(); } return; }
  if (!t.matches || !t.matches('input, select, textarea')) return;
  const s0 = editor.state.selection;
  if (!s0.empty && !(s0 instanceof NodeSelection)) { keptSel = { from: s0.from, to: s0.to }; drawComments(); }
});
let activeCmt = null, cmtRaf = 0, cmtSel = null, cmtHidden = load('matekosdoksi.cmthide') === '1';
/** Screen rectangles of a selection {from, to, node}. */
function selRects(sel) {
  try {
    if (sel.node) { const d = editor.view.nodeDOM(sel.from); return d ? [d.getBoundingClientRect()] : []; }
    const a = editor.view.domAtPos(sel.from), b = editor.view.domAtPos(sel.to), rg = document.createRange();
    rg.setStart(a.node, a.offset); rg.setEnd(b.node, b.offset);
    return [...rg.getClientRects()].filter(q => q.width > 0 && q.height > 0);
  } catch (e) { return []; }
}
function setCmtHidden(v) {
  cmtHidden = v; lsSet('matekosdoksi.cmthide', v ? '1' : '0');
  $('#cmtHide').classList.toggle('on', v);
  $('#cmtHide').title = v ? 'A megjegyzések jelölése el van rejtve a lapon, amíg a panel zárva van – kattints a megjelenítéshez' : 'A megjegyzések jelölése a lapon akkor is látszik, ha a panel zárva van – kattints az elrejtéshez';
  drawComments();
}
const cmtShown = () => !(cmtHidden && panelView() !== 'cmt');
let cmtShownWas = null;
function drawComments() {
  // the miniatures' comment marks follow (later: this runs already while the app starts, before the miniatures exist)
  if (cmtShownWas !== cmtShown()) { cmtShownWas = cmtShown(); setTimeout(() => thumbsSoon(true), 0); }
  if (cmtRaf) return;
  cmtRaf = requestAnimationFrame(() => {
    cmtRaf = 0;
    const layer = $('#cmtLayer'), sr = stack.getBoundingClientRect(), out = [], top = [];
    if (cmtHidden && panelView() !== 'cmt') { layer.innerHTML = ''; $('#cmtTop').innerHTML = ''; return; }
    const done = new Set(docComments.filter(c => c.done).map(c => c.id));
    const txt = [], obj = [];
    for (const el of editor.view.dom.querySelectorAll('[data-cmt]')) {
      const ids = el.dataset.cmt.split(' ').filter(Boolean);
      const text = el.tagName === 'SPAN' && !el.classList.contains('imgw');
      if (!text) { const q = el.getBoundingClientRect(); if (q.width && q.height) obj.push({ l: q.left, t: q.top, r: q.right, b: q.bottom, ids }); continue; }
      // a formula counts with its own drawing (not with the room around it), text with its line pieces
      const maths = [...el.querySelectorAll('.math')].map(m => (m.querySelector('mjx-container') || m).getBoundingClientRect());
      const own = [...el.getClientRects()].filter(q => !maths.some(m => q.left >= m.left - 1 && q.right <= m.right + 1));
      for (const q of [...own, ...maths]) if (q.width && q.height) txt.push({ l: q.left, t: q.top, r: q.right, b: q.bottom, ids });
    }
    // pieces on the same line that touch or overlap become one band (no doubled colour, the height of the tallest)
    const merge = list => {
      list.sort((p, q) => p.t - q.t || p.l - q.l);
      const out2 = [];
      for (const x of list) {
        const m = out2.find(y => x.l <= y.r + 1 && x.r >= y.l - 1 && Math.min(x.b, y.b) - Math.max(x.t, y.t) > Math.min(x.b - x.t, y.b - y.t) * 0.4);
        if (m) { m.l = Math.min(m.l, x.l); m.r = Math.max(m.r, x.r); m.t = Math.min(m.t, x.t); m.b = Math.max(m.b, x.b); for (const id of x.ids) if (!m.ids.includes(id)) m.ids.push(id); }
        else out2.push({ ...x, ids: [...x.ids] });
      }
      return out2;
    };
    const cls = ids => (ids.every(id => done.has(id)) ? ' done' : '') + (ids.includes(activeCmt) ? ' act' : '');
    const box = (q, extra) => `<div class="cmt-hl${extra}" style="left:${(q.l - sr.left) / scale}px;top:${(q.t - sr.top) / scale}px;width:${(q.r - q.l) / scale}px;height:${(q.b - q.t) / scale}px"></div>`;
    for (const q of merge(txt)) out.push(box(q, cls(q.ids)));
    for (const q of merge(obj)) top.push(box(q, ' obj' + cls(q.ids)));
    // the selection the new comment will go on, while typing it (the text itself has lost the focus)
    const shown = cmtSel && panelView() === 'cmt' ? cmtSel : keptSel;
    if (shown) for (const q of selRects(shown)) out.push(`<div class="cmt-sel" style="left:${(q.left - sr.left) / scale}px;top:${(q.top - sr.top) / scale}px;width:${q.width / scale}px;height:${q.height / scale}px"></div>`);
    layer.innerHTML = out.join(''); $('#cmtTop').innerHTML = top.join('');
  });
}
$('#cmtAdd').addEventListener('mousedown', e => e.preventDefault());     // keep the selection in the document
$('#cmtText').addEventListener('focus', () => { const s0 = editor.state.selection; cmtSel = s0.empty && !(s0 instanceof NodeSelection) ? null : { from: s0.from, to: s0.to, node: s0 instanceof NodeSelection }; drawComments(); });
$('#cmtText').addEventListener('blur', () => { setTimeout(() => { if (document.activeElement !== $('#cmtText')) { cmtSel = null; drawComments(); } }, 200); });
$('#cmtHide').addEventListener('click', () => setCmtHidden(!cmtHidden));
setCmtHidden(cmtHidden);
$('#cmtAdd').addEventListener('click', addComment);
$('#cmtText').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addComment(); } });
$('#cmtList').addEventListener('click', e => {
  const card = e.target.closest('.cmtcard'); if (!card) return;
  const id = card.dataset.cid, c = docComments.find(x => x.id === id); if (!c) return;
  const act = e.target.closest('[data-cact]');
  if (act && act.dataset.cact === 'del') { removeCommentAnchors(id); docComments = docComments.filter(x => x.id !== id); markDirty(); saveSoon(); renderComments(); return; }
  if (act && act.dataset.cact === 'done') { c.done = !c.done; markDirty(); saveSoon(); renderComments(); return; }
  if (act && act.dataset.cact === 'reply') {
    const inp = card.querySelector('.cin'), t = inp.value.trim(); if (!t) { inp.focus(); return; }
    const by = cmtAuthor(); if (!by) return;
    (c.replies = c.replies || []).push({ text: t, by, at: Date.now() }); markDirty(); saveSoon(); renderComments(); focusCard(id); return;
  }
  if (e.target.closest('input')) return;
  for (const x of $$('#cmtList .cmtcard.act')) x.classList.remove('act');
  card.classList.add('act'); showCommentPlace(id);
});
const paintAvatar = () => { const a = $('#cmtAvatar'), n = $('#cmtAuthor').value.trim(); a.innerHTML = svg('user'); a.style.setProperty('--c', n ? avatarColor(n) : 'var(--ink-2)'); };
$('#cmtAuthor').value = load('matekosdoksi.author') || ''; paintAvatar();
$('#cmtAuthor').addEventListener('input', paintAvatar);
$('#cmtAuthor').addEventListener('change', e => { const n = e.target.value.trim().slice(0, 40); e.target.value = n; store('matekosdoksi.author', n); paintAvatar(); });
$('#cmtAuthor').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#cmtText').focus(); } });
$('#cmtPrev').onclick = () => stepOpenComment(-1);
$('#cmtNext').onclick = () => stepOpenComment(1);
for (const b of $$('#cmtView [data-cflt]')) b.onclick = () => { cmtFilter = b.dataset.cflt; store('matekosdoksi.cmtfilter', cmtFilter); renderComments(); };
$('#cmtList').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('cin')) { e.preventDefault(); e.target.closest('.cmtcard').querySelector('[data-cact=reply]').click(); } });
// a click on commented text / picture / cell: its comment in the panel
editor.view.dom.addEventListener('click', e => {
  const el = e.target.closest && e.target.closest('[data-cmt]'); if (!el) return;
  const ids = []; let x = el; while (x && x !== editor.view.dom) { if (x.dataset && x.dataset.cmt) ids.push(...x.dataset.cmt.split(' ').filter(Boolean)); x = x.parentElement; }
  if (!ids.length) return;
  if (panelView() !== 'cmt') panelVisible(true, 'cmt');
  focusCard(ids[0]);
});
/* left panel: collapse / open */
function pagesVisible(v) { mainEl.classList.toggle('nopages', !v); document.body.classList.toggle('nopages-on', !v); lsSet('matekosdoksi.pages', v ? '1' : '0'); applyZoom(); if (v) thumbsSoon(true); }
$('#pagesX').addEventListener('click', () => pagesVisible(false));
$('#pagesOpen').addEventListener('click', () => pagesVisible(true));
let secState = {}; try { secState = JSON.parse(lsGet(LSK.sections) || '{}'); } catch (e) { secState = {}; }
for (const sec of $$('#props .psec')) sec.classList.toggle('closed', !!secState[sec.dataset.sec]);
props.addEventListener('click', e => {
  const t = e.target.closest('[data-sec-toggle]'); if (!t) return;
  const k = t.dataset.secToggle; secState[k] = !secState[k]; lsSet(LSK.sections, JSON.stringify(secState));
  t.closest('.psec').classList.toggle('closed', !!secState[k]);
});

/* page list: a live miniature of every page; click = go to the page */
let thumbT = 0, curPage = 0;
function thumbsSoon(now) { clearTimeout(thumbT); thumbT = setTimeout(() => { renderThumbs(); renderHeads(); }, now ? 0 : 450); }
/* the left panel's other view: the headings of the document (Főcím, Cím, Alcím) with their page – a click goes there */
let navMode = load('matekosdoksi.nav') === 'heads' ? 'heads' : 'pages';
function setNav(m) {
  navMode = m; store('matekosdoksi.nav', m);
  $('#navLabel').textContent = m === 'heads' ? 'Címsorok' : 'Oldalak';
  plist.hidden = m !== 'pages'; $('#hlist').hidden = m !== 'heads';
  if (m === 'heads') renderHeads(); else thumbsSoon(true);
}
function renderHeads() {
  const box = $('#hlist'); if (box.hidden || !$('#home').hidden) return;
  const g = geometry(tpl), dom = editor.view.dom, top0 = dom.getBoundingClientRect().top, out = [];
  editor.state.doc.forEach((n, pos) => {
    if (n.type.name !== 'heading') return;
    let text = ''; n.forEach(c => { text += c.isText ? c.text : c.type.name === 'math' ? ' … ' : c.type.name === 'tab' ? ' ' : ''; });
    text = text.replace(/\s+/g, ' ').trim(); if (!text) return;
    let pg = 0; try { pg = Math.max(0, Math.floor(((editor.view.coordsAtPos(pos + 1).top - top0) / scale + g.mt) / g.P)); } catch (e) { /* not laid out yet */ }
    out.push(`<button class="hl l${n.attrs.level}" data-hpos="${pos}" title="${esc(text)}"><span>${esc(text)}</span><i>${pg + (+tpl.startPage || 1)}</i></button>`);
  });
  box.innerHTML = out.join('') || '<div class="phint" style="padding:8px 12px">Nincs címsor a dokumentumban. A Főcím, Cím és Alcím stílusú bekezdések jelennek meg itt.</div>';
}
queueMicrotask(() => {
  $('#navToggle').onclick = () => setNav(navMode === 'heads' ? 'pages' : 'heads');
  $('#hlist').addEventListener('click', e => {
    const b = e.target.closest('[data-hpos]'); if (!b) return;
    const pos = Math.min(+b.dataset.hpos + 1, editor.state.doc.content.size);
    try {
      const c = editor.view.coordsAtPos(pos), wr = ws.getBoundingClientRect();
      glideTo(ws, ws.scrollTop + (c.top - wr.top) - 40);
      editor.chain().setTextSelection(pos).focus(null, { scrollIntoView: false }).run();
    } catch (err) { /* the document changed meanwhile */ }
  });
  setNav(navMode);
});
/* Which blocks of the document changed since their miniature was drawn: every top-level block has a number that
   grows with each change inside it (text, formatting, page-break spacers, a picture's size…). */
const blockVer = new WeakMap(), blockId = new WeakMap(); let verSeq = 0, idSeq = 0;
const verOf = el => { let id = blockId.get(el); if (!id) blockId.set(el, id = ++idSeq); return id + '.' + (blockVer.get(el) || 0); };
queueMicrotask(() => {
  const dom = editor.view.dom;
  new MutationObserver(list => {
    for (const m of list) { let n = m.target; while (n && n.parentNode !== dom) n = n.parentNode; if (n) blockVer.set(n, ++verSeq); }
  }).observe(dom, { subtree: true, childList: true, attributes: true, characterData: true });
});
let thumbCache = [];                 // per page: {sig, node} – a page whose content did not change keeps its miniature
/* A page as a picture (the page miniatures, the two-page view): its sheet, the line shading, the blocks that reach
   into it (copies, exactly as laid out in the editor) and its free pictures / tables. */
/** What every page picture needs, measured once. */
function pageEnv() {
  const g = geometry(tpl), dom = editor.view.dom;
  const kids = Array.from(dom.children).map(c => ({ el: c, top: g.mt + c.offsetTop, bottom: g.mt + c.offsetTop + c.offsetHeight }));
  const sr0 = stack.getBoundingClientRect(), edr = dom.getBoundingClientRect();
  const pins = [...dom.querySelectorAll('.pinned')].map(el => {
    const er0 = el.getBoundingClientRect(), pg = Math.floor((er0.top - sr0.top) / scale / g.P);
    const tx = (er0.left - edr.left) / scale, ty = (er0.top - sr0.top) / scale - (pg * g.P + g.mt);
    let top = el; while (top && top.parentNode !== dom) top = top.parentNode;
    return { el, pg, tx, ty, sig: (top ? verOf(top) : '') + '@' + Math.round(tx) + ',' + Math.round(ty) + ',' + Math.round(er0.width) };
  });
  const shade = [...$('#shadeLayer').children].map(d => ({ html: d.outerHTML, top: parseFloat(d.style.top), h: parseFloat(d.style.height) }));
  return { g, dom, kids, style: dom.getAttribute('style') || '', pins, shade, title: $('#docTitle').value };
}
/** The parts of page i, and a signature that changes when the page does. */
function pageParts(i, E) {
  const g = E.g, top = i * g.P, bot = top + g.H;
  const parts = E.kids.filter(c => c.bottom > top - 2 && c.top < bot + 2);
  const sheet = sheetHTML(i, pageCount, tpl, E.title, g, 0, 0);
  const bandsHTML = E.shade.filter(d => !(d.top + d.h < top - 2 || d.top > top + g.P + 2)).map(d => d.html).join('');   // bands without a place are kept on every page
  const myPins = E.pins.filter(x => x.pg === i);
  const sig = [g.W, g.H, g.sheetX(i), g.leftOf(i), i + (+tpl.startPage || 1), E.style, sheet, bandsHTML, parts.map(p => verOf(p.el) + '@' + Math.round(p.top)).join(','), myPins.map(x => x.sig).join(',')].join('|');
  return { parts, sheet, bandsHTML, myPins, sig };
}
/** The picture of page i: a .tpage element at the page's own size (scaled by its holder). */
function pagePicture(i, E, P) {
  const g = E.g, top = i * g.P;
  const tp = document.createElement('div');
  tp.className = 'tpage'; tp.style.width = g.W + 'px'; tp.style.height = g.H + 'px';
  tp.innerHTML = P.sheet;
  // line shading of this page
  const bands = document.createElement('div');
  bands.style.cssText = `position:absolute;left:${-g.sheetX(i)}px;top:${-i * g.P}px`;
  bands.innerHTML = P.bandsHTML;
  for (const d of bands.children) d.style.position = 'absolute';
  tp.appendChild(bands);
  // the blocks that reach into this page (exactly as laid out in the editor)
  if (P.parts.length) {
    const c = document.createElement('div');
    c.className = 'ProseMirror docbody'; c.setAttribute('style', E.style);
    c.style.position = 'absolute'; c.style.left = g.leftOf(i) + 'px'; c.style.top = (P.parts[0].top - top) + 'px'; c.style.minHeight = '0';
    for (const p of P.parts) c.appendChild(p.el.cloneNode(true));
    // free pictures / tables are placed on their page below; working marks are not part of the page
    for (const x of c.querySelectorAll('.pinned')) x.style.visibility = 'hidden';
    for (const x of c.querySelectorAll('.spell-err,.find-hit,.tbl-active,.ProseMirror-selectednode')) x.classList.remove('spell-err', 'find-hit', 'cur', 'tbl-active', 'ProseMirror-selectednode');
    tp.appendChild(c);
  }
  // the free pictures / tables of this page, where they are on the page
  for (const { el, tx, ty } of P.myPins) {
    const cl = el.cloneNode(true);
    cl.classList.remove('ProseMirror-selectednode', 'tbl-active');
    const holder = document.createElement('div');
    holder.className = 'ProseMirror docbody'; holder.setAttribute('style', E.style);
    holder.style.position = 'absolute'; holder.style.left = g.leftOf(i) + 'px'; holder.style.top = g.mt + 'px'; holder.style.minHeight = '0'; holder.style.height = '0';
    cl.style.left = tx + 'px'; cl.style.top = ty + 'px'; cl.style.visibility = '';
    holder.appendChild(cl); tp.appendChild(holder);
  }
  return tp;
}
function renderThumbs() {
  if (!$('#home').hidden || plist.hidden) return;             // not shown (home screen, or the heading list is open)
  const E = pageEnv(), g = E.g, dom = E.dom;
  plist.style.setProperty('--pw', g.W); plist.style.setProperty('--ph', g.H);
  const nodes = [];
  // open comments per page (where each comment's first highlighted part is); not shown while the comments are hidden
  const cmtN = {};
  if (cmtShown()) {
    const open = new Set(docComments.filter(c => !c.done).map(c => c.id)), seen = new Set(), st = stack.getBoundingClientRect();
    for (const el of dom.querySelectorAll('[data-cmt]')) for (const id of el.dataset.cmt.split(' ')) {
      if (!id || seen.has(id) || !open.has(id)) continue;
      const r = el.getBoundingClientRect(); if (!r.width && !r.height) continue;
      seen.add(id);
      const pg = Math.max(0, Math.min(pageCount - 1, Math.floor((r.top - st.top) / scale / g.P)));
      cmtN[pg] = (cmtN[pg] || 0) + 1;
    }
    const at = commentPlaces(), top0 = dom.getBoundingClientRect().top;          // anchors that are not drawn as an element
    for (const id of open) if (!seen.has(id) && at[id] != null) {
      try { const pg = Math.max(0, Math.min(pageCount - 1, Math.floor(((editor.view.coordsAtPos(at[id]).top - top0) / scale + g.mt) / g.P))); cmtN[pg] = (cmtN[pg] || 0) + 1; } catch (e) { /* skipped */ }
    }
  }
  const cache = [];
  for (let i = 0; i < pageCount; i++) {
    const P = pageParts(i, E), sig = P.sig + '|' + (cmtN[i] || 0);
    const old = thumbCache[i];
    if (old && old.sig === sig) { old.node.classList.toggle('cur', i === curPage); nodes.push(old.node); cache[i] = old; continue; }
    const t = document.createElement('div');
    t.className = 'thumb' + (i === curPage ? ' cur' : ''); t.dataset.i = i;
    t.innerHTML = `<div class="no">${i + (+tpl.startPage || 1)}</div><div class="frame"></div>`;
    t.querySelector('.frame').appendChild(pagePicture(i, E, P));
    if (cmtN[i]) t.querySelector('.frame').insertAdjacentHTML('beforeend', `<span class="cmtmark" title="${cmtN[i]} nyitott megjegyzés ezen az oldalon">${svg('comment')}${cmtN[i]}</span>`);
    nodes.push(t); cache[i] = { sig, node: t };
  }
  thumbCache = cache;
  // only the miniatures that changed are put into the list: an unchanged one stays where it is (taking all of them
  // out and in again made the browser lay out every miniature anew)
  nodes.forEach((n, i) => { const at = plist.children[i]; if (at !== n) { if (at) plist.insertBefore(n, at); else plist.appendChild(n); } });
  while (plist.children.length > nodes.length) plist.lastElementChild.remove();
  fitThumbs();
  if (spreadOn) spreadSoon();
}
/** Miniature size follows the panel width at once (only a CSS scale – no re-render while dragging). */
function fitThumbs() {
  const f = plist.querySelector('.frame'); if (!f) return;
  plist.style.setProperty('--tk', f.clientWidth / (+plist.style.getPropertyValue('--pw') || 794));
}
new ResizeObserver(fitThumbs).observe(plist);
plist.addEventListener('click', e => {
  const t = e.target.closest('.thumb'); if (!t) return;
  const g = geometry(tpl), i = +t.dataset.i;
  pickedAt = Date.now();
  const sp = spreadOn && spreadBox.querySelector(`.spage[data-i="${i}"]`);
  glideTo(ws, sp ? sp.offsetTop - 16 : outer.offsetTop + i * g.P * scale - 12);
  setCurPage(i);
});
function setCurPage(i) {
  if (i === curPage) return;
  curPage = i;
  for (const t of plist.children) t.classList.toggle('cur', +t.dataset.i === i);
  const el = plist.children[i]; if (el && !plist.hidden) keepVisible(plist, el);
}
let pickedAt = 0;
ws.addEventListener('scroll', () => {
  if (Date.now() - pickedAt < 900) return;                 // just clicked a page in the list
  if (spreadOn) {                                          // two pages in a row: the page nearest to the upper third
    const y = ws.scrollTop + ws.clientHeight * 0.35; let best = 0;
    for (const sp of spreadBox.children) if (sp.dataset.i && sp.offsetTop <= y) best = +sp.dataset.i;
    return setCurPage(best);
  }
  const g = geometry(tpl);
  if (ws.scrollTop + ws.clientHeight >= ws.scrollHeight - 2) return setCurPage(pageCount - 1);
  const y = (ws.scrollTop + ws.clientHeight * 0.35 - outer.offsetTop) / scale;
  setCurPage(Math.max(0, Math.min(pageCount - 1, Math.floor(y / g.P))));
}, { passive: true });

/* template editor (right panel) */
const getPath = (o, p) => p.split('.').reduce((a, k) => a && a[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'), last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
let hfVariant = 'odd';
function hfTabs() {
  const tabs = [['odd', tpl.oddEven ? 'Páratlan oldalak' : 'Minden oldal']];
  if (tpl.oddEven) tabs.push(['even', 'Páros oldalak']);
  if (tpl.firstDiff) tabs.push(['first', 'Első oldal']);
  if (!tabs.find(t => t[0] === hfVariant)) hfVariant = 'odd';
  $('#hfTabs').innerHTML = tabs.map(([k, l]) => `<button data-v="${k}" class="${k === hfVariant ? 'on' : ''}">${l}</button>`).join('');
  const block = kind => {
    const sl = tpl[kind][hfVariant], base = `${kind}.${hfVariant}`;
    const col = (pos, label) => {
      const pic = sl.img[pos];
      return `<div class="hfpcol"><span class="hfpl">${label}</span><div class="hfthumb">${pic.src ? `<img src="${esc(pic.src)}" alt="">` : '<i>nincs kép</i>'}</div>
        <button class="btn mini" data-pickimg="${base}.img.${pos}.src">${pic.src ? 'Csere…' : 'Kép…'}</button>
        ${pic.src ? `<button class="btn mini" data-clearimg="${base}.img.${pos}.src">Eltávolítás</button><label class="mini-l">Magasság<span class="unitin"><input type="number" min="3" max="80" step="1" data-k="${base}.img.${pos}.h"><i>mm</i></span></label>` : ''}</div>`;
    };
    return `<h4>${kind === 'header' ? 'Élőfej képei' : 'Élőláb képei'}</h4><div class="hfpics">${col('l', 'Bal')}${col('c', 'Közép')}${col('r', 'Jobb')}</div>`;
  };
  $('#hfEditor').innerHTML = block('header') + block('footer');
}
const STYLE_ROWS = [['p', 'Normál', 'a dokumentum alapszövege'], ['h1', 'Főcím', ''], ['h2', 'Cím', ''], ['h3', 'Alcím', '']];
let openStyle = 'p';
const ALIGNS = [['left', 'alignL', 'Balra'], ['center', 'alignC', 'Középre'], ['right', 'alignR', 'Jobbra'], ['justify', 'alignJ', 'Sorkizárt']];
function styleRows() {
  const fams = allFamilies();
  const famOpts = sel => `<option value="">Alap betűtípus</option><optgroup label="Képletbarát betűtípusok">${fams.math.map(([f, l]) => `<option value="${f}"${f === sel ? ' selected' : ''}>${l}</option>`).join('')}</optgroup><optgroup label="Egyéb betűtípusok">${fams.other.map(([f, l]) => `<option value="${f}"${f === sel ? ' selected' : ''}>${l}</option>`).join('')}</optgroup>`;
  $('#styleRows').innerHTML = STYLE_ROWS.map(([k, label, hint]) => {
    const st = tpl.styles[k], b = `styles.${k}`, open = openStyle === k;
    const num = (key, lab, step, min, max, unit) => `<label class="fld">${lab}<span class="unitin"><input type="number" step="${step}"${min != null ? ` min="${min}"` : ''}${max != null ? ` max="${max}"` : ''} data-k="${b}.${key}">${unit ? `<i>${unit}</i>` : ''}</span></label>`;
    return `<div class="strow stcard${open ? ' open' : ''}" data-style="${k}">
      <button class="sthead sttoggle" data-sttoggle="${k}"><span class="chev">${svg('chev')}</span><b>${label}</b>${hint ? `<span class="phint">${hint}</span>` : ''}<span class="stprev" style="font-weight:${st.bold ? 700 : 400};font-style:${st.italic ? 'italic' : 'normal'};color:${esc(st.color)}">Aa</span></button>
      <div class="stbody">
        <label class="fld full">Betűtípus<select data-k="${b}.font">${famOpts(st.font)}</select></label>
        <div class="stctl"><input type="number" class="stsize" min="5" max="96" step="0.5" data-k="${b}.size" title="Betűméret (pt)"><span class="unit">pt</span>
          <label class="colbtn btn" title="Betűszín"><input type="color" class="hidecolor" data-k="${b}.color"><i class="dot fill" style="--c:${esc(st.color)}"></i>Szín</label>
          ${['bold', 'italic', 'underline'].map(t => `<button class="tb${st[t] ? ' on' : ''}" data-stt="${t}" data-st="${k}" title="${{ bold: 'Félkövér', italic: 'Dőlt', underline: 'Aláhúzott' }[t]}">${{ bold: '<b>B</b>', italic: '<i>I</i>', underline: '<u>U</u>' }[t]}</button>`).join('')}</div>
        <div class="stctl" style="margin-top:6px">${ALIGNS.map(([v, ic, t]) => `<button class="tb${(st.align || 'left') === v ? ' on' : ''}" data-stalign="${v}" data-st="${k}" title="${t}">${svg(ic)}</button>`).join('')}
          <label class="colbtn btn" title="Sorárnyék (a bekezdés sorai mögött)" data-none="Nincs sorárnyék"><input type="color" class="hidecolor" data-k="${b}.shade"><i class="dot fill${st.shade ? '' : ' none'}" style="--c:${esc(st.shade || 'transparent')}"></i>Sorárnyék</label></div>
        <div class="fgrid" style="margin-top:8px">
          ${num('line', 'Sorköz', 0.05, 0.8, 4, '')}${num('letter', 'Betűköz', 0.1, -3, 10, 'pt')}
          ${num('spaceBefore', 'Térköz előtte', 1, 0, 72, 'pt')}${num('spaceAfter', 'Térköz utána', 1, 0, 72, 'pt')}
          ${num('indentLeft', 'Bal behúzás', 0.25, 0, 10, 'cm')}${num('indentRight', 'Jobb behúzás', 0.25, 0, 10, 'cm')}
          <label class="fld">Első sor<select data-flkind="${k}"><option value="none"${!+st.firstLine ? ' selected' : ''}>Nincs</option><option value="first"${+st.firstLine > 0 ? ' selected' : ''}>Első sor beljebb</option><option value="hang"${+st.firstLine < 0 ? ' selected' : ''}>Függő</option></select></label>
          <label class="fld">Mértéke<span class="unitin"><input type="number" step="0.25" min="0" max="5" data-flval="${k}" value="${Math.abs(+st.firstLine || 0) || ''}"><i>cm</i></span></label>
        </div>
        <div class="sttabs"><span class="sttl">Tabulátorok</span>${(st.tabs || []).map((t, ti) => `<span class="stt">${String(t.pos).replace('.', ',')} cm ${{ left: 'balra', center: 'középre', right: 'jobbra' }[t.align] || 'balra'}${t.leader ? (t.leader === 'dot' ? ', pontozott' : ', vonallal') : ''}<button class="tb mini" data-sttabdel="${k}:${ti}" title="Törlés">✕</button></span>`).join('') || '<span class="phint" style="display:inline">nincs (1,25 cm-enként)</span>'}
          <span class="sttadd"><input type="number" step="0.25" min="0.25" placeholder="cm" data-sttabpos="${k}"><select data-sttabal="${k}"><option value="left">balra</option><option value="center">középre</option><option value="right">jobbra</option></select><select data-sttablead="${k}"><option value="">üres</option><option value="dot">pontozott</option><option value="line">vonal</option></select><button class="btn mini" data-sttabadd="${k}">Hozzáadás</button></span></div>
        <label class="chk" style="margin-top:8px"><input type="checkbox" data-k="${b}.keepNext"> Együtt a következő bekezdéssel</label>
        <label class="chk" style="margin-top:4px"><input type="checkbox" data-k="${b}.contextual"> Nincs térköz az azonos stílusú bekezdések között</label>
        ${k === 'p' ? `<label class="chk" style="margin-top:4px"><input type="checkbox" data-k="lists.contextual"> Nincs térköz a listaelemek között</label>
        <label class="chk" style="margin-top:4px" title="A sorok végén a hosszú szavak a magyar elválasztási szabályok szerint megtörhetnek. A szöveg nem változik, csak a tördelése."><input type="checkbox" data-k="hyphenate"> Automatikus elválasztás</label>` : ''}
        ${k === 'p' ? `<div class="fgrid" style="margin-top:8px">
          <label class="fld">Felsorolásjel<select data-k="lists.bullet">${['•', '◦', '▪', '–', '➤', '➔', '✓', '★', '◆', '❖', '☐', '→'].map(c => `<option>${c}</option>`).join('')}<option value="matekos">∞ Matekos végtelen</option></select></label>
          <label class="fld">Számozás<select data-k="lists.num"><option value="decimal">1. 2. 3.</option><option value="decimal-paren">1) 2) 3)</option><option value="lower-alpha">a) b) c)</option><option value="upper-alpha">A. B. C.</option><option value="lower-roman">i. ii. iii.</option><option value="upper-roman">I. II. III.</option></select></label>
        </div><div class="phint">Az új listák ezzel a jellel / számozással indulnak.</div>` : ''}
      </div></div>`;
  }).join('') + capCard(famOpts);
}
/** The style card of the picture captions (as the paragraph styles, with what a caption can have). */
function capCard(famOpts) {
  const c = tpl.cap || (tpl.cap = {}), open = openStyle === 'cap';
  return `<div class="strow stcard${open ? ' open' : ''}" data-style="cap">
    <button class="sthead sttoggle" data-sttoggle="cap"><span class="chev">${svg('chev')}</span><b>Képfelirat</b><span class="phint">a képek fölötti és alatti szöveg</span><span class="stprev" style="font-weight:${c.bold ? 700 : 400};font-style:${c.italic ? 'italic' : 'normal'};text-decoration:${c.underline ? 'underline' : 'none'};color:${esc(c.color || '#59616b')}">Aa</span></button>
    <div class="stbody">
      <label class="fld full">Betűtípus<select data-k="cap.font">${famOpts(c.font)}</select></label>
      <div class="stctl"><input type="number" class="stsize" min="5" max="30" step="0.5" data-k="cap.size" title="Betűméret (pt)"><span class="unit">pt</span>
        <label class="colbtn btn" title="Betűszín"><input type="color" class="hidecolor" data-k="cap.color"><i class="dot fill" style="--c:${esc(c.color || '#59616b')}"></i>Szín</label>
        ${['bold', 'italic', 'underline'].map(t => `<button class="tb${c[t] ? ' on' : ''}" data-capt="${t}" title="${{ bold: 'Félkövér', italic: 'Dőlt', underline: 'Aláhúzott' }[t]}">${{ bold: '<b>B</b>', italic: '<i>I</i>', underline: '<u>U</u>' }[t]}</button>`).join('')}</div>
      <div class="phint" style="margin-top:6px">A felirat a kép szélességében, középre igazítva áll, és a képpel együtt mozog.</div>
    </div></div>`;
}
{ const fams = allFamilies(), o = list => list.map(([f, l]) => `<option value="${f}">${l}</option>`).join('');
  for (const sel of $$('.hffont')) sel.innerHTML = `<option value="">Alap betűtípus</option><optgroup label="Képletbarát betűtípusok">${o(fams.math)}</optgroup><optgroup label="Egyéb betűtípusok">${o(fams.other)}</optgroup>`; }
$('#tplFont').innerHTML = Object.entries(FONT_SETS).map(([k, f]) => `<option value="${k}">${f.label} – ${f.note}</option>`).join('');
/* header texts for page ranges */
function renderHfRanges() {
  const box = $('#hfRangeList'); if (!box) return;
  const rs = tpl.hfRanges || (tpl.hfRanges = []);
  box.innerHTML = rs.map((r, k) => `<div class="hfr" data-r="${k}"><input type="number" min="1" data-f="from" value="${+r.from || 1}" title="Első oldal"><span>–</span><input type="number" min="1" data-f="to" value="${+r.to || ''}" title="Utolsó oldal"><input type="text" data-f="l" value="${esc(r.l || '')}" placeholder="bal"><input type="text" data-f="c" value="${esc(r.c || '')}" placeholder="közép"><input type="text" data-f="r" value="${esc(r.r || '')}" placeholder="jobb"><button class="tb mini" data-del title="Törlés">✕</button><select data-f="par" class="hfrpar" title="Mely oldalakra vonatkozik a tartományon belül"><option value="both"${!r.par || r.par === 'both' ? ' selected' : ''}>minden oldalra</option><option value="odd"${r.par === 'odd' ? ' selected' : ''}>csak a páratlan oldalakra</option><option value="even"${r.par === 'even' ? ' selected' : ''}>csak a páros oldalakra</option></select></div>`).join('');
}
document.addEventListener('change', e => {
  const row = e.target.closest && e.target.closest('#hfRangeList .hfr'); if (!row) return;
  const r = tpl.hfRanges[+row.dataset.r], f = e.target.dataset.f; if (!r || !f) return;
  r[f] = f === 'from' || f === 'to' ? (+e.target.value || null) : e.target.value;
  if (f === 'par' && r.par === 'both') delete r.par;
  tplChanged(); applyTpl();
});
document.addEventListener('click', e => {
  if (e.target.closest && e.target.closest('#hfRangeAdd')) { (tpl.hfRanges = tpl.hfRanges || []).push({ from: 1, to: pageCount, l: '', c: '', r: '', ...(tpl.oddEven && (hfVariant === 'odd' || hfVariant === 'even') ? { par: hfVariant } : {}) }); renderHfRanges(); tplChanged(); applyTpl(); return; }
  const d = e.target.closest && e.target.closest('#hfRangeList [data-del]'); if (!d) return;
  tpl.hfRanges.splice(+d.closest('.hfr').dataset.r, 1); renderHfRanges(); tplChanged(); applyTpl();
});
/* every slider of the template panel has a number box (with arrows) beside it, one slider per row */
function sliderValues() {
  for (const r of $$('#props input[type=range]')) {
    if (!r.parentElement.classList.contains('rvrow')) {
      const lab = r.closest('label'); if (lab) lab.classList.add('full');
      const row = document.createElement('span'); row.className = 'rvrow';
      r.replaceWith(row); row.appendChild(r);
      const pct = /opacity/.test(r.dataset.k || '');
      const n = document.createElement('input'); n.type = 'number'; n.className = 'rvnum';
      n.min = pct ? Math.round(+r.min * 100) : r.min; n.max = pct ? Math.round(+r.max * 100) : r.max; n.step = pct ? 1 : r.step;
      const u = document.createElement('span'); u.className = 'rvu';
      u.textContent = pct ? '%' : /angle|Angle/.test(r.dataset.k) ? '°' : /imgWidth/.test(r.dataset.k) ? '%' : /size/.test(r.dataset.k) ? 'pt' : '';
      row.append(n, u);
      r.addEventListener('input', () => showRv(r));
      n.addEventListener('change', () => {
        let v = +String(n.value).replace(',', '.'); if (!Number.isFinite(v)) return;
        if (pct) v = v / 100;
        r.value = Math.min(+r.max, Math.max(+r.min, v));
        r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    showRv(r);
  }
}
function showRv(r) {
  const n = r.parentElement.querySelector('.rvnum'); if (!n || document.activeElement === n) return;
  n.value = /opacity/.test(r.dataset.k || '') ? Math.round(+r.value * 100) : r.value;
}
function fillPanel() {
  renderHfRanges();
  queueMicrotask(sliderValues);
  hfTabs(); styleRows(); presetName();
  for (const el of $$('#props [data-k]')) {
    const v = getPath(tpl, el.dataset.k);
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.type === 'radio') el.checked = el.value === v;
    else el.value = v ?? '';
  }
  $('#hcDot').style.setProperty('--c', tpl.headerColor); $('#fcDot').style.setProperty('--c', tpl.footerColor);
  for (const b of $$('[data-edithf]')) { const on = !!hfOpen && hfOpen.kind === b.dataset.edithf; b.classList.toggle('primary', on); b.textContent = on ? 'Kész' : (b.dataset.edithf === 'header' ? 'Élőfej szerkesztése' : 'Élőláb szerkesztése'); }
  $('#wmThumb').src = tpl.wm.img || ''; $('#wmThumb').hidden = !tpl.wm.img;
  $('#wmText').hidden = tpl.wm.type !== 'text';
  $('#wmImage').hidden = tpl.wm.type !== 'image';
  $('#wmOpacity').hidden = tpl.wm.type === 'none';
  for (const el of $$('#props [data-custom]')) el.hidden = tpl.page !== 'custom';
  $$('[data-mirror-label]').forEach(s => { s.textContent = tpl.mirror ? (s.dataset.mirrorLabel === 'left' ? 'Belső margó (mm)' : 'Külső margó (mm)') : (s.dataset.mirrorLabel === 'left' ? 'Bal margó (mm)' : 'Jobb margó (mm)'); });
}
function tplChanged() { markDirty(); applyTpl(); saveSoon(); noteTplChange(); }
const tplState = () => JSON.stringify({ tpl, customTpl });
/** A new document (opened, new, imported): the template history starts again. */
function resetTplHistory() { tplSaved = tplState(); tplUndo = []; tplRedo = []; }
/** The template was changed: one undo step (a dragged slider or quick typing in a box counts as one). */
function noteTplChange() {
  if (tplRestoring) return;
  const now = tplState(); if (now === tplSaved) return;
  const last = tplUndo[tplUndo.length - 1], t = Date.now(), depth = undoDepth(editor.state);
  if (last && t - last.at < 800 && last.depth === depth) last.at = t;
  else {
    tplUndo.push({ before: tplSaved, depth, at: t }); if (tplUndo.length > 100) tplUndo.shift();
    try { editor.view.dispatch(closeHistory(editor.state.tr)); } catch (e) { /* text typed after this is a step of its own */ }
  }
  tplSaved = now; tplRedo = [];
  updateToolbar();
}
function restoreTpl(state) {
  tplRestoring = true;
  try {
    if (hfOpen) closeHF();
    const st = JSON.parse(state);
    tpl = normalizeTpl(st.tpl); customTpl = st.customTpl || null;
    fillPanel(); applyTpl(true); markDirty(); saveSoon();
  } finally { tplRestoring = false; }
  tplSaved = tplState(); updateToolbar();
}
function unifiedUndo() {
  const top = tplUndo[tplUndo.length - 1];
  if (top && undoDepth(editor.state) <= top.depth) {
    tplUndo.pop(); tplRedo.push({ after: tplSaved, redo: redoDepth(editor.state) });
    restoreTpl(top.before); toast('Sablonmódosítás visszavonva'); return true;
  }
  return editor.chain().focus(null, { scrollIntoView: false }).undo().run();
}
function unifiedRedo() {
  const top = tplRedo[tplRedo.length - 1];
  if (top && redoDepth(editor.state) <= top.redo) {
    tplRedo.pop(); tplUndo.push({ before: tplSaved, depth: undoDepth(editor.state), at: 0 });
    restoreTpl(top.after); toast('Sablonmódosítás újra'); return true;
  }
  return editor.chain().focus(null, { scrollIntoView: false }).redo().run();
}
function onPanelInput(e) {
  const el = e.target;
  if (el.dataset && (el.dataset.flkind || el.dataset.flval)) {          // style: first line indent / hanging indent
    const key = el.dataset.flkind || el.dataset.flval, st = tpl.styles[key], card = el.closest('.stcard');
    const kind = card.querySelector('[data-flkind]').value, v = Math.max(0, parseFloat(String(card.querySelector('[data-flval]').value).replace(',', '.')) || 0);
    const oldHang = +st.firstLine < 0 ? -st.firstLine : 0, base = Math.max(0, (+st.indentLeft || 0) - oldHang);
    if (kind === 'none' || !v) { st.firstLine = 0; st.indentLeft = base; }
    else if (kind === 'first') { st.firstLine = v; st.indentLeft = base; }
    else { st.firstLine = -v; st.indentLeft = base + v; }
    const il = card.querySelector(`[data-k="styles.${key}.indentLeft"]`); if (il) il.value = st.indentLeft;
    tplChanged(); return;
  }
  const k = el.dataset && el.dataset.k; if (!k) return;
  if (el.tagName === 'TEXTAREA') { setPath(tpl, k, el.value); tplChanged(); return; }
  let v = el.type === 'checkbox' ? el.checked : (el.type === 'number' || el.type === 'range') ? parseFloat(el.value) : el.value;
  if (typeof v === 'number' && isNaN(v)) return;
  if (el.type === 'radio' && !el.checked) return;
  setPath(tpl, k, v);
  if (el.type === 'color') { const dot = el.parentElement.querySelector('.dot'); if (dot) dot.style.setProperty('--c', v); }
  if (k === 'oddEven' || k === 'firstDiff' || k === 'mirror' || k === 'wm.type' || k === 'page') fillPanel();
  if ((/^styles\.\w+\.font$/.test(k) || /^(header|footer)Font$/.test(k)) && v) loadTextFamily(v).then(() => relayout(30));
  if (k === 'oddEven' || k === 'firstDiff') { if (hfOpen) closeHF(); }
  tplChanged();
}
props.addEventListener('input', onPanelInput);
props.addEventListener('change', onPanelInput);
props.addEventListener('click', e => {
  // tab stops of a paragraph style
  const ta = e.target.closest('[data-sttabadd]'), td = e.target.closest('[data-sttabdel]');
  if (ta) {
    const k = ta.dataset.sttabadd, card = ta.closest('.stcard'), v = parseFloat(String(card.querySelector('[data-sttabpos]').value).replace(',', '.'));
    if (!(v > 0 && v < 60)) return;
    const st = tpl.styles[k]; st.tabs = [...(st.tabs || []).filter(t => t.pos !== v), { pos: v, align: card.querySelector('[data-sttabal]').value, ...(card.querySelector('[data-sttablead]').value ? { leader: card.querySelector('[data-sttablead]').value } : {}) }].sort((a, b) => a.pos - b.pos);
    styleRows(); tplChanged(); relayout(0); return;
  }
  if (td) { const [k, i] = td.dataset.sttabdel.split(':'); tpl.styles[k].tabs.splice(+i, 1); styleRows(); tplChanged(); relayout(0); return; }
  const tg = e.target.closest('[data-sttoggle]');
  if (tg) { openStyle = openStyle === tg.dataset.sttoggle ? '' : tg.dataset.sttoggle; for (const c of $$('#styleRows .stcard')) c.classList.toggle('open', c.dataset.style === openStyle); return; }
  const al = e.target.closest('[data-stalign]');
  if (al) { tpl.styles[al.dataset.st].align = al.dataset.stalign; for (const x of al.parentElement.querySelectorAll('[data-stalign]')) x.classList.toggle('on', x === al); tplChanged(); return; }
  const cb = e.target.closest('[data-capt]');
  if (cb) { const c = tpl.cap; c[cb.dataset.capt] = !c[cb.dataset.capt]; cb.classList.toggle('on', c[cb.dataset.capt]); tplChanged(); return; }
  const b = e.target.closest('[data-stt]'); if (!b) return;
  const st = tpl.styles[b.dataset.st]; st[b.dataset.stt] = !st[b.dataset.stt]; b.classList.toggle('on', st[b.dataset.stt]); tplChanged();
});
$('#hfTabs').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { const was = hfOpen && hfOpen.kind; hfVariant = b.dataset.v; if (hfOpen) closeHF(); fillPanel(); if (was) editHF(was, hfVariant); } });
$('#hfEditor').addEventListener('click', e => {
  const p = e.target.closest('[data-pickimg]'), c = e.target.closest('[data-clearimg]');
  if (p) pickImage(1600, url => { setPath(tpl, p.dataset.pickimg, url); fillPanel(); tplChanged(); });
  if (c) { setPath(tpl, c.dataset.clearimg, ''); fillPanel(); tplChanged(); }
});
$('#wmPick').addEventListener('click', () => pickImage(2400, url => { tpl.wm.img = url; tpl.wm.type = 'image'; fillPanel(); tplChanged(); }));
$('#wmClear').addEventListener('click', () => { tpl.wm.img = ''; fillPanel(); tplChanged(); });
const startTpl = () => normalizeTpl(DEFAULT_TPL);

/* ready-made templates: red box at the top of the template panel (like Matekos Prezi); the locked ones come later.
   Below them: save the current settings into a template file (.mdsab) and use one (at most one per document). */
const PRESETS = [['ures', 'Sima', false, '#ffffff', '#da291c'], ['feladatsor', 'Feladatsor', false, '#f4f6f8', '#1f5f74'], ['kiadvany', 'Kiadvány', true, '#fdf3d7', '#b7950b'], ['pre', 'Pré', true, '#ece6f5', '#7d3c98']];
let customTpl = null;               // {name, tpl}: the template file used in this document
const presetLabel = () => tpl.preset === 'custom' && customTpl ? customTpl.name : (PRESETS.find(p => p[0] === tpl.preset) || PRESETS[0])[1];
function presetName() {
  $('#tplName').textContent = presetLabel();
  const cards = PRESETS.map(([k, l, locked, a, b]) => `<button class="pbcard${tpl.preset === k ? ' on' : ''}${locked ? ' locked' : ''}" data-preset="${k}" title="${locked ? 'Hamarosan' : l}"><i style="--a:${a};--b:${b}"></i><span>${locked ? svg('lock') : ''}${l}</span>${locked ? '<small>hamarosan</small>' : ''}</button>`);
  if (customTpl) cards.push(`<button class="pbcard custom${tpl.preset === 'custom' ? ' on' : ''}" data-preset="custom" title="Sablonfájlból: ${esc(customTpl.name)}"><i style="--a:#ffffff;--b:#2e4a9e"></i><span>${esc(customTpl.name)}</span><small>sablonfájlból</small></button>`);
  $('#presetBox').innerHTML = `<div class="pbhead"><b>Sablonok</b></div><div class="pbgrid">${cards.join('')}</div>
    <div class="pbfile">${tpl.preset === 'custom' && customTpl ? `<button class="btn primary" id="tplUpdate" title="A sablonfájl felülírása a mostani beállításokkal (különben a változások csak ebbe a dokumentumba kerülnek)">Sablonfájl frissítése</button>` : ''}<button class="btn" id="tplToFile" title="A jobb oldali panel minden beállítása – az élőfejjel és az élőlábbal együtt – egy Matekos Doksi Sablon fájlba">Sablon mentése fájlba…</button><button class="btn" id="tplFromFile" title="Egy Matekos Doksi Sablon fájl használata ebben a dokumentumban">Sablonfájl importálása…</button></div>`;
}
$('#presetBox').addEventListener('click', async e => {
  if (e.target.closest('#tplUpdate')) {
    if (!customTpl) return;
    try {
      const t = JSON.parse(JSON.stringify(tpl)); delete t.preset;
      const n = await updateTemplateFile(customTpl.path || null, { name: customTpl.name, tpl: t });
      if (n) { customTpl.tpl = t; markDirty(); saveSoon(); toast('Sablonfájl frissítve: ' + n); }
    } catch (err) { toast('A sablonfájl frissítése nem sikerült: ' + (err && err.message || err)); }
    return;
  }
  if (e.target.closest('#tplToFile')) {
    try {
      const t = JSON.parse(JSON.stringify(tpl)); delete t.preset;
      const n = await saveTemplateFile({ name: customTpl && tpl.preset === 'custom' ? customTpl.name : docTitle() + ' sablon', tpl: t }, (customTpl && tpl.preset === 'custom' ? customTpl.name : docTitle() + ' sablon'));
      if (n) {
        if (customTpl && tpl.preset !== 'custom' && !await confirmBox(`A dokumentumban már van egy sablonfájl („${customTpl.name}”). Egyszerre csak egy lehet – ez lép a helyére: „${n.replace(/\.mdsab$/i, '')}”?`, 'Csere')) { toast('Sablon elmentve: ' + n); return; }
        customTpl = { name: n.replace(/\.mdsab$/i, ''), tpl: t, path: templateFilePath() }; tpl.preset = 'custom'; presetName(); markDirty(); saveSoon();
        toast('Sablon elmentve és használatban: ' + n);
      }
    } catch (err) { toast('A sablon mentése nem sikerült: ' + (err && err.message || err)); }
    return;
  }
  if (e.target.closest('#tplFromFile')) {
    let r;
    try { r = await openTemplateFile(); } catch (err) { toast(err && err.message || String(err)); return; }
    if (!r) return;
    if (customTpl && !await confirmBox(`A dokumentumban már van egy sablonfájl („${customTpl.name}”). Egyszerre csak egy lehet – lecseréled erre: „${r.name.replace(/\.mdsab$/i, '')}”?`, 'Csere')) return;
    if (hfOpen) closeHF();
    customTpl = { name: r.name.replace(/\.mdsab$/i, ''), tpl: r.data.tpl, path: templateFilePath() };
    tpl = normalizeTpl(JSON.parse(JSON.stringify(customTpl.tpl))); tpl.preset = 'custom';
    fillPanel(); markDirty(); applyTpl(true); saveSoon(); noteTplChange();
    toast('Sablonfájl használatban: ' + customTpl.name);
    return;
  }
  const b = e.target.closest('[data-preset]'); if (!b) return;
  if (b.classList.contains('locked')) { toast('Ez a sablon hamarosan érkezik.'); return; }
  if (b.dataset.preset === tpl.preset) return;
  const label = b.dataset.preset === 'custom' ? customTpl.name : (PRESETS.find(p => p[0] === b.dataset.preset) || [])[1];
  if (!await confirmBox(`A(z) „${label}” sablon lép a mostani helyére (oldal, élőfej és élőláb, vízjel, szövegstílusok)${b.dataset.preset === 'ures' ? ' – a dokumentum formázása az alapbeállításra áll vissza' : ''}. A dokumentum szövege megmarad. Folytatod?`, 'Sablon alkalmazása')) return;
  if (hfOpen) closeHF();
  let src = DEFAULT_TPL;
  if (b.dataset.preset === 'custom') src = JSON.parse(JSON.stringify(customTpl.tpl));
  else if (b.dataset.preset !== 'ures') {                    // a ready-made template of the app (public/presets)
    try { const r = await fetch(`./presets/${b.dataset.preset}.mdsab`); src = (await r.json()).tpl; } catch (err) { toast('A sablon nem tölthető be.'); return; }
  }
  tpl = normalizeTpl(src); tpl.preset = b.dataset.preset;
  fillPanel(); markDirty(); applyTpl(true); saveSoon(); noteTplChange();
  toast('Sablon: ' + presetLabel());
});

