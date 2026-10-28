// MathType and Microsoft Equation Editor 3.0 objects -> TeX.
// An embedded equation (PowerPoint: ppt/embeddings/oleObject*.bin) is an OLE compound file whose
// "Equation Native" stream holds a 28-byte header and the formula in MathType's MTEF format
// (version 5: MathType 4-7, version 3: Equation Editor 3.0 / MathType 3). The MTEF records are read
// into a tree (lines, characters, templates, piles, matrices) and written out as TeX that MathJax and
// the Matekos formula editor understand. Format description: Design Science / WIRIS, "MTEF v5".
import CFB from 'cfb';
import { PUA } from './mtefpua.js';

/* ---------- byte reader ---------- */
class Reader {
  constructor(u8) { this.b = u8; this.p = 0; }
  get end() { return this.p >= this.b.length; }
  u8() { if (this.p >= this.b.length) throw new Error('MTEF: unexpected end'); return this.b[this.p++]; }
  u16() { const v = this.b[this.p] | (this.b[this.p + 1] << 8); this.p += 2; return v; }
  i16() { const v = this.u16(); return v > 0x7fff ? v - 0x10000 : v; }
  str() { let s = ''; for (let c = this.u8(); c; c = this.u8()) s += String.fromCharCode(c); return s; }
  peek() { return this.b[this.p]; }
}

/* ---------- MTEF 5 ---------- */
const R = {END: 0, LINE: 1, CHAR: 2, TMPL: 3, PILE: 4, MATRIX: 5, EMBELL: 6, RULER: 7, FONT_STYLE_DEF: 8, SIZE: 9, FULL: 10, SUB: 11, SUB2: 12,
  SYM: 13, SUBSYM: 14, COLOR: 15, COLOR_DEF: 16, FONT_DEF: 17, EQN_PREFS: 18, ENCODING_DEF: 19};

function nudge5(r) { const a = r.u8(), b = r.u8(); if (a === 128 || b === 128) { r.i16(); r.i16(); } }
function ruler(r) { const n = r.u8(); for (let i = 0; i < n; i++) { r.u8(); r.u16(); } }
function dims(r, count) {            // nibble-coded dimension arrays (EQN_PREFS)
  let got = 0, first = true;
  while (got < count) {
    const c = r.u8();
    for (const nb of [c >> 4, c & 15]) { if (got >= count) break; if (first) first = false; else if (nb === 15) { got++; first = true; } }
  }
}
/** Read one object list (until END) of MTEF 5. Returns nodes. */
function list5(r, stopAtEnd = true) {
  const out = [];
  while (!r.end) {
    const tag = r.u8();
    if (tag === R.END) { if (stopAtEnd) return out; continue; }
    if (tag >= 100) { const n = r.u8(); r.p += n; continue; }          // future records: length + data
    switch (tag) {
      case R.LINE: {
        const o = r.u8();
        if (o & 0x08) nudge5(r);
        if (o & 0x04) r.u8();                                       // line spacing
        if (o & 0x02) { if (r.peek() === R.RULER) r.u8(); ruler(r); }
        out.push({t: 'line', kids: o & 0x01 ? [] : list5(r)});
        break;
      }
      case R.CHAR: {
        const o = r.u8();
        if (o & 0x08) nudge5(r);
        const tf = r.u8() - 128;
        let code = null;
        if (!(o & 0x20)) code = r.u16();                            // MTCode (Unicode)
        if (o & 0x04) { const c8 = r.u8(); if (code == null) code = c8; }
        if (o & 0x10) { const c16 = r.u16(); if (code == null) code = c16; }
        const ch = {t: 'char', tf, code, emb: []};
        if (o & 0x01) ch.emb = list5(r).filter(n => n.t === 'embell').map(n => n.e);
        out.push(ch);
        break;
      }
      case R.TMPL: {
        const o = r.u8();
        if (o & 0x08) nudge5(r);
        const sel = r.u8();
        let v = r.u8(); if (v & 0x80) v = (v & 0x7f) | (r.u8() << 8);
        r.u8();                                                     // template-specific options
        out.push({t: 'tmpl', sel, v, kids: list5(r)});
        break;
      }
      case R.PILE: {
        const o = r.u8();
        if (o & 0x08) nudge5(r);
        const halign = r.u8(); r.u8();                              // valign
        if (o & 0x02) { if (r.peek() === R.RULER) r.u8(); ruler(r); }
        out.push({t: 'pile', halign, kids: list5(r)});
        break;
      }
      case R.MATRIX: {
        const o = r.u8();
        if (o & 0x08) nudge5(r);
        r.u8(); r.u8(); r.u8();                                     // valign, h_just, v_just
        const rows = r.u8(), cols = r.u8();
        r.p += Math.ceil((rows + 1) * 2 / 8) + Math.ceil((cols + 1) * 2 / 8);   // row / column partition lines
        out.push({t: 'matrix', rows, cols, kids: list5(r)});
        break;
      }
      case R.EMBELL: { const o = r.u8(); if (o & 0x08) nudge5(r); out.push({t: 'embell', e: r.u8()}); break; }
      case R.RULER: ruler(r); break;
      case R.FONT_STYLE_DEF: r.u8(); r.u8(); break;
      case R.SIZE: { const l = r.u8(); if (l === 101) r.u16(); else if (l === 100) { r.u8(); r.u16(); } else r.u8(); break; }
      case R.FULL: case R.SUB: case R.SUB2: case R.SYM: case R.SUBSYM: break;
      case R.COLOR: r.u8(); break;
      case R.COLOR_DEF: { const o = r.u8(); for (let i = 0; i < (o & 1 ? 4 : 3); i++) r.u16(); if (o & 4) r.str(); break; }
      case R.FONT_DEF: r.u8(); r.str(); break;
      case R.EQN_PREFS: { r.u8(); dims(r, r.u8()); dims(r, r.u8()); const n = r.u8(); for (let i = 0; i < n; i++) if (r.u8()) r.u8(); break; }
      case R.ENCODING_DEF: r.str(); break;
      default: throw new Error('MTEF: unknown record ' + tag);
    }
  }
  return out;
}

