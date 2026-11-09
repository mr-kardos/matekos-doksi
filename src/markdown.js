// Markdown import and export – text with its formatting, headings, lists, tables and formulas ($…$ / $$…$$).
// Pictures are left out in both directions.
import { marked } from 'marked';

/* ------------------------------------------------------------------ */
/* Import: Markdown -> TipTap JSON                                     */
/* ------------------------------------------------------------------ */
const MATH = '\u0000M', END = '\u0000';
/** Formulas are taken out before parsing (Markdown would break "_" and "*" in them) and put back as formula nodes. */
function protectMath(src) {
  const list = [];
  let s = src.replace(/\$\$([\s\S]+?)\$\$/g, (m, t) => { list.push({ tex: t.trim(), display: true }); return MATH + (list.length - 1) + END; });
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (m, t) => { list.push({ tex: t.trim(), display: true }); return MATH + (list.length - 1) + END; });
  s = s.replace(/\\\((.+?)\\\)/g, (m, t) => { list.push({ tex: t.trim(), display: false }); return MATH + (list.length - 1) + END; });
  s = s.replace(/(^|[^\\$])\$([^\s$](?:[^$\n]*?[^\s$])?)\$(?!\d)/g, (m, pre, t) => { list.push({ tex: t.trim(), display: false }); return pre + MATH + (list.length - 1) + END; });
  return { s, list };
}
function textWithMath(text, marks, list) {
  const out = [];
  const re = /\u0000M(\d+)\u0000/g; let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index), ...(marks.length ? { marks } : {}) });
    const f = list[+m[1]];
    if (f) out.push({ type: 'math', attrs: { tex: f.tex, display: false, wrap: true }, ...(marks.filter(k => k.type === 'bold').length ? { marks: marks.filter(k => k.type === 'bold') } : {}) });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last), ...(marks.length ? { marks } : {}) });
  return out.filter(n => n.type !== 'text' || n.text);
}
const unescape = t => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
function inline(tokens, marks, list, report) {
  const out = [];
  for (const t of tokens || []) {
    switch (t.type) {
      case 'text': case 'escape':
        if (t.tokens && t.tokens.length && t.type === 'text') out.push(...inline(t.tokens, marks, list, report));
        else out.push(...textWithMath(unescape(t.text || ''), marks, list));
        break;
      case 'strong': out.push(...inline(t.tokens, [...marks, { type: 'bold' }], list, report)); break;
      case 'em': out.push(...inline(t.tokens, [...marks, { type: 'italic' }], list, report)); break;
      case 'del': out.push(...inline(t.tokens, [...marks, { type: 'strike' }], list, report)); break;
      case 'codespan': out.push(...textWithMath(unescape(t.text), marks, list)); break;
      case 'link': out.push(...inline(t.tokens, marks, list, report)); break;
      case 'image': report.images++; break;
      case 'br': out.push({ type: 'hardBreak' }); break;
      case 'html': {
        const h = t.raw || '';
        if (/^<br\s*\/?>$/i.test(h.trim())) out.push({ type: 'hardBreak' });
        else if (/^<\/?(sup|sub|u)>$/i.test(h.trim())) { /* handled loosely: tags dropped */ }
        else out.push(...textWithMath(h.replace(/<[^>]+>/g, ''), marks, list));
        break;
      }
      default: if (t.text) out.push(...textWithMath(unescape(t.text), marks, list));
    }
  }
  return out;
}
function para(tokens, list, report, attrs) {
  const content = inline(tokens, [], list, report);
  // a paragraph that is only one display formula: a display formula on its own line
  return { type: 'paragraph', ...(attrs ? { attrs } : {}), ...(content.length ? { content } : {}) };
}
function blocks(tokens, list, report) {
  const out = [];
  for (const t of tokens) {
    switch (t.type) {
      case 'heading': out.push({ type: 'heading', attrs: { level: Math.min(3, t.depth) }, content: inline(t.tokens, [], list, report) }); break;
      case 'paragraph': {
        const p = para(t.tokens, list, report);
        out.push(p); break;
      }
      case 'list': {
        const items = t.items.map(it => {
          const inner = blocks(it.tokens.map(x => x.type === 'text' ? { type: 'paragraph', tokens: x.tokens || [{ type: 'text', text: x.text }] } : x), list, report);
          return { type: 'listItem', content: inner.length ? inner : [{ type: 'paragraph' }] };
        });
        out.push(t.ordered ? { type: 'orderedList', attrs: { start: t.start === '' || t.start == null ? 1 : +t.start }, content: items } : { type: 'bulletList', content: items });
        break;
      }
      case 'table': {
        const row = (cells, head) => ({ type: 'tableRow', content: cells.map(c => ({ type: head ? 'tableHeader' : 'tableCell', content: [para(c.tokens, list, report)] })) });
        out.push({ type: 'table', content: [row(t.header, true), ...t.rows.map(r => row(r, false))] });
        report.tables++;
        break;
      }
      case 'blockquote': out.push(...blocks(t.tokens, list, report)); break;
      case 'code': for (const line of t.text.split('\n')) out.push(para([{ type: 'text', text: line }], list, report)); break;
      case 'hr': out.push({ type: 'pageBreak' }); break;
      case 'space': break;
      case 'html': { const txt = (t.text || '').replace(/<[^>]+>/g, '').trim(); if (txt) out.push(para([{ type: 'text', text: txt }], list, report)); break; }
      default: if (t.tokens) out.push(para(t.tokens, list, report)); else if (t.text) out.push(para([{ type: 'text', text: t.text }], list, report));
    }
  }
  return out;
}
/** Markdown text -> {doc, title, report} */
export function importMarkdown(src) {
  const report = { images: 0, tables: 0, formulas: 0 };
  const { s, list } = protectMath(String(src).replace(/\r\n?/g, '\n'));
  report.formulas = list.length;
  const tokens = marked.lexer(s, { gfm: true, breaks: false });
  const content = blocks(tokens, list, report);
  const first = tokens.find(t => t.type === 'heading');
  return { doc: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }, title: first ? first.text.replace(/\u0000M\d+\u0000/g, '').trim() : '', report };
}

