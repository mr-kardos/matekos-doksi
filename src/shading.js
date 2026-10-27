// Line shading: full-width colour bands behind every line that contains line-shaded content.
// Bands use the real line boxes (so tall formulas are fully covered) and consecutive shaded
// lines – also across paragraphs on the same page – merge into one continuous block.
/** Space kept free for a paragraph line (CSS px): the paragraph gets this much extra padding on that side. */
export const RULE_GAP = 8;
const SKIP = ['tab', 'lm', 'pg-sp', 'pg-spb', 'ibar', 'isize', 'ih'];

function lineBoxes(block, toY, LH) {
  const rects = [];
  const range = document.createRange();
  const add = (r, isText, color) => { if (r.height > 0) rects.push({ top: r.top, bottom: r.bottom, text: isText, color }); };
  const shadeOf = el => { const s = el.closest('span[data-lshade]'); return s && block.contains(s) ? s.getAttribute('data-lshade') : null; };
  const walk = el => {
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        if (!n.data.length) continue;
        range.selectNodeContents(n);
        const c = shadeOf(n.parentElement);
        for (const r of range.getClientRects()) add(r, true, c);
      } else if (n.nodeType === 1) {
        const cl = n.classList;
        if (SKIP.some(k => cl.contains(k)) || n.tagName === 'BR') continue;
        if (cl.contains('math') || (cl.contains('imgw') && (cl.contains('inl') || cl.contains('ctr')))) { const c = shadeOf(n); for (const r of n.getClientRects()) add(r, false, c); continue; }
        if (cl.contains('imgw')) continue;
        walk(n);
      }
    }
  };
  walk(block);
  rects.sort((a, b) => (a.top + a.bottom) - (b.top + b.bottom));
  const lines = [];
  for (const r of rects) {
    const mid = (r.top + r.bottom) / 2, L = lines[lines.length - 1];
    if (L && mid >= L.top - 0.5 && mid <= L.bottom + 0.5) {
      L.top = Math.min(L.top, r.top); L.bottom = Math.max(L.bottom, r.bottom);
      if (r.text) { L.tTop = Math.min(L.tTop, r.top); L.tH = Math.max(L.tH, r.bottom - r.top); }
      if (r.color && !L.color) L.color = r.color;
    } else lines.push({ top: r.top, bottom: r.bottom, tTop: r.text ? r.top : Infinity, tH: r.text ? r.bottom - r.top : 0, color: r.color });
  }
  return lines.map(L => {
    const tt = Number.isFinite(L.tTop) ? L.tTop : L.top, th = L.tH || (L.bottom - L.top);
    const top = Math.min(toY(tt) - Math.max(0, (LH - toY(tt + th) + toY(tt)) / 2), toY(L.top));
    return { top, bottom: Math.max(top + LH, toY(L.bottom)), color: L.color };
  });
}

export function drawShadeBands(layer, editorDom, stackEl, scale, pageOf) {
  const sr = stackEl.getBoundingClientRect();
  const toY = cy => (cy - sr.top) / scale, toX = cx => (cx - sr.left) / scale;
  const bands = [];
  let cur = null, prevBlock = null;
  for (const block of editorDom.querySelectorAll('p,h1,h2,h3')) {
    if (!block.querySelector('span[data-lshade]')) { cur = null; prevBlock = null; continue; }
    const cs = getComputedStyle(block);
    const fs = parseFloat(cs.fontSize) || 16;
    const LH = cs.lineHeight === 'normal' ? fs * 1.2 : parseFloat(cs.lineHeight);
    const br = block.getBoundingClientRect();
    const left = toX(br.left), right = toX(br.right);
    const cTop = toY(br.top) + (parseFloat(cs.paddingTop) || 0), cBot = toY(br.bottom) - (parseFloat(cs.paddingBottom) || 0);
    const lines = lineBoxes(block, toY, LH);
    if (!lines.length) { cur = null; prevBlock = block; continue; }
    // make neighbouring line boxes touch exactly (they do in the real layout)
    if (lines[0].top - cTop < LH * 0.6) lines[0].top = Math.min(lines[0].top, cTop);
    const last = lines[lines.length - 1];
    if (cBot - last.bottom < LH * 0.6) last.bottom = Math.max(last.bottom, cBot);
    for (let k = 0; k + 1 < lines.length; k++) {
      const gap = lines[k + 1].top - lines[k].bottom;
      if (Math.abs(gap) < LH * 0.5) { const m = (lines[k].bottom + lines[k + 1].top) / 2; lines[k].bottom = m; lines[k + 1].top = m; }
    }
    const cell = block.closest('td,th');
    const sameFlow = !!prevBlock && prevBlock.closest('td,th') === cell && followsDirectly(prevBlock, block);
    lines.forEach((L, k) => {
      if (!L.color) { cur = null; return; }
      const joinable = cur && cur.color === L.color && pageOf(cur.bottom - 1) === pageOf(L.top + 1) && (k > 0 || sameFlow) && L.top - cur.bottom < LH * 2.5;
      if (joinable) { cur.bottom = Math.max(cur.bottom, L.bottom); cur.left = Math.min(cur.left, left); cur.right = Math.max(cur.right, right); }
      else { cur = { top: L.top, bottom: L.bottom, left, right, color: L.color }; bands.push(cur); }
    });
    if (!lines[lines.length - 1].color) cur = null;
    prevBlock = block;
  }
  // margin-to-margin lines above / below paragraphs (drawn here so they span the whole text column)
  const er = editorDom.getBoundingClientRect(), L0 = toX(er.left), W0 = er.width / scale;
  const rules = [];
  for (const b of editorDom.querySelectorAll('[data-rt],[data-rb]')) {
    const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
    const pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
    for (const [attr, y] of [['data-rt', toY(r.top) + pt - RULE_GAP / 2], ['data-rb', toY(r.bottom) - pb + RULE_GAP / 2]]) {
      const v = b.getAttribute(attr); if (!v) continue;
      const [w, c] = v.split(' '), px = (parseFloat(w) || 0.75) / 0.75;
      rules.push(`<div class="rule" style="left:${L0}px;top:${y - px / 2}px;width:${W0}px;height:${px}px;background:${c || '#111111'}"></div>`);
    }
  }
  layer.innerHTML = bands.map(b => `<div style="left:${b.left}px;top:${b.top}px;width:${b.right - b.left}px;height:${b.bottom - b.top}px;background:${b.color}"></div>`).join('') + rules.join('');
}

// true when no other text block sits between a and b in the document
function followsDirectly(a, b) {
  const all = a.ownerDocument.createTreeWalker(a.closest('.ProseMirror'), NodeFilter.SHOW_ELEMENT, {
    acceptNode: n => /^(P|H1|H2|H3)$/.test(n.tagName) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
  });
  all.currentNode = a;
  return all.nextNode() === b;
}
