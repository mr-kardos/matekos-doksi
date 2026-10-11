// Visual formula editor: the user builds the formula directly on the rendered picture
// (MathLive: cursor and dashed placeholders shown in the formula), with buttons for every
// notation used in the Hungarian (emelt szintű) érettségi. The TeX code stays available.
import { MathfieldElement } from 'mathlive';
import { renderInto } from './math.js';

/* ---- fonts of the editing view, embedded (works offline and in the browser version) ---- */
const FONT_FILES = import.meta.glob('/node_modules/mathlive/fonts/*.woff2', { query: '?inline', import: 'default', eager: true });
MathfieldElement.fontsDirectory = null;
MathfieldElement.soundsDirectory = null;
for (const [path, url] of Object.entries(FONT_FILES)) {
  const m = /KaTeX_([A-Za-z]+\d?)-([A-Za-z]+)\.woff2$/.exec(path);
  if (!m) continue;
  const family = 'KaTeX_' + m[1], v = m[2];
  try { const ff = new FontFace(family, `url(${url})`, { weight: /Bold/.test(v) ? '700' : '400', style: /Italic/.test(v) ? 'italic' : 'normal' }); document.fonts.add(ff); ff.load().catch(() => {}); } catch (e) { /* ignore */ }
}

const MACROS = {
  arctg: '\\operatorname{arc\\,tg}', arcctg: '\\operatorname{arc\\,ctg}',
  R: '\\mathbb{R}', N: '\\mathbb{N}', Z: '\\mathbb{Z}', Q: '\\mathbb{Q}'
};

const GREEK = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ',
    pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω'
  };

