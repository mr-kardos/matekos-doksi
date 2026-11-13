// The text editor's own extensions (src/editor/extensions.js), run without a browser window:
// typing corrections, which characters start a list, and the look of the list symbols.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'MutationObserver', 'getComputedStyle', 'DOMParser', 'NodeFilter', 'requestAnimationFrame', 'cancelAnimationFrame', 'InputEvent', 'KeyboardEvent', 'ClipboardEvent', 'Range', 'Selection', 'CSS', 'Event', 'CustomEvent']) { if (dom.window[k]) globalThis[k] = dom.window[k]; }
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
after(() => server.close());
const X = await server.ssrLoadModule('/src/editor/extensions.js');
const { Editor } = await server.ssrLoadModule('@tiptap/core');
const { default: StarterKit } = await server.ssrLoadModule('@tiptap/starter-kit');
const { ListItem } = await server.ssrLoadModule('@tiptap/extension-list');
const { TextStyle, Color, FontSize } = await server.ssrLoadModule('@tiptap/extension-text-style');

const EMPTY = { type: 'doc', content: [{ type: 'paragraph' }] };
const ed = new Editor({
  element: document.getElementById('host'), content: EMPTY,
  extensions: [StarterKit.configure({ bulletList: false, orderedList: false, listItem: false, link: false, trailingNode: false }),
    ListItem, X.KvBulletList, X.KvOrderedList, X.ListMarkers, X.HunTyping, X.KvImage, X.Hyphens, X.ParaFormat, TextStyle, Color, FontSize]
});
/** Type text the way the keyboard does (so the typing rules run). */
const type = t => { for (const ch of t) { const { from, to } = ed.state.selection; if (!ed.view.someProp('handleTextInput', f => f(ed.view, from, to, ch))) ed.view.dispatch(ed.state.tr.insertText(ch, from, to)); } };
const fresh = () => ed.commands.setContent(EMPTY);
const first = () => ed.getJSON().content[0];
const textOf = n => (n.content || []).map(c => c.type === 'text' ? c.text : textOf(c)).join('');

test('typing: Hungarian quotation marks and dash, but never inside a formula being typed', () => {
  fresh(); type('Azt mondta: "szia" -- és ("így") $f"(x)');
  assert.equal(textOf(first()), 'Azt mondta: „szia” – és („így”) $f"(x)');
});

test('typing "- " starts a list; "+ ", "* " and "1. " do not', () => {
  fresh(); type('- elem'); assert.equal(first().type, 'bulletList'); assert.equal(textOf(first()), 'elem');
  for (const t of ['+ 2x', '* y', '1. z']) { fresh(); type(t); assert.equal(first().type, 'paragraph', t); assert.equal(textOf(first()), t); }
});

test('a list symbol takes the size and colour its item starts with', () => {
  const item = marks => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'szöveg', ...(marks ? { marks } : {}) }] }] });
  ed.commands.setContent({ type: 'doc', content: [{ type: 'bulletList', content: [item([{ type: 'textStyle', attrs: { color: '#ff0000', fontSize: '40pt' } }]), item(null)] }] });
  const look = [...document.getElementById('host').querySelectorAll('.lm')].map(m => [m.style.color, m.style.fontSize]);
  assert.deepEqual(look, [['rgb(255, 0, 0)', '40pt'], ['', '']]);
});

test('picture captions: drawn above / below the picture, kept in the document, the picture in its own clipping box', () => {
  const PIC = 'data:image/png;base64,iVBORw0KGgo=';
  ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: PIC, width: 200, wrap: 'ctr', capTop: 'A kör', capBot: 'Forrás: saját ábra' } }, { type: 'image', attrs: { src: PIC, width: 100, wrap: 'inl' } }] }] });
  const [a, b] = document.getElementById('host').querySelectorAll('.imgw');
  assert.equal(a.querySelector('.icap.top').textContent, 'A kör'); assert.equal(a.querySelector('.icap.top').hidden, false);
  assert.equal(a.querySelector('.icap.bot').textContent, 'Forrás: saját ábra');
  assert.ok(a.querySelector(':scope > .imgclip > img'), 'the picture is inside the clipping box');
  assert.equal(b.querySelector('.icap.top').hidden, true); assert.equal(b.querySelector('.icap.bot').hidden, true);
  // saved and read back
  const html = ed.getHTML();
  assert.match(html, /data-cap-top="A kör"/); assert.match(html, /data-cap-bot="Forrás: saját ábra"/);
  ed.commands.setContent(html);
  const img = ed.getJSON().content[0].content[0];
  assert.equal(img.attrs.capTop, 'A kör'); assert.equal(img.attrs.capBot, 'Forrás: saját ábra');
  assert.equal(ed.getJSON().content[0].content[1].attrs.capTop, '');
});

test('hyphenation points: shown without changing the text, they follow the text, an edited word loses its own', async () => {
  ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Az egyenlőtlenség megoldása' }] }] });
  const points = () => X.hyphenKey.getState(ed.state).find().map(d => d.from);
  const shown = () => document.getElementById('host').querySelectorAll('.shy').length;
  // "egyenlőtlenség" starts at position 4 (1 + "Az ".length); "megoldása" at 19
  ed.view.dispatch(ed.state.tr.setMeta(X.hyphenKey, { add: [4 + 5, 4 + 8, 19 + 3] }).setMeta('addToHistory', false));
  assert.deepEqual(points(), [9, 12, 22]); assert.equal(shown(), 3);
  assert.equal(textOf(first()), 'Az egyenlőtlenség megoldása', 'the text itself is unchanged');
  // typing at the very start moves the points along
  ed.commands.insertContentAt(1, 'Íme: ');
  assert.deepEqual(points(), [14, 17, 27]);
  // typing inside "megoldása" removes that word's points only
  ed.commands.insertContentAt(27, 'x');
  assert.deepEqual(points(), [14, 17]);
  ed.view.dispatch(ed.state.tr.setMeta(X.hyphenKey, { clear: true }));
  assert.deepEqual(points(), []); assert.equal(shown(), 0);
  // the Hungarian rules the app uses
  const { createRequire } = await import('node:module');
  const { hyphenateSync } = createRequire(import.meta.url)('hyphen/hu');
  const cut = w => hyphenateSync(w, { hyphenChar: '|' });
  assert.equal(cut('vasút'), 'vas|út'); assert.equal(cut('megírni'), 'meg|ír|ni'); assert.equal(cut('háromszög'), 'há|rom|szög'); assert.equal(cut('függvény'), 'függ|vény');
});

test('a line of the table of contents keeps its mark when saved and read back', () => {
  ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', attrs: { toc: 2, indentLeft: 0.6 }, content: [{ type: 'text', text: 'Cím' }] }] });
  const html = ed.getHTML(); assert.match(html, /data-toc="2"/);
  ed.commands.setContent(html);
  assert.equal(first().attrs.toc, 2);
});
