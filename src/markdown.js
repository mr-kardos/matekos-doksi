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
    if (f) out.push({ type: 'math', attrs: { tex: f.tex, display: f.display, wrap: !f.display }, ...(marks.filter(k => k.type === 'bold').length ? { marks: marks.filter(k => k.type === 'bold') } : {}) });
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
        if (p.content && p.content.length === 1 && p.content[0].type === 'math' && p.content[0].attrs.display) p.attrs = { textAlign: 'center' };
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
function blockMd(n, indent, report) {
  const pad = ' '.repeat(indent);
  switch (n.type) {
    case 'heading': return pad + '#'.repeat(n.attrs.level || 1) + ' ' + inlineMd(n.content) + '\n';
    case 'paragraph': {
      if (n.content && n.content.some(c => c.type === 'image')) report.images += n.content.filter(c => c.type === 'image').length;
      const only = n.content && n.content.length === 1 && n.content[0].type === 'math';
      const t = only ? `$$${n.content[0].attrs.tex}$$` : inlineMd(n.content);
      return t.trim() ? pad + t.replace(/\n/g, '\n' + pad) + '\n' : '';
    }
    case 'bulletList': case 'orderedList': {
      let k = n.attrs && n.attrs.start != null ? n.attrs.start : 1, out = '';
      for (const it of n.content || []) {
        if (it.attrs && it.attrs.ghost) { for (const c of it.content || []) if (/List$/.test(c.type)) out += blockMd(c, indent, report); continue; }
        const mark = n.type === 'orderedList' ? `${k++}. ` : '- ';
        const kids = it.content || [];
        let first = true;
        for (const c of kids) {
          if (first && (c.type === 'paragraph' || c.type === 'heading')) { out += pad + mark + inlineMd(c.content).replace(/\n/g, '\n' + pad + ' '.repeat(mark.length)) + '\n'; first = false; }
          else out += blockMd(c, indent + mark.length, report).replace(/^\n+/, '');
        }
        if (first) out += pad + mark + '\n';
      }
      return out;
    }
    case 'table': {
      const rows = (n.content || []).map(r => (r.content || []).map(c => (c.content || []).map(p => inlineMd(p.content || [])).join(' ').replace(/\|/g, '\\|').replace(/\n/g, ' ')));
      if (!rows.length) return '';
      const w = Math.max(...rows.map(r => r.length));
      const line = r => pad + '| ' + Array.from({ length: w }, (_, i) => r[i] || '').join(' | ') + ' |';
      return [line(rows[0]), pad + '|' + Array.from({ length: w }, () => ' --- |').join(''), ...rows.slice(1).map(line)].join('\n') + '\n';
    }
    case 'pageBreak': return pad + '---\n';
    default: return n.content ? n.content.map(c => blockMd(c, indent, report)).join('\n') : '';
  }
}
/** TipTap JSON -> {md, report} */
export function exportMarkdown(doc, title) {
  const report = { images: 0 };
  const parts = (doc.content || []).map(n => blockMd(n, 0, report)).filter(Boolean);
  let md = parts.join('\n').replace(/\n{3,}/g, '\n\n');
  if (title && !(doc.content || []).some(n => n.type === 'heading')) md = `# ${title}\n\n` + md;
  return { md: md.trim() + '\n', report };
}
