// Line shading: full-width colour bands behind every line that contains line-shaded text.
// Bands of neighbouring lines (also across paragraphs) merge into one continuous block.
export function drawShadeBands(layer, editorDom, stackEl, scale) {
  const sr = stackEl.getBoundingClientRect();
  const lines = [];
  for (const span of editorDom.querySelectorAll('span[data-lshade]')) {
    const block = span.closest('p,h1,h2,h3,li,td,th') || editorDom;
    const cs = getComputedStyle(block);
    const fs = parseFloat(cs.fontSize) || 16;
    const LH = cs.lineHeight === 'normal' ? fs * 1.2 : parseFloat(cs.lineHeight);
    const br = block.getBoundingClientRect();
    const padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0;
    const left = (br.left - sr.left) / scale + padL, right = (br.right - sr.left) / scale - padR;
    for (const r of span.getClientRects()) {
      if (r.height <= 0 || r.width <= 0) continue;
      const h = r.height / scale;
      const top = (r.top - sr.top) / scale - Math.max(0, (LH - h) / 2);
      lines.push({ top, bottom: top + Math.max(LH, h), left, right, color: span.getAttribute('data-lshade') });
    }
  }
  lines.sort((a, b) => a.top - b.top);
  const bands = [];
  for (const L of lines) {
    const B = bands[bands.length - 1];
    if (B && B.color === L.color && L.top <= B.bottom + 0.5 && L.bottom >= B.top) {   // same line again
      B.bottom = Math.max(B.bottom, L.bottom); B.left = Math.min(B.left, L.left); B.right = Math.max(B.right, L.right); continue;
    }
    if (B && B.color === L.color && L.top - B.bottom <= 14) {                             // next line: join the gap
      B.bottom = L.bottom; B.left = Math.min(B.left, L.left); B.right = Math.max(B.right, L.right); continue;
    }
    bands.push({ ...L });
  }
  layer.innerHTML = bands.map(b => `<div style="left:${b.left}px;top:${b.top}px;width:${b.right - b.left}px;height:${b.bottom - b.top}px;background:${b.color}"></div>`).join('');
}
