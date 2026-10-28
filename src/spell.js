// Hungarian spell checking with Hunspell (WebAssembly) and the Magyar Ispell 1.9 dictionary (LibreOffice;
// MPLv2 / LGPLv3+, public/spell). Works the same on every computer – it does not depend on the operating system.
// Misspelled words get a red wavy underline (a decoration: not part of the document, never exported);
// right-click shows suggestions, "add to dictionary" and "ignore".
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const spellKey = new PluginKey('spell');
let hun = null, loading = null, enabled = true;
const cache = new Map(), ignored = new Set();
const USER_KEY = 'matekosdoksi.userdict';
let userWords = new Set();
try { userWords = new Set(JSON.parse(localStorage.getItem(USER_KEY) || '[]')); } catch (e) { /* none */ }

export function loadSpell() {
  if (!loading) loading = (async () => {
    const [{ createHunspellFromStrings }, aff, dic] = await Promise.all([
      import('hunspell-wasm'),
      fetch('./spell/hu_HU.aff').then(r => r.text()),
      fetch('./spell/hu_HU.dic').then(r => r.text())
    ]);
    hun = await createHunspellFromStrings(aff, dic);
    return hun;
  })().catch(e => { console.warn('spell', e); loading = null; throw e; });
  return loading;
}
const WORD = /[\p{L}][\p{L}\p{M}]*(?:[’'-][\p{L}\p{M}]+)*/gu;
function ok(w) {
  if (w.length < 2 || ignored.has(w) || userWords.has(w) || userWords.has(w.toLowerCase())) return true;
  if (/^[\p{Lu}]+$/u.test(w) && w.length <= 4) return true;          // abbreviations (ÁFA, SI…)
  let r = cache.get(w);
  if (r === undefined) { r = hun ? (hun.testSpelling(w) || (w.includes('-') && w.split('-').every(p => !p || hun.testSpelling(p)))) : true; cache.set(w, r); }
  return r;
}
function build(doc) {
  if (!hun || !enabled) return DecorationSet.empty;
  const decos = [];
  doc.descendants((n, pos) => {
    if (!n.isText) return;
    if (n.marks.some(m => m.type.name === 'code' || m.type.name === 'link')) return;
    WORD.lastIndex = 0; let m;
    while ((m = WORD.exec(n.text))) if (!ok(m[0])) decos.push(Decoration.inline(pos + m.index, pos + m.index + m[0].length, { class: 'spell-err', 'data-word': m[0] }));
  });
  return DecorationSet.create(doc, decos);
}
/** The spell-check plugin: re-checks shortly after the text changes. */
export function spellPlugin() {
  let timer = 0;
  return new Plugin({
    key: spellKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old) { const m = tr.getMeta(spellKey); if (m) return m; return tr.docChanged ? old.map(tr.mapping, tr.doc) : old; }
    },
    props: { decorations(st) { return spellKey.getState(st); } },
    view(view) {
      const run = () => { if (!view.dom.isConnected) return; view.dispatch(view.state.tr.setMeta(spellKey, build(view.state.doc)).setMeta('addToHistory', false)); };
      const later = (d = 500) => { clearTimeout(timer); timer = setTimeout(run, d); };
      view._spellRun = later;
      if (enabled) loadSpell().then(() => later(50)).catch(() => {});
      return { update(v, prev) { if (enabled && v.state.doc !== prev.doc) later(); }, destroy() { clearTimeout(timer); } };
    }
  });
}
export function setSpellEnabled(view, on) {
  enabled = on;
  if (on) loadSpell().then(() => view._spellRun && view._spellRun(0)).catch(() => {});
  else view.dispatch(view.state.tr.setMeta(spellKey, DecorationSet.empty).setMeta('addToHistory', false));
}
export const spellReady = () => !!hun;
export function suggestions(word) { try { return hun ? hun.getSpellingSuggestions(word).slice(0, 7) : []; } catch (e) { return []; } }
export function addToDictionary(word, view) {
  userWords.add(word); try { localStorage.setItem(USER_KEY, JSON.stringify([...userWords])); } catch (e) { /* full */ }
  cache.delete(word); view._spellRun && view._spellRun(0);
}
export function ignoreWord(word, view) { ignored.add(word); view._spellRun && view._spellRun(0); }
/** Remove / bring back the underlines (e.g. while a PDF is made). */
export function hideSpell(view) { view.dispatch(view.state.tr.setMeta(spellKey, DecorationSet.empty).setMeta('addToHistory', false)); }
export function showSpell(view) { if (enabled) view._spellRun && view._spellRun(0); }