/* ---- palettes: [label, TeX template, tooltip]. #0 = selection or placeholder, #? = placeholder, #@ = what precedes the cursor ---- */
const FREQUENT = [
  ['<span class="fr"><i>a</i><b></b><i>b</i></span>', '\\frac{#@}{#?}', 'Tört'],
  ['√▢', '\\sqrt{#0}', 'Négyzetgyök'], ['ⁿ√▢', '\\sqrt[#?]{#0}', 'n-edik gyök'],
  ['x²', '#@^{2}', 'Négyzet'], ['xⁿ', '#@^{#?}', 'Hatvány'], ['xₙ', '#@_{#?}', 'Alsó index'],
  ['( )', '\\left(#0\\right)', 'Kerek zárójel'], ['[ ]', '\\left[#0\\right]', 'Szögletes zárójel'], ['{ }', '\\left\\{#0\\right\\}', 'Kapcsos zárójel'], ['|x|', '\\left|#0\\right|', 'Abszolútérték'],
  ['·', '\\cdot', 'Szorzás'], ['±', '\\pm', 'Plusz-mínusz'], ['≤', '\\le', 'Kisebb vagy egyenlő'], ['≥', '\\ge', 'Nagyobb vagy egyenlő'], ['≠', '\\ne', 'Nem egyenlő'], ['≈', '\\approx', 'Közelítőleg'],
  ['π', '\\pi', 'pí'], ['∞', '\\infty', 'Végtelen'], ['°', '^{\\circ}', 'Fok'],
  ['tg', '\\tg', 'Tangens'], ['log<sub>a</sub>', '\\log_{#?}#0', 'Logaritmus'], ['ln', '\\ln', 'Természetes logaritmus'],
  ['<span class="big">∫</span><sub>a</sub><sup>b</sup>', '\\int_{#?}^{#?}#?\\,\\mathrm{d}x', 'Határozott integrál'], ['∑', '\\sum_{#?}^{#?}', 'Összeg'],
  ['lim', '\\lim_{#?\\to#?}', 'Határérték'], ['a⃗', '\\vec{#0}', 'Vektor'], ['f′', "#@'", 'Derivált (vessző)']
];
const CATS = [
  ['Alapok', [
    ['+', '+'], ['−', '-'], ['·', '\\cdot', 'Szorzás'], ['×', '\\times', 'Kereszt'], [':', ':', 'Osztás'], ['÷', '\\div'], ['=', '='], ['≠', '\\ne'], ['≈', '\\approx'], ['≡', '\\equiv', 'Azonosan egyenlő'],
    ['<', '<'], ['>', '>'], ['≤', '\\le'], ['≥', '\\ge'], ['≪', '\\ll'], ['≫', '\\gg'], ['±', '\\pm', 'Plusz-mínusz'], ['∓', '\\mp', 'Mínusz-plusz'], ['%', '\\%'], ['!', '!', 'Faktoriális'],
    ['<span class="fr"><i>a</i><b></b><i>b</i></span>', '\\frac{#@}{#?}', 'Tört'], ['▢<span class="fr"><i>▢</i><b></b><i>▢</i></span>', '#?\\frac{#?}{#?}', 'Vegyes szám'],
    ['√▢', '\\sqrt{#0}', 'Négyzetgyök'], ['ⁿ√▢', '\\sqrt[#?]{#0}', 'n-edik gyök'], ['x²', '#@^{2}', 'Négyzet'], ['x³', '#@^{3}', 'Köb'], ['xⁿ', '#@^{#?}', 'Hatvány'], ['xₙ', '#@_{#?}', 'Alsó index'], ['xₙᵐ', '#@_{#?}^{#?}', 'Alsó és felső index'], ['10ⁿ', '10^{#?}', 'Tíz hatványa'],
    ['( )', '\\left(#0\\right)'], ['[ ]', '\\left[#0\\right]'], ['{ }', '\\left\\{#0\\right\\}'], ['|x|', '\\left|#0\\right|', 'Abszolútérték'], ['⌊x⌋', '\\lfloor #0\\rfloor', 'Alsó egészrész'], ['⌈x⌉', '\\lceil #0\\rceil', 'Felső egészrész'],
    ['x̄', '\\overline{#0}', 'Felülvonás'], ['x̲', '\\underline{#0}', 'Aláhúzás'], ['…', '\\ldots', 'Pontok'], ['⋯', '\\cdots', 'Középső pontok'], ['∣', '\\mid', 'Osztója'], ['∤', '\\nmid', 'Nem osztója'], ['mod', '\\equiv#?\\pmod{#?}', 'Kongruencia (mod)']
  ]],
  ['Görög', [
    ...'alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega'.split(' ').map(n => [GREEK[n], '\\' + n, n]),
    ['ο', 'o', 'omikron'],
    ...'Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega'.split(' ').map(n => [GREEK[n], '\\' + n, n])
  ]],
  ['Függvények', [
    ['sin', '\\sin'], ['cos', '\\cos'], ['tg', '\\tg'], ['ctg', '\\ctg'], ['arcsin', '\\arcsin'], ['arccos', '\\arccos'], ['arc tg', '\\arctg'], ['arc ctg', '\\arcctg'],
    ['sh', '\\sh'], ['ch', '\\ch'], ['th', '\\th'],
    ['log<sub>a</sub>', '\\log_{#?}#0'], ['lg', '\\lg'], ['ln', '\\ln'], ['log₂', '\\log_{2}'], ['exp', '\\exp'], ['e', '\\mathrm{e}', 'Euler-szám'], ['eˣ', '\\mathrm{e}^{#?}', 'e hatványa'],
    ['f(x)', 'f\\left(#?\\right)', 'Függvényérték'], ['f⁻¹', 'f^{-1}', 'Inverz függvény'], ['∘', '\\circ', 'Kompozíció'], ['f′', "#@'", 'Derivált'], ['f″', "#@''", 'Második derivált'],
    ['sgn', '\\operatorname{sgn}', 'Előjelfüggvény'], ['max', '\\max'], ['min', '\\min'], ['D<sub>f</sub>', 'D_{f}', 'Értelmezési tartomány'], ['R<sub>f</sub>', 'R_{f}', 'Értékkészlet'], ['↦', '\\mapsto', 'Hozzárendelés']
  ]],
  ['Analízis', [
    ['lim', '\\lim_{#?\\to#?}', 'Határérték'], ['lim<sub>n→∞</sub>', '\\lim_{n\\to\\infty}', 'Sorozat határértéke'], ['lim<sub>x→∞</sub>', '\\lim_{x\\to\\infty}'], ['→', '\\to'], ['∞', '\\infty'],
    ['f′', "#@'", 'Derivált'], ['f″', "#@''", 'Második derivált'], ['f‴', "#@'''", 'Harmadik derivált'],
    ['<span class="fr"><i>d</i><b></b><i>dx</i></span>', '\\frac{\\mathrm{d}}{\\mathrm{d}x}', 'Deriválás x szerint'], ['<span class="fr"><i>dy</i><b></b><i>dx</i></span>', '\\frac{\\mathrm{d}#?}{\\mathrm{d}#?}', 'Differenciálhányados'],
    ['∂', '\\partial', 'Parciális'], ['<span class="fr"><i>∂</i><b></b><i>∂x</i></span>', '\\frac{\\partial #?}{\\partial #?}', 'Parciális derivált'],
    ['∫', '\\int #0\\,\\mathrm{d}x', 'Határozatlan integrál'], ['<span class="big">∫</span><sub>a</sub><sup>b</sup>', '\\int_{#?}^{#?}#?\\,\\mathrm{d}x', 'Határozott integrál'],
    ['[F]<sub>a</sub><sup>b</sup>', '\\left[#0\\right]_{#?}^{#?}', 'Newton–Leibniz'], ['dx', '\\mathrm{d}x'], ['Δ', '\\Delta'],
    ['∑', '\\sum_{#?}^{#?}', 'Összeg'], ['∏', '\\prod_{#?}^{#?}', 'Szorzat'], ['(a<sub>n</sub>)', '\\left(a_{n}\\right)', 'Sorozat'], ['a<sub>n</sub>', 'a_{n}'], ['S<sub>n</sub>', 'S_{n}']
  ]],
  ['Halmazok', [
    ['ℕ', '\\mathbb{N}', 'Természetes számok'], ['ℤ', '\\mathbb{Z}', 'Egész számok'], ['ℚ', '\\mathbb{Q}', 'Racionális számok'], ['ℚ*', '\\mathbb{Q}^{*}', 'Irracionális számok'], ['ℝ', '\\mathbb{R}', 'Valós számok'], ['ℂ', '\\mathbb{C}', 'Komplex számok'],
    ['ℕ⁺', '\\mathbb{N}^{+}'], ['ℤ⁺', '\\mathbb{Z}^{+}'], ['ℤ⁻', '\\mathbb{Z}^{-}'], ['ℝ⁺', '\\mathbb{R}^{+}'], ['ℝ⁻', '\\mathbb{R}^{-}'], ['ℝ∖{0}', '\\mathbb{R}\\setminus\\left\\{0\\right\\}'],
    ['∈', '\\in', 'Eleme'], ['∉', '\\notin', 'Nem eleme'], ['∋', '\\ni'], ['⊂', '\\subset', 'Valódi része'], ['⊆', '\\subseteq', 'Része'], ['⊄', '\\not\\subset'], ['⊃', '\\supset'], ['⊇', '\\supseteq'],
    ['∪', '\\cup', 'Unió'], ['∩', '\\cap', 'Metszet'], ['∖', '\\setminus', 'Különbség'], ['∅', '\\emptyset', 'Üres halmaz'], ['Ā', '\\overline{#0}', 'Komplementer'], ['|A|', '\\left|#0\\right|', 'Elemszám'], ['×', '\\times', 'Descartes-szorzat'],
    ['{x | …}', '\\left\\{#?\\mid #?\\right\\}', 'Halmaz megadása'], [']a;b[', '\\left]#?;#?\\right[', 'Nyílt intervallum'], ['[a;b]', '\\left[#?;#?\\right]', 'Zárt intervallum'], ['[a;b[', '\\left[#?;#?\\right[', 'Balról zárt'], [']a;b]', '\\left]#?;#?\\right]', 'Jobbról zárt']
  ]],
  ['Logika', [
    ['∧', '\\land', 'és'], ['∨', '\\lor', 'vagy'], ['¬', '\\neg', 'nem'], ['⇒', '\\Rightarrow', 'Következik'], ['⇐', '\\Leftarrow'], ['⇔', '\\Leftrightarrow', 'Akkor és csak akkor'],
    ['∀', '\\forall', 'Minden'], ['∃', '\\exists', 'Létezik'], ['∄', '\\nexists', 'Nem létezik'], ['→', '\\to'], ['↔', '\\leftrightarrow'], ['⊕', '\\oplus', 'Kizáró vagy'], ['∴', '\\therefore', 'Tehát'], ['Ā', '\\overline{#0}', 'Tagadás (felülvonás)']
  ]],
  ['Geometria', [
    ['a⃗', '\\vec{#0}', 'Vektor'], ['AB⃗', '\\overrightarrow{#0}', 'Vektor (két pont)'], ['AB̅', '\\overline{#0}', 'Szakasz'], ['x̲', '\\underline{#0}', 'Aláhúzás'], ['â', '\\hat{#0}'], ['|AB|', '\\left|#0\\right|', 'Hossz'],
    ['∠', '\\angle', 'Szög'], ['∢', '\\measuredangle', 'Irányított szög'], ['°', '^{\\circ}', 'Fok'], ['′', "'", 'Vessző (perc, derivált)'], ['″', "''", 'Két vessző'],
    ['⊥', '\\perp', 'Merőleges'], ['∥', '\\parallel', 'Párhuzamos'], ['△', '\\triangle', 'Háromszög'], ['≅', '\\cong', 'Egybevágó'], ['∼', '\\sim', 'Hasonló'], ['AB⌒', '\\overset{\\frown}{#0}', 'Ív'],
    ['(x;y)', '\\left(#?;#?\\right)', 'Pont / koordináták'], ['<span class="col">x<br>y</span>', '\\begin{pmatrix}#?\\\\#?\\end{pmatrix}', 'Oszlopvektor'], ['d(P;e)', 'd\\left(#?;#?\\right)', 'Távolság'], ['×', '\\times', 'Vektoriális szorzat'], ['·', '\\cdot', 'Skaláris szorzat']
  ]],
  ['Mátrix', [
    ['(2×2)', '\\begin{pmatrix}#?&#?\\\\#?&#?\\end{pmatrix}', 'Mátrix 2×2'], ['(3×3)', '\\begin{pmatrix}#?&#?&#?\\\\#?&#?&#?\\\\#?&#?&#?\\end{pmatrix}', 'Mátrix 3×3'],
    ['[2×2]', '\\begin{bmatrix}#?&#?\\\\#?&#?\\end{bmatrix}', 'Mátrix szögletes zárójellel'], ['|2×2|', '\\begin{vmatrix}#?&#?\\\\#?&#?\\end{vmatrix}', 'Determináns 2×2'], ['|3×3|', '\\begin{vmatrix}#?&#?&#?\\\\#?&#?&#?\\\\#?&#?&#?\\end{vmatrix}', 'Determináns 3×3'],
    ['{ 2 egyenlet', '\\begin{cases}#?\\\\#?\\end{cases}', 'Egyenletrendszer (2)'], ['{ 3 egyenlet', '\\begin{cases}#?\\\\#?\\\\#?\\end{cases}', 'Egyenletrendszer (3)'],
    ['{ esetek', '\\begin{cases}#?, & \\text{ha } #?\\\\#?, & \\text{ha } #?\\end{cases}', 'Esetszétválasztás'], ['Aᵀ', '#@^{T}', 'Transzponált'], ['A⁻¹', '#@^{-1}', 'Inverz']
  ]],
  ['Valószínűség', [
    ['n!', '#@!', 'Faktoriális'], ['(n k)', '\\binom{#?}{#?}', 'Binomiális együttható'], ['P(A)', 'P\\left(#?\\right)', 'Valószínűség'], ['P(A|B)', 'P\\left(#?\\mid #?\\right)', 'Feltételes valószínűség'],
    ['x̄', '\\bar{#0}', 'Átlag'], ['σ', '\\sigma', 'Szórás'], ['σ²', '\\sigma^{2}', 'Szórásnégyzet'], ['M(ξ)', 'M\\left(#?\\right)', 'Várható érték'], ['D(ξ)', 'D\\left(#?\\right)', 'Szórás'], ['ξ', '\\xi'], ['∑', '\\sum_{#?}^{#?}']
  ]],
  ['Nyilak', [
    ['→', '\\to'], ['←', '\\leftarrow'], ['↔', '\\leftrightarrow'], ['⇒', '\\Rightarrow'], ['⇐', '\\Leftarrow'], ['⇔', '\\Leftrightarrow'], ['↦', '\\mapsto'], ['↑', '\\uparrow'], ['↓', '\\downarrow'], ['⟶', '\\longrightarrow'], ['⟹', '\\Longrightarrow']
  ]],
  ['Egyéb', [
    ['szöveg', '\\text{#?}', 'Szöveg a képletben'], ['kis köz', '\\,', 'Kis szóköz'], ['köz', '\\quad', 'Szóköz'], ['∝', '\\propto', 'Arányos'], ['≐', '\\doteq'], ['≙', '\\triangleq', 'Definíció szerint'], ['∗', '\\ast'], ['†', '\\dagger'], ['ℓ', '\\ell'], ['ℏ', '\\hbar'], ['∅', '\\varnothing']
  ]]
];
/* ---- the dialog ---- */
let dlg, mf, texBox, prev, onApply = null, onDelete = null, cats, palette, curCat = 0, dragging = null;

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function btn(item, i, group) {
  const [label, , title] = item;
  return `<button class="mk" data-g="${group}" data-i="${i}" title="${esc(title || item[1])}">${label}</button>`;
}
function insert(tpl) {
  mf.focus();
  mf.executeCommand(['insert', tpl, { selectionMode: 'placeholder', focus: true, format: 'latex' }]);
  syncFromField();
}
function cleanTex() { return (mf.getValue('latex-without-placeholders') || '').trim(); }
function syncFromField() {
  if (document.activeElement !== texBox) texBox.value = mf.value;
  const t = mf.value.replace(/\\placeholder\{\}/g, '\\square ');
  if (t.trim()) renderInto(prev, t, false); else prev.innerHTML = '<span class="mph">A végleges képlet (Bonum betűkkel) itt jelenik meg</span>';
}
function markPlaceholders() {
  const root = mf.shadowRoot; if (!root) return;
  for (const s of root.querySelectorAll('span')) if (s.childElementCount === 0 && s.textContent === '\u25A2' && !s.classList.contains('kv-ph')) s.classList.add('kv-ph');
}