/* ---------- MTEF 3 (Equation Editor 3.0): the record type is the low nibble, options the high nibble ---------- */
function list3(r) {
  const out = [];
  while (!r.end) {
    const b = r.u8(), tag = b & 0x0f, o = b >> 4;
    if (tag === 0) return out;
    const nud = () => { if (o & 0x08) { const a = r.u8(), c = r.u8(); if (a === 128 || c === 128) { r.u16(); r.u16(); } } };
    switch (tag) {
      case 1: nud(); if (o & 0x04) r.u8(); if (o & 0x02) { if ((r.peek() & 15) === 7) r.u8(); ruler(r); } out.push({t: 'line', kids: o & 0x01 ? [] : list3(r)}); break;
      case 2: { nud(); const tf = r.u8() - 128, code = r.u16(); const ch = {t: 'char', tf, code, emb: []}; if (o & 0x02) ch.emb = list3(r).filter(n => n.t === 'embell').map(n => n.e); out.push(ch); break; }
      case 3: { nud(); const sel = r.u8(), v = r.u8(); r.u8(); out.push({t: 'tmpl', sel, v, kids: list3(r)}); break; }
      case 4: { nud(); const halign = r.u8(); r.u8(); if (o & 0x02) { if ((r.peek() & 15) === 7) r.u8(); ruler(r); } out.push({t: 'pile', halign, kids: list3(r)}); break; }
      case 5: { nud(); r.u8(); r.u8(); r.u8(); const rows = r.u8(), cols = r.u8(); r.p += Math.ceil((rows + 1) * 2 / 8) + Math.ceil((cols + 1) * 2 / 8); out.push({t: 'matrix', rows, cols, kids: list3(r)}); break; }
      case 6: nud(); out.push({t: 'embell', e: r.u8()}); break;
      case 7: ruler(r); break;
      case 8: r.u8(); r.u8(); r.str(); break;                       // FONT
      case 9: { const l = r.u8(); if (l === 101) r.u16(); else r.u8(); break; }   // SIZE
      case 10: case 11: case 12: case 13: case 14: break;           // FULL, SUB, SUB2, SYM, SUBSYM
      default: throw new Error('MTEF3: unknown record ' + tag);
    }
  }
  return out;
}

