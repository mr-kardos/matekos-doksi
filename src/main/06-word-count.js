/* ------------------------------------------------------------------ */
/* Word count (bottom of the left panel) and statistics                */
/* ------------------------------------------------------------------ */
function docStats() {
  const doc = editor.state.doc;
  let text = '', images = 0, tables = 0;
  doc.descendants((n, pos, parent) => {
    if (n.type.name === 'image') { images++; return false; }
    if (n.type.name === 'table') tables++;
    if (n.isTextblock) { if (parent && parent.type.name === 'listItem' && parent.attrs.ghost && parent.firstChild === n) return false; text += '\n'; }
    if (n.isText) text += n.text;
    if (n.type.name === 'math') text += ' ' + 'ƒ' + ' ';          // a formula counts as one word / one character
    if (n.type.name === 'tab' || n.type.name === 'hardBreak') text += ' ';
    return true;
  });
  const words = (text.match(/\S+/g) || []).length;
  const chars = text.replace(/\n/g, '').length, noSpace = text.replace(/\s/g, '').length;
  // lines as they are on the pages (hidden holder lines and the app's own marks left out)
  let lines = 0;
  for (const b of editor.view.dom.querySelectorAll('p,h1,h2,h3')) {
    if (!b.getBoundingClientRect().height || b.closest('.pinned') && false) continue;
    const r = document.createRange(); r.selectNodeContents(b);
    const tops = new Set();
    for (const q of r.getClientRects()) if (q.width > 1 && q.height > 4) tops.add(Math.round(q.bottom / 4));
    lines += Math.max(b.textContent.trim() ? 1 : 0, tops.size);
  }
  return { words, chars, noSpace, lines, images, tables };
}
let statsTimer = 0;
function statsSoon() { clearTimeout(statsTimer); statsTimer = setTimeout(() => { const st = docStats(); $('#wordCount').textContent = `${st.words.toLocaleString('hu-HU')} szó`; }, 300); }
$('#wordCount').addEventListener('click', e => {
  const st = docStats(), f = n => n.toLocaleString('hu-HU');
  $('#statsBody').innerHTML = [['Szavak', st.words], ['Karakterek (szóközökkel)', st.chars], ['Karakterek (szóközök nélkül)', st.noSpace], ['Sorok', st.lines], ['Képek', st.images], ['Táblázatok', st.tables]]
    .map(([k, v]) => `<div class="srow"><span>${k}</span><b>${f(v)}</b></div>`).join('');
  showPop('popStats', e.currentTarget);
});

