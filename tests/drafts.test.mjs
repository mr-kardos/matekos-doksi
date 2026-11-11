// Automatic drafts (src/files.js): one slot per window, pictures stored once, recovery after a crash, recent files.
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), key: i => [...m.keys()][i] ?? null, get length() { return m.size; } }; };
globalThis.localStorage = mem();
// the Web Locks of every "window" of the test
const held = new Map();
const locks = {
  query: async () => ({ held: [...held.keys()].map(name => ({ name })) }),
  request: async (name, opt, cb) => {
    if (typeof opt === 'function') { cb = opt; opt = {}; }
    if (held.has(name)) { if (opt.ifAvailable) return cb(null); await held.get(name); }
    let rel; const p = new Promise(r => { rel = r; }); held.set(name, p);
    try { return await cb({ name }); } finally { held.delete(name); rel(); }
  }
};
Object.defineProperty(globalThis, 'navigator', { value: { locks }, configurable: true });
globalThis.addEventListener = () => {};
let n = 0;
/** A new window: its own sessionStorage and its own copy of the module. */
async function win(session = mem()) { globalThis.sessionStorage = session; return { m: await import('../src/files.js?window=' + (++n)), session }; }
const crashAll = () => held.clear();
const store = () => new Promise(res => { const r = indexedDB.open('matekos-doksi', 1); r.onsuccess = () => { const s = r.result.transaction('autosave').objectStore('autosave'), k = s.getAllKeys(), v = s.getAll(); v.onsuccess = () => { r.result.close(); res(Object.fromEntries(k.result.map((key, i) => [key, v.result[i]]))); }; }; });

const PIC = id => 'data:image/png;base64,' + id.repeat(3000);          // a "picture": long enough to be stored on its own
const img = src => ({ type: 'image', attrs: { src } });
const docOf = (...content) => ({ type: 'doc', content: [{ type: 'paragraph', content }] });
const text = t => ({ type: 'text', text: t });

test('drafts: every window has its own, pictures are stored once, nothing unsaved is lost', async () => {
  // a draft written by version 0.10.1 (one slot for every window, pictures inside the document)
  await new Promise(res => { const r = indexedDB.open('matekos-doksi', 1); r.onupgradeneeded = () => r.result.createObjectStore('autosave'); r.onsuccess = () => { const t = r.result.transaction('autosave', 'readwrite'); t.objectStore('autosave').put({ title: 'old', doc: docOf(text('a'), img(PIC('A'))), tpl: { watermark: PIC('W') }, dirty: true }, 'last'); t.oncomplete = () => { r.result.close(); res(); }; }; });
  const A = await win(); let v = await A.m.loadAutosave();
  assert.equal(v.title, 'old'); assert.equal(v.dirty, true);
  assert.equal(v.doc.content[0].content[1].attrs.src, PIC('A'), 'pictures come back whole');
  assert.equal(v.tpl.watermark, PIC('W'));

  await A.m.autosave({ title: 'A', doc: docOf(text('a'), img(PIC('A')), img(PIC('B'))), tpl: { watermark: PIC('W') }, dirty: true });
  let st = await store();
  const docKey = Object.keys(st).find(k => k.startsWith('doc:'));
  assert.ok(!JSON.stringify(st[docKey]).includes('base64'), 'the stored document holds references, not pictures');
  assert.equal(Object.keys(st).filter(k => k.startsWith('media:')).length, 3);

  const B = await win(); v = await B.m.loadAutosave();
  assert.equal(v, null, 'a second window does not take the draft of the running one');
  await B.m.autosave({ title: 'B', doc: docOf(text('b'), img(PIC('X'))), dirty: true });
  await A.m.autosave({ title: 'A2', doc: docOf(text('a2'), img(PIC('B'))), tpl: {}, dirty: true });
  st = await store();
  assert.equal(Object.keys(st).filter(k => k.startsWith('media:')).length, 2, 'pictures that left the document are removed (B of the first window, X of the second)');

  const B2 = await win(B.session); v = await B2.m.loadAutosave();          // reload
  assert.equal(v.title, 'B'); assert.equal(v.doc.content[0].content[1].attrs.src, PIC('X'));

  crashAll();
  const C = await win(); v = await C.m.loadAutosave();
  assert.equal(v.title, 'A2', 'the newest draft is continued');
  assert.equal(v.doc.content[0].content[1].attrs.src, PIC('B'));
  assert.deepEqual(C.m.recoverableDrafts().map(d => d.title), ['B'], 'the other unsaved draft can be recovered');

  await C.m.shelveDraft({ title: 'A2', doc: docOf(text('a2'), img(PIC('B'))), dirty: true });
  assert.equal(C.m.recoverableDrafts().length, 2);
  const t = await C.m.takeDraft(C.m.recoverableDrafts().find(d => d.title === 'B').id);
  assert.equal(t.title, 'B'); assert.equal(t.doc.content[0].content[1].attrs.src, PIC('X')); assert.equal(C.m.recoverableDrafts().length, 1);
  await C.m.autosave({ title: 'clean', doc: docOf(text('c')), dirty: false });

  crashAll();
  const D = await win(); v = await D.m.loadAutosave();
  assert.equal(v.title, 'clean');
  assert.deepEqual(D.m.recoverableDrafts().map(d => d.title), ['A2'], 'a draft put aside survives a restart');
  await D.m.dropDraft(D.m.recoverableDrafts()[0].id);
  st = await store();
  assert.deepEqual(Object.keys(st).map(k => k.split(':')[0]), ['doc']);
});

test('recently used files: newest first, no duplicates, at most 8', async () => {
  const { m } = await win();
  for (let i = 1; i <= 10; i++) m.noteRecent(`C:\\doksi\\${i}.mdoksi`);
  m.noteRecent('C:\\doksi\\5.mdoksi');
  const list = m.recentFiles().map(r => r.path);
  assert.equal(list.length, 8); assert.equal(list[0], 'C:\\doksi\\5.mdoksi'); assert.equal(list.filter(p => p.endsWith('\\5.mdoksi')).length, 1);
  m.forgetRecent('C:\\doksi\\5.mdoksi');
  assert.ok(!m.recentFiles().some(r => r.path.endsWith('\\5.mdoksi')));
});