/* ---------- characters -> TeX ---------- */
const TF = {TEXT: 1, FUNCTION: 2, VARIABLE: 3, LCGREEK: 4, UCGREEK: 5, SYMBOL: 6, VECTOR: 7, NUMBER: 8, USER1: 9, USER2: 10, MTEXTRA: 11, TEXT_FE: 12, EXPAND: 22, MARKER: 23, SPACE: 24};
const GREEK = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho varsigma sigma tau upsilon phi chi psi omega'.split(' ');
const UNI = {
  0x2212: '-', 0x2013: '-', 0x00B1: '\\pm', 0x2213: '\\mp', 0x00D7: '\\times', 0x00F7: '\\div', 0x22C5: '\\cdot', 0x00B7: '\\cdot', 0x2219: '\\cdot', 0x2022: '\\bullet', 0x2217: '\\ast',
  0x2264: '\\le', 0x2265: '\\ge', 0x2260: '\\ne', 0x2248: '\\approx', 0x2261: '\\equiv', 0x2245: '\\cong', 0x223C: '\\sim', 0x2243: '\\simeq', 0x221D: '\\propto', 0x226A: '\\ll', 0x226B: '\\gg',
  0x221E: '\\infty', 0x2208: '\\in', 0x2209: '\\notin', 0x220B: '\\ni', 0x2282: '\\subset', 0x2283: '\\supset', 0x2286: '\\subseteq', 0x2287: '\\supseteq', 0x2284: '\\not\\subset',
  0x222A: '\\cup', 0x2229: '\\cap', 0x2216: '\\setminus', 0x2205: '\\emptyset', 0x2200: '\\forall', 0x2203: '\\exists', 0x2204: '\\nexists', 0x00AC: '\\neg', 0x2227: '\\land', 0x2228: '\\lor',
  0x2192: '\\to', 0x2190: '\\leftarrow', 0x2194: '\\leftrightarrow', 0x21D2: '\\Rightarrow', 0x21D0: '\\Leftarrow', 0x21D4: '\\Leftrightarrow', 0x2191: '\\uparrow', 0x2193: '\\downarrow', 0x21A6: '\\mapsto',
  0x27F6: '\\longrightarrow', 0x27F9: '\\Longrightarrow', 0x2220: '\\angle', 0x2221: '\\measuredangle', 0x22A5: '\\perp', 0x2225: '\\parallel', 0x2016: '\\|', 0x2223: '\\mid', 0x2224: '\\nmid', 0x25B3: '\\triangle',
  0x2032: "'", 0x2033: "''", 0x2034: "'''", 0x00B0: '^{\\circ}', 0x2026: '\\ldots', 0x22EF: '\\cdots', 0x22EE: '\\vdots', 0x22F1: '\\ddots', 0x2234: '\\therefore', 0x2235: '\\because',
  0x221A: '\\surd', 0x2211: '\\sum', 0x220F: '\\prod', 0x2210: '\\coprod', 0x222B: '\\int', 0x222C: '\\iint', 0x222D: '\\iiint', 0x222E: '\\oint', 0x22C3: '\\bigcup', 0x22C2: '\\bigcap',
  0x2202: '\\partial', 0x2207: '\\nabla', 0x2118: '\\wp', 0x2111: '\\Im', 0x211C: '\\Re', 0x2135: '\\aleph', 0x210F: '\\hbar', 0x2113: '\\ell', 0x2295: '\\oplus', 0x2297: '\\otimes', 0x2218: '\\circ',
  0x2124: '\\mathbb{Z}', 0x211D: '\\mathbb{R}', 0x2115: '\\mathbb{N}', 0x211A: '\\mathbb{Q}', 0x2102: '\\mathbb{C}', 0x27E8: '\\langle', 0x27E9: '\\rangle', 0x2329: '\\langle', 0x232A: '\\rangle',
  0x230A: '\\lfloor', 0x230B: '\\rfloor', 0x2308: '\\lceil', 0x2309: '\\rceil', 0x00A0: '~', 0x2009: '\\,', 0x2002: '\\;', 0x2003: '\\quad', 0x200A: '\\,', 0x2001: '\\qquad', 0x200B: '',
  0x03D1: '\\vartheta', 0x03D5: '\\phi', 0x03C6: '\\varphi', 0x03F5: '\\epsilon', 0x03B5: '\\varepsilon', 0x03D6: '\\varpi', 0x03F1: '\\varrho', 0x00AF: '\\overline{}', 0x2015: '-',
  0x0025: '\\%', 0x0023: '\\#', 0x0026: '\\&', 0x005F: '\\_', 0x0024: '\\$', 0x007B: '\\{', 0x007D: '\\}', 0x005C: '\\backslash', 0x007E: '\\sim', 0x005E: '\\hat{}'
};
function charTeX(c) {
  const {code, tf} = c;
  if (code == null) return '';
  if (code >= 0xE000 && code <= 0xF8FF) { const v = PUA['m' + code] ?? PUA[String(code)]; return v ?? ''; }
  if (tf === TF.SPACE) return code === 0xEF00 ? '' : '\\,';
  if (UNI[code] != null) return UNI[code];
  if (code >= 0x3B1 && code <= 0x3C9) return '\\' + GREEK[code - 0x3B1] + ' ';
  if (code >= 0x391 && code <= 0x3A9) { const n = GREEK[code - 0x391]; if (!n || n === 'varsigma') return ''; const N = n[0].toUpperCase() + n.slice(1);
    return 'ΓΔΘΛΞΠΣΥΦΨΩ'.includes(String.fromCodePoint(code)) ? '\\' + N + ' ' : String.fromCodePoint(code); }
  return String.fromCodePoint(code);
}
const FUNCS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'tg', 'ctg', 'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'deg', 'dim', 'gcd', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'arctg', 'arcctg', 'sh', 'ch', 'th', 'arg', 'ker', 'Pr', 'mod']);
const funcTeX = w => FUNCS.has(w) ? '\\' + w + ' ' : w === 'arc tg' || w === 'arctg' ? '\\arctg ' : `\\operatorname{${w}}`;