/* ------------------------------------------------------------------ */
/* Export: TipTap JSON -> Markdown                                     */
/* ------------------------------------------------------------------ */
const escMd = t => t.replace(/([\\`*_[\]#|<>])/g, '\\$1').replace(/^(\s*)([-+]|\d+\.)(\s)/, '$1\\$2$3');
function inlineMd(nodes) {
  let out = '';
  for (const n of nodes || []) {
    if (n.type === 'text') {
      let t = escMd(n.text);
      const has = k => (n.marks || []).some(m => m.type === k);
      if (has('superscript')) t = `<sup>${t}</sup>`;
      if (has('subscript')) t = `<sub>${t}</sub>`;
      if (has('underline')) t = `<u>${t}</u>`;
      if (has('strike')) t = `~~${t}~~`;
      if (has('italic')) t = `*${t}*`;
      if (has('bold')) t = `**${t}**`;
      // keep the spaces outside the markers (Markdown needs them there)
      out += t.replace(/^(\*+|~~)(\s+)/, '$2$1').replace(/(\s+)(\*+|~~)$/, '$2$1');
    } else if (n.type === 'math') out += n.attrs.display ? `$$${n.attrs.tex}$$` : `$${n.attrs.tex}$`;
    else if (n.type === 'hardBreak') out += '  \n';
    else if (n.type === 'tab') out += '\t';
    // pictures and other objects are left out
  }
  return out;
}
/** Several blocks of one container; numbered lists count on as in Doksi (continuing lists, start numbers). */
function blocksMd(nodes, indent, report, opts) {
  const ends = {}, out = [];
  for (const n of nodes || []) {
    if (n.type === 'orderedList') {
      const sty = (n.attrs && n.attrs.numStyle) || opts.num;
      let realItems = 0; for (const it of n.content || []) if (!(it.attrs && it.attrs.ghost)) realItems++;
      const start = n.attrs && n.attrs.cont ? (ends[sty] ?? 0) + 1 : ((n.attrs && n.attrs.start) ?? 1);
      ends[sty] = start + realItems - 1;
      out.push(listMd(n, indent, report, opts, start, sty));
    } else if (n.type === 'bulletList') out.push(listMd(n, indent, report, opts, 1, null));
    else out.push(blockMd(n, indent, report, opts));
  }
  return out.filter(Boolean).join('\n');
}
/** A list: "1." / "1)" are Markdown list markers; a) A. i. I. are written out in front of the text. */
function listMd(n, indent, report, opts, start, sty) {
  const pad = ' '.repeat(indent), ordered = n.type === 'orderedList';
  const native = !ordered || sty === 'decimal' || sty === 'decimal-paren';
  let k = start, out = '';
  for (const it of n.content || []) {
    const kids = it.content || [];
    if (it.attrs && it.attrs.ghost) { out += blocksMd(kids.filter(c => /List$/.test(c.type)), indent, report, opts); continue; }
    const label = ordered ? ordinal(k++, sty) : '-';
    const mark = native ? label + ' ' : '';
    const text = ordered && !native ? label + ' ' : '';
    let first = true;
    for (const c of kids) {
      if (first && (c.type === 'paragraph' || c.type === 'heading')) {
        out += pad + mark + text + inlineMd(c.content).replace(/\n/g, '\n' + pad + ' '.repeat(mark.length)) + (native ? '\n' : '\n\n');
        first = false;
      } else out += blocksMd([c], indent + (native ? mark.length : 3), report, opts).replace(/^\n+/, '') + (native ? '' : '\n');
    }
    if (first) out += pad + mark + text + '\n';
  }
  return out;
}
function ordinal(n, style) {
  const alpha = (q, up) => { let s = ''; while (q > 0) { q--; s = String.fromCharCode(97 + q % 26) + s; q = Math.floor(q / 26); } return up ? s.toUpperCase() : s; };
  const roman = (q, up) => { const t = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let s = ''; for (const [v, r] of t) while (q >= v) { s += r; q -= v; } return up ? s.toUpperCase() : s; };
  switch (style) {
    case 'decimal-paren': return n + ')';
    case 'lower-alpha': return alpha(n) + ')';
    case 'upper-alpha': return alpha(n, true) + '.';
    case 'lower-roman': return roman(n) + '.';
    case 'upper-roman': return roman(n, true) + '.';
    default: return n + '.';
  }
}
/** The text of a table cell on one line (paragraphs and list items separated by <br>). */
function cellMd(cell, opts) {
  const parts = [];
  const walk = (nodes, prefix) => {
    const ends = {};
    for (const c of nodes || []) {
      if (c.type === 'paragraph' || c.type === 'heading') { const t = inlineMd(c.content); if (t.trim() || prefix) parts.push(prefix + t); prefix = ''; }
      else if (c.type === 'bulletList' || c.type === 'orderedList') {
        const sty = (c.attrs && c.attrs.numStyle) || opts.num;
        let k = c.type === 'orderedList' ? (c.attrs && c.attrs.cont ? (ends[sty] ?? 0) + 1 : ((c.attrs && c.attrs.start) ?? 1)) : 0;
        for (const it of c.content || []) { if (it.attrs && it.attrs.ghost) { walk(it.content, ''); continue; } walk(it.content, (c.type === 'orderedList' ? ordinal(k++, sty) : '•') + ' '); }
        if (c.type === 'orderedList') ends[sty] = k - 1;
      } else if (c.content) walk(c.content, prefix);
    }
  };
  walk(cell.content, '');
  return parts.join('<br>').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
function blockMd(n, indent, report, opts) {
  const pad = ' '.repeat(indent);
  switch (n.type) {
    case 'heading': return pad + '#'.repeat(n.attrs.level || 1) + ' ' + inlineMd(n.content) + '\n';
    case 'paragraph': {
      if (n.content && n.content.some(c => c.type === 'image')) report.images += n.content.filter(c => c.type === 'image').length;
      const only = n.content && n.content.length === 1 && n.content[0].type === 'math';
      const t = only ? `$$${n.content[0].attrs.tex}$$` : inlineMd(n.content);
      return t.trim() ? pad + t.replace(/\n/g, '\n' + pad) + '\n' : '';
    }
    case 'bulletList': case 'orderedList': return blocksMd([n], indent, report, opts);
    case 'table': {
      const cells = [];
      for (const r of n.content || []) for (const c of r.content || []) cells.push(c);
      // a borderless layout table (e.g. two columns): its contents one after the other
      if (cells.length && cells.every(c => c.attrs && c.attrs.borderWidth === 0)) return cells.map(c => blocksMd(c.content, indent, report, opts)).filter(Boolean).join('\n');
      const rows = (n.content || []).map(r => { const row = []; for (const c of r.content || []) { row.push(cellMd(c, opts)); for (let x = 1; x < ((c.attrs && c.attrs.colspan) || 1); x++) row.push(''); } return row; });
      if (!rows.length) return '';
      const w = Math.max(...rows.map(r => r.length));
      const line = r => pad + '| ' + Array.from({ length: w }, (_, i) => r[i] || ' ').join(' | ') + ' |';
      return [line(rows[0]), pad + '|' + Array.from({ length: w }, () => ' --- |').join(''), ...rows.slice(1).map(line)].join('\n') + '\n';
    }
    case 'pageBreak': return pad + '---\n';
    default: return n.content ? blocksMd(n.content, indent, report, opts) : '';
  }
}
/** TipTap JSON -> {md, report} */
export function exportMarkdown(doc, title, defaultNum = 'decimal') {
  const report = { images: 0 };
  let md = blocksMd(doc.content || [], 0, report, { num: defaultNum }).replace(/\n{3,}/g, '\n\n');
  if (title && !(doc.content || []).some(n => n.type === 'heading')) md = `# ${title}\n\n` + md;
  return { md: md.trim() + '\n', report };
}
