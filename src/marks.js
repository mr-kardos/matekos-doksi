// Formatting marks (the eye button): green signs drawn ABOVE the text in their own layer – they never take
// space in the document, cannot be clicked and are never printed or exported.
const SKIP = '.math,.lm,.pg-sp,.pg-spb,.ibar,.isize,.ih,.mpending,.pagebreak,.tab';
const CM = 96 / 2.54;
const cm = px => (Math.round(px / CM * 100) / 100).toString().replace('.', ',');

export function drawMarks(layer, editorDom, stackEl, scale, styles = null, famLabel = f => f, blank = false) {
  const sr = stackEl.getBoundingClientRect();
  const X = v => (v - sr.left) / scale, Y = v => (v - sr.top) / scale;
  const out = [];
  const put = (cls, x, y, txt, extra = '') => out.push(`<span class="mk-${cls}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;${extra}">${txt}</span>`);
  const range = document.createRange();
  // spaces
  const tw = document.createTreeWalker(editorDom, NodeFilter.SHOW_TEXT, { acceptNode: t => t.parentElement && t.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  while (tw.nextNode()) {
    const n = tw.currentNode, d = n.data;
    for (let i = 0; i < d.length; i++) {
      const c = d[i];
      if (c !== ' ' && c !== '\u00a0') continue;
      range.setStart(n, i); range.setEnd(n, i + 1);
      const r = range.getBoundingClientRect(); if (!r.width && !r.height) continue;
      put(c === ' ' ? 'sp' : 'nb', X(r.left + r.width / 2), Y(r.top + r.height / 2), c === ' ' ? '·' : '°');
    }
  }
  // tabs: "tab" and where they end (cm from the left margin)
  const col = editorDom.getBoundingClientRect();
  for (const t of editorDom.querySelectorAll('span.tab')) {
    const r = t.getBoundingClientRect(), h = parseFloat(getComputedStyle(t.parentElement).fontSize) || 16;
    const end = t.dataset.stop ? String(+t.dataset.stop).replace('.', ',') : cm((r.right - col.left) / scale);
    put('tab', X(r.left), Y(r.bottom) - h * 0.45, `<s>tab</s><b>${end}</b>`, `width:${Math.max(18, r.width / scale)}px`);
  }
  // table cells with hidden borders: dashed lines
  for (const c of editorDom.querySelectorAll('td,th')) {
    if (c.closest('.pg-row')) continue;
    const cs = getComputedStyle(c), r = c.getBoundingClientRect();
    const hid = side => cs['border' + side + 'Style'] === 'hidden' || cs['border' + side + 'Style'] === 'none' || !parseFloat(cs['border' + side + 'Width']);
    const x0 = X(r.left), y0 = Y(r.top), w = r.width / scale, h = r.height / scale;
    if (hid('Top')) out.push(`<span class="mk-cb h" style="left:${x0}px;top:${y0}px;width:${w}px"></span>`);
    if (hid('Bottom')) out.push(`<span class="mk-cb h" style="left:${x0}px;top:${y0 + h}px;width:${w}px"></span>`);
    if (hid('Left')) out.push(`<span class="mk-cb v" style="left:${x0}px;top:${y0}px;height:${h}px"></span>`);
    if (hid('Right')) out.push(`<span class="mk-cb v" style="left:${x0 + w}px;top:${y0}px;height:${h}px"></span>`);
  }
  // line breaks (Shift+Enter) and paragraph ends (Enter)
  for (const br of editorDom.querySelectorAll('br:not(.ProseMirror-trailingBreak)')) {
    if (br.closest(SKIP)) continue;
    let r = null;
    const prev = br.previousSibling;
    if (prev && prev.nodeType === 3 && prev.data.length) { range.setStart(prev, prev.data.length - 1); range.setEnd(prev, prev.data.length); const q = range.getClientRects(); r = q[q.length - 1]; if (r) r = { left: r.right, top: r.top, height: r.height }; }
    if (!r) { const q = br.getClientRects()[0] || br.getBoundingClientRect(); r = { left: q.left, top: q.top, height: q.height || 16 }; }
    put('br', X(r.left) + 1, Y(r.top + r.height / 2), '↵');
  }
  for (const b of editorDom.querySelectorAll('p,h1,h2,h3')) {
    if (b.closest('.hf')) continue;
    if (b.classList.contains('lm-collapsed') || b.closest('li[data-ghost]') === b.parentElement && b === b.parentElement.firstElementChild && b.parentElement.hasAttribute('data-ghost') || b.getBoundingClientRect().height < 1) continue;   // hidden holder lines
    range.selectNodeContents(b);
    const rects = Array.from(range.getClientRects()).filter(q => q.width > 0 || q.height > 0);
    const last = rects[rects.length - 1], br = b.getBoundingClientRect(), cs = getComputedStyle(b);
    let x, y;
    if (last && b.textContent.length) { x = X(last.right) + 1; y = Y(last.top + last.height / 2); }
    else { x = X(br.left + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.textIndent) || 0)); y = Y(br.top + (parseFloat(cs.paddingTop) || 0)) + (parseFloat(cs.lineHeight) || 20) / 2; }
    put('par', x, y, '¶');
    // indentation: from the margin to where the text starts, at the height of the text; labels in the margins
    const ml = parseFloat(cs.marginLeft) || 0, mr = parseFloat(cs.marginRight) || 0, ti = parseFloat(cs.textIndent) || 0, hang = parseFloat(b.getAttribute('data-hang')) || 0;
    const pl = parseFloat(cs.paddingLeft) || 0;
    const first = rects[0], mid = first ? Y(first.top + first.height / 2) : Y(br.top + (parseFloat(cs.paddingTop) || 0)) + (parseFloat(cs.lineHeight) || 20) / 2;
    const second = rects.find(q => first && q.top > first.bottom - 1), mid2 = second ? Y(second.top + second.height / 2) : mid;
    if (ml > 0.5) out.push(`<span class="mk-ind lft" style="left:${X(br.left) - ml}px;top:${(ti < -0.5 || hang) ? mid2 : mid}px;width:${ml}px"><i>behúzás ${cm(ml)}</i></span>`);
    if (mr > 0.5) out.push(`<span class="mk-ind rgt" style="left:${X(br.right)}px;top:${mid}px;width:${mr}px"><i>jobb behúzás ${cm(mr)}</i></span>`);
    if (Math.abs(ti) > 0.5) out.push(`<span class="mk-ind lft fl" style="left:${X(br.left) + pl + Math.min(0, ti)}px;top:${mid}px;width:${Math.abs(ti)}px"><i>${ti < 0 ? 'függő ' : 'első sor '}${cm(Math.abs(ti))}</i></span>`);
    if (hang > 0) out.push(`<span class="mk-ind lft fl" style="left:${X(br.left)}px;top:${mid2}px;width:${pl}px"><i>függő ${cm(pl)}</i></span>`);
    // differences from the template's paragraph style
    if (styles && !b.closest('td,th')) {
      const st = styles[b.tagName === 'P' ? 'p' : b.tagName.toLowerCase()];
      const notes = [];
      const lh = b.getAttribute('data-lh'), sb = b.getAttribute('data-sb'), sa = b.getAttribute('data-sa');
      if (!blank && st && lh != null && Math.abs(+lh - (+st.line || 0)) > 0.001) notes.push('sorköz ' + String(+lh).replace('.', ','));
      if (st && sb != null && Math.abs(+sb - (+st.spaceBefore || 0)) > 0.01) notes.push('előtte ' + String(+sb).replace('.', ',') + ' pt');
      if (st && sa != null && Math.abs(+sa - (+st.spaceAfter || 0)) > 0.01) notes.push('utána ' + String(+sa).replace('.', ',') + ' pt');
      if (notes.length) out.push(`<span class="mk-dev par" style="left:${X(br.right) + 4}px;top:${Y(br.top) + 1}px">${notes.join(' · ')}</span>`);
      // text runs with their own font, size or letter spacing
      if (st) for (const sp of b.querySelectorAll('span[style]')) {
        if (sp.closest(SKIP)) continue;
        const ss = sp.style, n2 = [];
        if (ss.fontSize && !blank) { const v = parseFloat(ss.fontSize); if (Math.abs(v - (+st.size || 0)) > 0.01) n2.push(String(v).replace('.', ',') + ' pt'); }
        if (ss.fontFamily && !blank) n2.push(famLabel(ss.fontFamily));   // no template: font, size, line spacing are not 'differences'
        if (ss.letterSpacing && ss.letterSpacing !== 'normal') { const v = parseFloat(ss.letterSpacing); if (Math.abs(v - (+st.letter || 0)) > 0.01) n2.push('betűköz ' + String(v).replace('.', ',') + ' pt'); }
        if (!n2.length) continue;
        const rs = Array.from(sp.getClientRects()).filter(q => q.width > 0);
        rs.forEach((q, k) => out.push(`<span class="mk-run" style="left:${X(q.left)}px;top:${Y(q.top)}px;width:${q.width / scale}px;height:${q.height / scale}px">${k === 0 ? `<i>${n2.join(' · ')}</i>` : ''}</span>`));
      }
    }
  }
  layer.innerHTML = out.join('');
}