const EMB = {2: '\\dot', 3: '\\ddot', 4: '\\dddot', 8: '\\tilde', 9: '\\hat', 11: '\\vec', 12: '\\overleftarrow', 13: '\\overleftrightarrow', 14: '\\vec', 15: '\\overleftarrow', 16: '\\overline',
  17: '\\overline', 19: '\\overset{\\frown}', 20: '\\overset{\\smile}', 24: '\\ddddot'};
function embellish(t, e) {
  if (e === 5) return t + "'"; if (e === 6) return t + "''"; if (e === 18) return t + "'''"; if (e === 7) return t + '`';
  if (e === 10) return '\\not ' + t;
  const f = EMB[e]; return f ? `${f}{${t}}` : t;
}

/* ---------- tree -> TeX ---------- */
const slots = kids => kids.filter(k => k.t === 'line' || k.t === 'pile' || k.t === 'matrix');
const chars = kids => kids.filter(k => k.t === 'char');
const g = s => `{${s}}`;
function lineTeX(node) {
  if (!node) return '';
  if (node.t === 'pile') return pileTeX(node);
  if (node.t === 'matrix') return matrixTeX(node);
  return seqTeX(node.kids || []);
}
/** A sequence of objects: groups function names and text, attaches scripts to what precedes them. */
function seqTeX(kids) {
  let out = '', i = 0;
  while (i < kids.length) {
    const k = kids[i];
    if (k.t === 'char' && (k.tf === TF.FUNCTION || k.tf === TF.TEXT || k.tf === TF.TEXT_FE) && !k.emb.length) {
      const tf = k.tf === TF.FUNCTION ? 'f' : 't'; let w = '';
      while (i < kids.length && kids[i].t === 'char' && !kids[i].emb.length && ((tf === 'f' && kids[i].tf === TF.FUNCTION) || (tf === 't' && (kids[i].tf === TF.TEXT || kids[i].tf === TF.TEXT_FE)))) {
        const c = kids[i].code; w += c != null && c < 0xE000 ? String.fromCodePoint(c) : ' '; i++;
      }
      if (tf === 'f') out += funcTeX(w.trim()) + (/^\s|\s$/.test(w) ? '\\ ' : '');
      else out += w.trim() ? `\\text{${w.replace(/[{}\\]/g, '')}}` : '\\ ';
      continue;
    }
    if (k.t === 'char') { let c = charTeX(k); for (const e of k.emb) c = embellish(c, e); out += c; }
    else if (k.t === 'tmpl') { const base = tmplTeX(k); out += (/^[_^]/.test(base) && !out.trim() ? '{}' : '') + base; }
    else if (k.t === 'line') out += g(lineTeX(k));
    else if (k.t === 'pile') out += pileTeX(k);
    else if (k.t === 'matrix') out += matrixTeX(k);
    i++;
  }
  return out;
}
function pileTeX(p) {
  const rows = slots(p.kids).map(lineTeX);
  const col = p.halign === 2 ? 'c' : p.halign === 3 ? 'r' : 'l';
  return rows.length > 1 ? `\\begin{array}{${col}}${rows.join('\\\\')}\\end{array}` : (rows[0] || '');
}
function matrixTeX(m) {
  const cells = slots(m.kids).map(lineTeX), rows = [];
  for (let r = 0; r < m.rows; r++) rows.push(cells.slice(r * m.cols, (r + 1) * m.cols).join(' & '));
  return `\\begin{matrix}${rows.join('\\\\')}\\end{matrix}`;
}
const FENCE = {0: ['\\langle', '\\rangle'], 1: ['(', ')'], 2: ['\\{', '\\}'], 3: ['[', ']'], 4: ['|', '|'], 5: ['\\|', '\\|'], 6: ['\\lfloor', '\\rfloor'], 7: ['\\lceil', '\\rceil'], 8: ['[\\![', ']\\!]']};
function fenceChar(c) { if (!c) return null; const t = charTeX(c).trim(); return t === '{' ? '\\{' : t === '}' ? '\\}' : t; }
function tmplTeX(t) {
  const s = slots(t.kids), cs = chars(t.kids), S = i => lineTeX(s[i]), v = t.v;
  switch (t.sel) {
    case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7: case 8: case 9: {
      // fences: the variation tells which sides exist (1 = left, 2 = right)
      const f = FENCE[t.sel] || ['(', ')'];
      let L = fenceChar(cs[0]) || f[0], Rr = fenceChar(cs[1]) || f[1];
      if (t.sel === 9) { L = fenceChar(cs[0]) || '.'; Rr = fenceChar(cs[1]) || '.'; }
      const hasL = t.sel === 9 ? L !== '.' : (v & 3) ? !!(v & 1) : true, hasR = t.sel === 9 ? Rr !== '.' : (v & 3) ? !!(v & 2) : true;
      const inner = S(0);
      if (t.sel === 2 && hasL && !hasR && s[0]?.t === 'pile') return `\\begin{cases}${slots(s[0].kids).map(lineTeX).join('\\\\')}\\end{cases}`;
      if (t.sel === 2 && hasL && !hasR && s[0]?.kids?.length === 1 && s[0].kids[0].t === 'pile') return `\\begin{cases}${slots(s[0].kids[0].kids).map(lineTeX).join('\\\\')}\\end{cases}`;
      return `\\left${hasL ? L : '.'} ${inner} \\right${hasR ? Rr : '.'}`;
    }
    case 10: return v & 1 && S(1).trim() ? `\\sqrt[${S(1)}]{${S(0)}}` : `\\sqrt{${S(0)}}`;
    case 11: return v & 2 ? `${g(S(0))}/${g(S(1))}` : `\\frac{${S(0)}}{${S(1)}}`;
    case 12: return `\\underline{${S(0)}}`;
    case 13: return `\\overline{${S(0)}}`;
    case 14: {                                                     // arrow with text above / below
      const top = S(0), bot = S(1), left = v & 0x10, both = v & 1;
      const cmd = both ? '\\xleftrightarrow' : left ? '\\xleftarrow' : '\\xrightarrow';
      return `${cmd}${bot.trim() ? `[${bot}]` : ''}{${top}}`;
    }
    case 15: case 16: case 17: case 18: case 19: case 20: case 21: case 22: {   // big operators: main, lower, upper, operator
      const ops = {15: v & 3 ? ['\\int', '\\iint', '\\iiint'][(v & 3) - 1] : '\\int', 16: '\\sum', 17: '\\prod', 18: '\\coprod', 19: '\\bigcup', 20: '\\bigcap'};
      let op = ops[t.sel] || charTeX(cs[0] || {}) || '\\int';
      if (t.sel === 15 && v & 4) op = '\\oint';
      const lo = S(1), up = S(2);
      return `${op}${lo.trim() ? `_{${lo}}` : ''}${up.trim() ? `^{${up}}` : ''} ${S(0)}`;
    }
    case 23: { const lo = S(1), up = S(2); return `${S(0)}${lo.trim() ? `_{${lo}}` : ''}${up.trim() ? `^{${up}}` : ''}`; }   // lim, max …
    case 24: case 25: return v & 1 ? `\\overbrace{${S(0)}}^{${S(1)}}` : `\\underbrace{${S(0)}}_{${S(1)}}`;
    case 26: return `${S(1)}\\,\\overline{)\\,${S(0)}}`;
    case 27: return `_{${S(0)}}`;
    case 28: return `^{${S(1) || S(0)}}`;
    case 29: return `_{${S(0)}}^{${S(1)}}`;
    case 30: return `\\left\\langle ${S(0)} \\middle| ${S(1)} \\right\\rangle`;
    case 31: { const m = S(0), one = m.replace(/\\[a-zA-Z]+\s*|[{}\s]/g, 'x').length <= 1; return v & 1 && !(v & 2) ? `\\overleftarrow{${m}}` : one ? `\\vec{${m}}` : `\\overrightarrow{${m}}`; }
    case 32: return `\\widetilde{${S(0)}}`;
    case 33: return `\\widehat{${S(0)}}`;
    case 34: return `\\overset{\\frown}{${S(0)}}`;
    case 36: return `\\not{${S(0)}}`;
    case 37: return `\\boxed{${S(0)}}`;
    default: return s.map(lineTeX).join(' ');
  }
}

