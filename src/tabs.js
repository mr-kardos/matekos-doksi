// Tab layout: every tab span gets the width that takes the following text to the next tab stop.
// Stops are measured from the start of the text column (or of the header/footer box), like in Word.
const CM = 96 / 2.54;
export const DEFAULT_STEP = 1.25;   // cm

function stopsOf(block, boxW) {
  const v = block.getAttribute('data-tabs');
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
  const t = tab.getBoundingClientRect(), y = (t.top + t.bottom) / 2;
  const rects = Array.from(r.getClientRects()).filter(q => q.width > 0 && y >= q.top - 2 && y <= q.bottom + 2);   // same line as the tab
  if (!rects.length) return 0;
  const l = Math.min(...rects.map(q => q.left)), rr = Math.max(...rects.map(q => q.right));
  return (rr - l) / scale;
}
/** Lay out the tabs of every block inside root. originOf(block) -> client x of the column / box start. */
export function layoutTabs(root, scale = 1, originOf = null) {
  const tabs = root.querySelectorAll('span.tab');
  if (!tabs.length) return;
  for (const t of tabs) t.style.width = '0px';
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
      let w = 0, stop = null, endPos = null;
      for (const s2 of stops) {
        if (s2.pos <= x + 0.5) continue;
        if (s2.align === 'left') { stop = s2; w = s2.pos - x; break; }
        const seg = segWidth(t, scale), ww = s2.align === 'right' ? s2.pos - x - seg : s2.pos - x - seg / 2;
        if (ww > 1) { stop = s2; w = ww; break; }
      }
      if (!stop) { endPos = nextDefault(x + 0.5); w = endPos - x; }
      t.dataset.stop = String(Math.round((stop ? stop.pos : endPos) / CM * 100) / 100);
      // a hair less than the exact width: rounding must never push the text over the margin
      t.style.width = Math.max(0, stop && stop.align !== 'left' ? w - 0.15 : w) + 'px';
      if (stop && stop.leader) t.dataset.leader = stop.leader; else delete t.dataset.leader;
    }
  }
}