function build() {
  dlg = document.getElementById('mathDlg');
  dlg.innerHTML = `
    <div class="md-head" id="mdHead"><b>Képletszerkesztő</b><span class="phint">Kattints a képletbe, és építsd fel a gombokkal vagy gépeléssel · Enter: kész · Esc: bezár</span><button class="md-x" id="mdX" aria-label="Bezárás">×</button></div>
    <div class="mk-row mk-freq" id="mkFreq">${FREQUENT.map((it, i) => btn(it, i, 'f')).join('')}</div>
    <div class="mk-tabs" id="mkTabs">${CATS.map((c, i) => `<button data-c="${i}" class="${i === 0 ? 'on' : ''}">${c[0]}</button>`).join('')}</div>
    <div class="mk-row mk-pal" id="mkPal"></div>
    <math-field id="mdField" math-virtual-keyboard-policy="manual"></math-field>
    <details class="md-tex"><summary>TeX-kód</summary><textarea id="mdTex" spellcheck="false" rows="2"></textarea></details>
    <div class="md-prevwrap"><span class="md-plabel">Végleges megjelenés</span><div class="md-prev" id="mdPrev"></div></div>
    <div class="md-foot"><span class="sp"></span><button class="btn" id="mdDel" hidden>Képlet törlése</button><button class="btn" id="mdCancel">Mégse</button><button class="btn primary" id="mdOk">Beszúrás</button></div>`;
  mf = dlg.querySelector('#mdField');
  texBox = dlg.querySelector('#mdTex');
  prev = dlg.querySelector('#mdPrev');
  palette = dlg.querySelector('#mkPal');
  cats = dlg.querySelector('#mkTabs');
  mf.macros = { ...mf.macros, ...Object.fromEntries(Object.entries(MACROS).map(([k, v]) => [k, { args: 0, def: v, captureSelection: true, expand: false }])) };
  mf.menuItems = [];
  mf.smartFence = true;
  mf.addEventListener('input', () => { markPlaceholders(); syncFromField(); });
  mf.addEventListener('selection-change', markPlaceholders);
  new MutationObserver(markPlaceholders).observe(mf.shadowRoot, { subtree: true, childList: true, characterData: true });
  const st = document.createElement('style');
  st.textContent = '.kv-ph{display:inline-block!important;width:.6em;height:.76em;line-height:.76em;vertical-align:-.03em;color:transparent!important;outline:1.5px dashed #2f9a46;outline-offset:-1px;border-radius:1px}';
  mf.shadowRoot.appendChild(st);
  mf.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); apply(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  }, true);
  texBox.addEventListener('input', () => { mf.value = texBox.value; markPlaceholders(); syncFromField(); });
  texBox.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); apply(); } else if (e.key === 'Escape') close(); });
  const pick = e => {
    const b = e.target.closest('.mk'); if (!b) return;
    const list = b.dataset.g === 'f' ? FREQUENT : CATS[curCat][1];
    insert(list[+b.dataset.i][1]);
  };
  for (const id of ['#mkFreq', '#mkPal']) { const el = dlg.querySelector(id); el.addEventListener('mousedown', e => e.preventDefault()); el.addEventListener('click', pick); }
  cats.addEventListener('mousedown', e => e.preventDefault());
  cats.addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (b) showCat(+b.dataset.c); });
  dlg.querySelector('#mdX').addEventListener('click', close);
  dlg.querySelector('#mdCancel').addEventListener('click', close);
  dlg.querySelector('#mdOk').addEventListener('click', apply);
  dlg.querySelector('#mdDel').addEventListener('click', () => { const d = onDelete; hide(); d && d(); });
  // drag the window by its title bar
  const head = dlg.querySelector('#mdHead');
  head.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    const r = dlg.getBoundingClientRect();
    dragging = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', e => {
    if (!dragging) return;
    const w = dlg.offsetWidth, h = dlg.offsetHeight;
    dlg.style.left = Math.max(0, Math.min(innerWidth - w, e.clientX - dragging.dx)) + 'px';
    dlg.style.top = Math.max(0, Math.min(innerHeight - 40, e.clientY - dragging.dy)) + 'px';
    dlg.style.transform = 'none';
  });
  head.addEventListener('pointerup', () => { dragging = null; });
  showCat(0);
}
function showCat(i) {
  curCat = i;
  for (const b of cats.children) b.classList.toggle('on', +b.dataset.c === i);
  palette.innerHTML = CATS[i][1].map((it, k) => btn(it, k, 'c')).join('');
}
function hide() { dlg.hidden = true; onApply = onDelete = null; }
function close() { const a = onApply; hide(); a && a(null); }
function apply() { const a = onApply, t = cleanTex(); hide(); a && a(t); }

/**
 * Open the editor. onApply(tex) is called with the final TeX ('' = empty), or null when cancelled.
 */
export function openMathEditor({ tex = '', editing = false, top = 80, onApply: ok, onDelete: del }) {
  if (!dlg) build();
  onApply = ok; onDelete = del;
  dlg.querySelector('#mdOk').textContent = editing ? 'Frissítés' : 'Beszúrás';
  dlg.querySelector('#mdDel').hidden = !editing;
  if (!dlg.style.left) { dlg.style.top = top + 'px'; }
  dlg.hidden = false;
  mf.value = tex;
  texBox.value = tex;
  syncFromField();
  requestAnimationFrame(() => { markPlaceholders(); mf.focus(); mf.executeCommand('moveToMathfieldEnd'); });
}
export function isMathEditorOpen() { return dlg && !dlg.hidden; }