/** Clean-up: Hungarian decimal comma, spacing. */
function tidy(tex) {
  return tex.replace(/(\d),(?=\d)/g, '$1{,}').replace(/\s{2,}/g, ' ').replace(/\{\s+/g, '{').replace(/\s+\}/g, '}').replace(/\\left\. \\right\./g, '').trim();
}

/** MTEF bytes (after the 28-byte OLE header) -> TeX. */
export function mtefToTeX(u8) {
  const r = new Reader(u8), ver = r.u8();
  let tree;
  if (ver >= 5) { r.u8(); r.u8(); r.u8(); r.u8(); r.str(); r.u8(); tree = list5(r, false); }
  else if (ver === 3 || ver === 4) { r.u8(); r.u8(); r.u8(); r.u8(); tree = list3(r); }
  else throw new Error('MTEF: unsupported version ' + ver);
  const lines = tree.filter(n => n.t === 'line' || n.t === 'pile' || n.t === 'matrix');
  const tex = tidy(lines.map(lineTeX).join(' \\\\ '));
  if (!tex) throw new Error('MTEF: empty formula');
  return tex;
}
/** OLE object (oleObject*.bin) -> TeX, or throws. */
export function oleToTeX(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const cfb = CFB.read(u8, {type: 'array'});
  const e = cfb.FileIndex.find(f => /equation native/i.test(f.name));
  if (!e || !e.content) throw new Error('nincs MathType-adat');
  const data = e.content instanceof Uint8Array ? e.content : new Uint8Array(e.content);
  const hdr = data[0] | (data[1] << 8);                             // 28 for MathType / Equation Editor
  return mtefToTeX(data.subarray(hdr === 28 ? 28 : 0));
}
