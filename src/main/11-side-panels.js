/* ------------------------------------------------------------------ */
/* Side panels: page list (left), template editor (right)              */
/* ------------------------------------------------------------------ */
const lsGet = k => load(k);
const LSK = { left: 'matekosdoksi.leftw', right: 'matekosdoksi.rightw', panel: 'matekosdoksi.panel', sections: 'matekosdoksi.sections' };
const mainEl = $('#main'), plist = $('#plist'), props = $('#props');
function setLeftWidth(w) { w = Math.max(120, Math.min(420, Math.round(w))); document.body.style.setProperty('--lw', w + 'px'); mainEl.style.setProperty('--lw', w + 'px'); return w; }
function setRightWidth(w) { w = Math.max(260, Math.min(560, Math.round(w))); document.body.style.setProperty('--rw', w + 'px'); mainEl.style.setProperty('--rw', w + 'px'); return w; }
setLeftWidth(+lsGet(LSK.left) || 176); setRightWidth(+lsGet(LSK.right) || 320);
function splitter(el, get, set, key, sign) {
  el.addEventListener('pointerdown', e => {
    e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('drag');
    const x0 = e.clientX, w0 = get();
    const mv = ev => { set(w0 + sign * (ev.clientX - x0)); applyZoom(); };
    const up = ev => { el.releasePointerCapture(ev.pointerId); el.classList.remove('drag'); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up);
      lsSet(key, String(set(w0 + sign * (ev.clientX - x0)))); applyZoom(); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  });
}
splitter($('#lsplit'), () => $('#pagesNav').getBoundingClientRect().width, setLeftWidth, LSK.left, 1);
splitter($('#rsplit'), () => props.getBoundingClientRect().width, setRightWidth, LSK.right, -1);
/** The right panel shows the template editor or the comments ("cmt"). */
function panelVisible(v, view = 'tpl') {
  mainEl.classList.toggle('noprops', !v); document.body.classList.toggle('noprops-on', !v);
  $('#props').classList.toggle('cmtmode', v && view === 'cmt');
  $('#bTpl').classList.toggle('primary', v && view !== 'cmt'); $('#bCmt').classList.toggle('primary', v && view === 'cmt');
  lsSet(LSK.panel, v && view !== 'cmt' ? '1' : '0'); applyZoom();
  if (v && view !== 'cmt') fillPanel();
  if (v && view === 'cmt') renderComments();
  if (typeof drawComments === 'function') drawComments();
}
const panelView = () => mainEl.classList.contains('noprops') ? null : ($('#props').classList.contains('cmtmode') ? 'cmt' : 'tpl');
$('#bTpl').addEventListener('click', () => panelVisible(panelView() !== 'tpl', 'tpl'));
$('#bCmt').addEventListener('click', () => panelVisible(panelView() !== 'cmt', 'cmt'));

