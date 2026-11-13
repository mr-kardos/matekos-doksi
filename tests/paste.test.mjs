// Pasted text (src/paste.js): the content survives – paragraphs, headings, lists, tables – the look of the source does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
globalThis.DOMParser = new JSDOM('').window.DOMParser;
const { cleanPastedHTML } = await import('../src/paste.js');

test('paragraphs keep bold, italic, underline, super- / subscript and links only', () => {
  assert.equal(cleanPastedHTML('<p style="font-size:30px;color:red;font-family:Arial">Egy <b>vastag</b> és <span style="font-style:italic">dőlt</span> x<sup>2</sup> a<span style="vertical-align:sub">n</span> <a href="https://x.hu">link</a></p><div>Második<br>harmadik</div>'),
    '<p>Egy <strong>vastag</strong> és <em>dőlt</em> x<sup>2</sup> a<sub>n</sub> <a href="https://x.hu">link</a></p><p>Második</p><p>harmadik</p>');
  assert.equal(cleanPastedHTML(''), '<p></p>');
});

test('headings stay headings (they take the document\'s own styles), deeper ones become paragraphs', () => {
  assert.equal(cleanPastedHTML('<h1 style="color:blue"><b>Főcím</b></h1><h2>Cím</h2><h3>Alcím</h3><h4>Negyedik</h4><p>szöveg</p>'),
    '<h1>Főcím</h1><h2>Cím</h2><h3>Alcím</h3><p>Negyedik</p><p>szöveg</p>');
});

test('lists stay lists, with their levels', () => {
  assert.equal(cleanPastedHTML('<p>Előtte</p><ul><li>egy</li><li>kettő<ul><li>belső</li></ul></li></ul><ol><li><p>első</p></li><li>második</li></ol><p>Utána</p>'),
    '<p>Előtte</p><ul><li><p>egy</p></li><li><p>kettő</p><ul><li><p>belső</p></li></ul></li></ul><ol><li><p>első</p></li><li><p>második</p></li></ol><p>Utána</p>');
});

test('Word lists (paragraphs with mso-list) become real lists', () => {
  const p = (lvl, sym, text) => `<p class="MsoListParagraph" style="mso-list:l0 level${lvl} lfo1"><!--[if !supportLists]--><span style="mso-list:Ignore">${sym}<span>&nbsp;&nbsp;</span></span><!--[endif]-->${text}</p>`;
  assert.equal(cleanPastedHTML('<p>Cím</p>' + p(1, '·', 'egy') + p(2, 'o', 'belső') + p(1, '·', 'kettő') + '<p>Vége</p>'),
    '<p>Cím</p><ul><li><p>egy</p><ul><li><p>belső</p></li></ul></li><li><p>kettő</p></li></ul><p>Vége</p>');
  assert.equal(cleanPastedHTML(p(1, 'a)', 'első') + p(1, 'b)', 'második')), '<ol data-num="lower-alpha"><li><p>első</p></li><li><p>második</p></li></ol>');
});

test('tables stay tables, with merged cells; pictures and colours are dropped', () => {
  assert.equal(cleanPastedHTML('<table style="border:1px solid red"><colgroup><col></colgroup><tr><th>A</th><td colspan="2" style="background:yellow"><p><b>B</b></p><p>C</p></td></tr><tr><td rowspan="2"><img src="x.png">D</td><td></td><td><ul><li>e</li></ul></td></tr></table><p>után</p>'),
    '<table><tbody><tr><td><p>A</p></td><td colspan="2"><p><strong>B</strong></p><p>C</p></td></tr><tr><td rowspan="2"><p>D</p></td><td><p></p></td><td><ul><li><p>e</p></li></ul></td></tr></tbody></table><p>után</p>');
});

test('text copied inside the app is kept exactly as it is', () => {
  const own = '<p data-pm-slice="1 1 []" style="font-size: 12px;color:red">x</p>';
  assert.equal(cleanPastedHTML(own), own);
});
