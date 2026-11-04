// Tab layout: every tab span gets the width that takes the following text to the next tab stop.
// Stops are measured from the start of the text column (or of the header/footer box), like in Word.
const CM = 96 / 2.54;
export const DEFAULT_STEP = 1.25;   // cm

let styleTabsOf = null;                 // block -> the tab stops of its paragraph style (template), if any
export function setStyleTabs(fn) { styleTabsOf = fn; }
function stopsOf(block, boxW) {
  let v = block.getAttribute('data-tabs');
  if (!v && styleTabsOf) { const st = styleTabsOf(block); if (st && st.length) v = JSON.stringify(st); }
  if (v === 'hf') return [{ pos: boxW / 2, align: 'center' }, { pos: boxW, align: 'right' }];
  if (!v) return [];
  // a right stop at (or a hair beyond) the right margin is the margin itself – it ends exactly where justified text ends
  try { return JSON.parse(v).map(s => ({ pos: (+s.pos || 0) * CM, align: s.align || 'left', leader: s.leader || '' })).map(s => (s.align === 'right' && Math.abs(s.pos - boxW) < 0.3 * CM) ? { ...s, pos: boxW } : s).filter(s => s.pos > 0).sort((a, b) => a.pos - b.pos); }
  catch (e) { return []; }
}
/** Width of the content after a tab, up to the next tab or the end of its line. The content may sit in other
 *  elements (marks such as line shading, formulas…), so the range runs through the block in document order. */
function segWidth(tab, scale) {
  const block = tab.closest('p,h1,h2,h3,li,td,th') || tab.parentElement;
  const tabs = Array.from(block.querySelectorAll('span.tab')), next = tabs[tabs.indexOf(tab) + 1];
  const r = document.createRange();
  r.setStartAfter(tab);
  if (next) r.setEndBefore(next); else r.setEnd(block, block.childNodes.length);
  // spaces at the end do not count: the last real character ends at the stop (a space may run past the margin)
  try {
    const tw = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let lastT = null; tw.currentNode = block;
    while (tw.nextNode()) { const tn = tw.currentNode; if (r.intersectsNode(tn) && tn.data.trim()) lastT = tn; }
    if (lastT && !(next && lastT.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_PRECEDING)) {
      const m = lastT.data.match(/\s+$/);
      if (m) r.setEnd(lastT, lastT.data.length - m[0].length);
    }
  } catch (e) { /* keep the whole range */ }
  const t = tab.getBoundingClientRect(), y = (t.top + t.bottom) / 2;
  const rects = Array.from(r.getClientRects()).filter(q => q.width > 0 && y >= q.top - 2 && y <= q.bottom + 2);   // same line as the tab
  if (!rects.length) return 0;
  const l = Math.min(...rects.map(q => q.left)), rr = Math.max(...rects.map(q => q.right));
  return (rr - l) / scale;
}
/** Width of the text after a wrapped tab, on the line of its spacer. */
function segWidthAt(tab, sp, scale) {
  const block = tab.closest('p,h1,h2,h3,li,td,th') || tab.parentElement;
  const tabs = Array.from(block.querySelectorAll('span.tab')), next = tabs[tabs.indexOf(tab) + 1];
  const r = document.createRange(); r.setStartAfter(tab);
  if (next) r.setEndBefore(next); else r.setEnd(block, block.childNodes.length);
  try {   // trailing spaces do not count
    const tw = document.createTreeWalker(block, NodeFilter.SHOW_TEXT); let lastT = null;
    while (tw.nextNode()) { const tn = tw.currentNode; if (r.intersectsNode(tn) && tn.data.trim()) lastT = tn; }
    if (lastT) { const m = lastT.data.match(/\s+$/); if (m && r.comparePoint(lastT, lastT.data.length - m[0].length) <= 0) r.setEnd(lastT, lastT.data.length - m[0].length); }
  } catch (e) { /* whole range */ }
  const q = sp.getBoundingClientRect(), y = (q.top + q.bottom) / 2;
  const rects = Array.from(r.getClientRects()).filter(x => x.width > 0 && y >= x.top - 3 && y <= x.bottom + 3);
  if (!rects.length) return 0;
  return (Math.max(...rects.map(x => x.right)) - q.right) / scale;
}
/** Lay out the tabs of every block inside root. originOf(block) -> client x of the column / box start. */
export function layoutTabs(root, scale = 1, originOf = null) {
  const tabs = root.querySelectorAll('span.tab');
  if (!tabs.length) return;
  for (const t of tabs) { t.style.width = '0px'; if (t.classList.contains('wrapped')) { t.classList.remove('wrapped'); t.textContent = ''; } }
  const blocks = new Set(); for (const t of tabs) { const b = t.closest('p,h1,h2,h3,li,td,th'); if (b) blocks.add(b); }
  for (const b of blocks) {
    const host = originOf ? originOf(b) : null;
    const hr = (host || root).getBoundingClientRect();
    const x0 = hr.left, boxW = hr.width / scale;
    const stops = stopsOf(b, boxW);
    for (const t of b.querySelectorAll('span.tab')) {
      if (t.closest('p,h1,h2,h3,li,td,th') !== b) continue;
      const x = (t.getBoundingClientRect().left - x0) / scale;
      // the first stop that really moves the text on (a right / centre stop the text already passed is skipped,
      // so two tabs can never end at the same place)
      const step = DEFAULT_STEP * CM, nextDefault = from => (Math.floor(from / step + 1e-6) + 1) * step;
      let w = 0, stop = null, endPos = null, wrapStop = null, wrapSeg = 0;
      for (const s2 of stops) {
        if (s2.pos <= x + 0.5) continue;
        if (s2.align === 'left') { stop = s2; w = s2.pos - x; break; }
        const seg = segWidth(t, scale), ww = s2.align === 'right' ? s2.pos - x - seg : s2.pos - x - seg / 2;
        if (ww > 1) { stop = s2; w = ww; break; }
        // a right / centre stop the line's text does not leave room for: the tab and its text go on to the next
        // line, to exactly that stop (text wrapping, not a line break of the document)
        if (!wrapStop && s2.pos <= boxW + 0.5) { wrapStop = s2; wrapSeg = seg; }
      }
      if (!stop && wrapStop) {
        t.classList.add('wrapped');
        t.innerHTML = '<br><span class="tab-sp"></span>';
        const sp = t.lastChild, xs = (sp.getBoundingClientRect().left - x0) / scale;
        // the text after the tab measured on its new line (with the spacer still empty, it all starts there)
        const segNow = segWidthAt(t, sp, scale) || wrapSeg;
        const ww = wrapStop.align === 'right' ? wrapStop.pos - xs - segNow : wrapStop.pos - xs - segNow / 2;
        sp.style.width = Math.max(0, ww - 0.15) + 'px';
        t.style.width = '';
        t.dataset.stop = String(Math.round(wrapStop.pos / CM * 100) / 100);
        if (wrapStop.leader) t.dataset.leader = wrapStop.leader; else delete t.dataset.leader;
        continue;
      }
      if (!stop) { endPos = nextDefault(x + 0.5); w = endPos - x; }
      t.dataset.stop = String(Math.round((stop ? stop.pos : endPos) / CM * 100) / 100);
      // a hair less than the exact width: rounding must never push the text over the margin
      t.style.width = Math.max(0, stop && stop.align !== 'left' ? w - 0.15 : w) + 'px';
      if (stop && stop.leader) t.dataset.leader = stop.leader; else delete t.dataset.leader;
    }
  }
}
