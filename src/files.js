// Saving and opening (as in Matekos Prezi) with the desktop app's native dialogs.
export const isTauri = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
export const safeName = t => (t || 'dokumentum').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 120) || 'dokumentum';
const baseName = p => String(p).split(/[\\/]/).pop();
const DOC_EXT = /\.(mdoksi|kiadvany|html?|json)$/i;

let currentPath = null;      // desktop app: path of the document file
export const getCurrentPath = () => currentPath;
export const setCurrentPath = p => { currentPath = p || null; };
/** Name of the file the document is saved to (or null). */
export const currentFileName = () => currentPath ? baseName(currentPath) : null;
/** The document's title as shown in the title box: the file name without its extension. */
export const titleOfFile = name => String(name || '').replace(DOC_EXT, '');

/** Desktop: write a file so that a crash or a full disk in the middle of saving cannot ruin the previous version –
 *  the new content goes into a temporary file next to it, which then takes the place of the old file in one step. */
async function writeTextSafely(path, text) {
  const { writeTextFile, rename, remove } = await import('@tauri-apps/plugin-fs');
  const tmp = path + '.tmp';
  let written = false;
  try { await writeTextFile(tmp, text); written = true; } catch (e) { /* e.g. no right to create a new file here */ }
  if (written) {
    try { await rename(tmp, path); return; }
    catch (e) { try { await remove(tmp); } catch (e2) { /* stays behind */ } }
  }
  await writeTextFile(path, text);
}

/* ---------- recently used documents (shown on the home screen) ---------- */
const RECENT = 'matekosdoksi.recent';
export function recentFiles() {
  try { const l = JSON.parse(localStorage.getItem(RECENT) || '[]'); return Array.isArray(l) ? l.filter(r => r && typeof r.path === 'string') : []; } catch (e) { return []; }
}
const setRecent = l => { try { localStorage.setItem(RECENT, JSON.stringify(l.slice(0, 8))); } catch (e) { /* ignore */ } };
export function noteRecent(path) { if (path) setRecent([{ path, at: Date.now() }, ...recentFiles().filter(r => r.path !== path)]); }
export function forgetRecent(path) { setRecent(recentFiles().filter(r => r.path !== path)); }

export function documentJSON(data) { return JSON.stringify({ app: 'matekos-doksi', v: 2, ...data }); }
/** Reads .mdoksi (JSON) – and .html files saved by earlier browser test versions. */
export function parseDocumentFile(text) {
  if (/^\s*\{/.test(text)) return JSON.parse(text);
  const d = new DOMParser().parseFromString(text, 'text/html');
  const s = d.getElementById('mdoksi-data') || d.getElementById('kiadvany-data');
  if (!s) throw new Error('nem Matekos Doksi dokumentum');
  return JSON.parse(s.textContent);
}

/** Save the editable document: its own file (asks only the first time), or a new file (saveAs). */
export async function saveDocument(data, saveAs) {
  const json = documentJSON(data);
  const { save } = await import('@tauri-apps/plugin-dialog');
  let path = !saveAs && currentPath && /\.mdoksi$/i.test(currentPath) ? currentPath : null;
  if (!path) {
    path = await save({ defaultPath: safeName(data.title) + '.mdoksi', filters: [{ name: 'Matekos Doksi dokumentum', extensions: ['mdoksi'] }] });
    if (!path) return 'Mentés megszakítva';
  }
  await writeTextSafely(path, json);
  currentPath = path; noteRecent(path);
  return 'Mentve';
}

/** Rename the document's own file (title box). Returns the new file name, or null when not possible. */
export async function renameCurrentFile(newTitle) {
  const name = safeName(newTitle) + '.mdoksi';
  if (currentPath) {
    if (baseName(currentPath) === name) return name;
    const { rename, exists } = await import('@tauri-apps/plugin-fs');
    const target = currentPath.slice(0, currentPath.length - baseName(currentPath).length) + name;
    if (await exists(target)) throw new Error(`Ebben a mappában már van „${name}” nevű fájl.`);
    await rename(currentPath, target);
    forgetRecent(currentPath); currentPath = target; noteRecent(target); return name;
  }
  return null;
}
/** Does the document's file still exist where it was (it may have been renamed or moved outside the app)? */
export async function currentFileExists() {
  if (!currentPath) return true;
  try { const { exists } = await import('@tauri-apps/plugin-fs'); return await exists(currentPath); } catch (e) { return true; }
}

/** Pick a document. Returns {data, path, name} or null (or {error}). */
export async function openDocumentFile() {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({ multiple: false, filters: [{ name: 'Matekos Doksi dokumentum', extensions: ['mdoksi', 'kiadvany', 'html', 'htm', 'json'] }] });
  if (!path) return null;
  return openPathFile(path);
}
/** Desktop: read a document from a path (e.g. a double-clicked .mdoksi file). */
export async function openPathFile(path) {
  const { readTextFile } = await import('@tauri-apps/plugin-fs');
  const text = await readTextFile(path);
  try { const data = parseDocumentFile(text); if (/\.mdoksi$/i.test(path)) noteRecent(path); return { data, path, name: baseName(path) }; }
  catch (e) { return { error: e }; }
}
/** Desktop: files the operating system asked us to open (double-click), plus later requests. */
export async function watchOpenedFiles(onFile) {
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  await listen('open-files', e => { const p = e.payload && e.payload[0]; if (p) onFile(p); });
  const first = await invoke('take_opened_files');
  return first && first.length ? first[0] : null;
}

/** PDF export. */
export async function savePdfBlob(blob, title) {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { writeFile } = await import('@tauri-apps/plugin-fs');
  const path = await save({ defaultPath: safeName(title) + '.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (!path) return 'Mentés megszakítva';
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  return 'PDF elmentve: ' + baseName(path);
}
/** Desktop printing: the exact PDF is opened in the system PDF viewer, which prints it at true size. */
export async function printPdfBlob(blob, title) {
  const { tempDir, join } = await import('@tauri-apps/api/path');
  const { writeFile } = await import('@tauri-apps/plugin-fs');
  const { openPath } = await import('@tauri-apps/plugin-opener');
  const path = await join(await tempDir(), 'matekos-doksi-print-' + Date.now() + '-' + safeName(title) + '.pdf');
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  await openPath(path);
  return 'Megnyitva a PDF-nézőben – nyomtasd „Tényleges méret” (100%) beállítással';
}

/* ---------- autosave: the last state survives a crash or a closed window ----------
   Every window has its own slot, so two open windows never overwrite each other's draft:
     'doc:<slot>'          the document, {title, tpl, doc, colors, comments, customTpl, path, dirty, at} – with every
                           picture (a data: URL anywhere in it) replaced by a short reference
     'media:<slot>:<id>'   one picture each – written once, not again with every change
   A slot belongs to a running window while that window holds its lock. At start-up the newest slot without an owner
   is continued (as before: the last state comes back); other ownerless slots with unsaved changes stay available
   as "recoverable drafts" (home screen), the rest is removed. */
const DB = 'matekos-doksi', STORE = 'autosave';
const SLOT_KEY = 'md.slot', ALIVE = 'matekosdoksi.alive.', LOCK = 'matekos-doksi-slot-', REF = 'mdoksi-media:', MEDIA_MIN = 2000;
let slot = null, wrote = new Set(), saveChain = Promise.resolve(), drafts = [], mediaIds = new Map(), mediaSeq = 0;
const newSlot = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
function idb() {
  return new Promise((ok, err) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error);
  });
}
const req = r => new Promise((ok, err) => { r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error); });
const txDone = t => new Promise((ok, err) => { t.oncomplete = () => ok(); t.onerror = t.onabort = () => err(t.error); });
const mediaRange = id => IDBKeyRange.bound(`media:${id}:`, `media:${id}:\uffff`);
const hasLocks = () => typeof navigator !== 'undefined' && !!navigator.locks?.request && !!navigator.locks?.query;

/** A copy of `value` whose pictures (data: URLs) are replaced by references; `used` gets id -> data URL. */
function withoutMedia(value, used, ids) {
  const walk = v => {
    if (typeof v === 'string') {
      if (v.length < MEDIA_MIN || !v.startsWith('data:')) return v;
      let id = ids.get(v); if (!id) { id = newSlot() + (mediaSeq++).toString(36); ids.set(v, id); }
      used.set(id, v); return REF + id;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = walk(v[k]); return o; }
    return v;
  };
  return walk(value);
}
function withMedia(value, media) {
  const walk = v => {
    if (typeof v === 'string') return v.startsWith(REF) ? (media[v.slice(REF.length)] ?? '') : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = walk(v[k]); return o; }
    return v;
  };
  return walk(value);
}
/** Slots whose window is running right now. */
async function liveSlots() {
  const live = new Set();
  if (hasLocks()) {
    try { for (const l of (await navigator.locks.query()).held || []) if (l.name.startsWith(LOCK)) live.add(l.name.slice(LOCK.length)); return live; }
    catch (e) { /* fall through to the heartbeat */ }
  }
  try {
    const now = Date.now();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i); if (!k || !k.startsWith(ALIVE)) continue;
      if (now - (+localStorage.getItem(k) || 0) < 10000) live.add(k.slice(ALIVE.length)); else localStorage.removeItem(k);
    }
  } catch (e) { /* ignore */ }
  return live;
}
/** Take a slot for this window. Resolves to a release function, or to null when another window owns the slot.
 *  wait = true: this window's own slot after a reload – wait until the old page has let it go. */
function claim(id, wait = false) {
  if (hasLocks()) return new Promise(res => {
    navigator.locks.request(LOCK + id, wait ? {} : { ifAvailable: true }, lock => {
      if (!lock) { res(null); return undefined; }
      return new Promise(release => res(() => release()));
    }).catch(() => res(() => {}));
  });
  // older systems without the Locks API: a heartbeat
  const beat = () => { try { localStorage.setItem(ALIVE + id, String(Date.now())); } catch (e) { /* ignore */ } };
  beat(); const t = setInterval(beat, 3000);
  const stop = () => { clearInterval(t); try { localStorage.removeItem(ALIVE + id); } catch (e) { /* ignore */ } };
  addEventListener('pagehide', stop);
  return Promise.resolve(stop);
}
async function readSlot(db, id) {
  const s = db.transaction(STORE).objectStore(STORE), rg = mediaRange(id);
  const [v, keys, vals] = await Promise.all([req(s.get('doc:' + id)), req(s.getAllKeys(rg)), req(s.getAll(rg))]);
  if (!v) return null;
  const media = {}, pre = `media:${id}:`.length;
  keys.forEach((k, i) => { media[k.slice(pre)] = vals[i]; });
  return { value: withMedia(v, media), media };
}
/** Write a slot; `known`: ids of the pictures it already holds. Returns the ids it holds now. */
async function writeSlot(db, id, value, known, ids) {
  const used = new Map(), lean = withoutMedia(value, used, ids);
  const t = db.transaction(STORE, 'readwrite'), s = t.objectStore(STORE);
  s.put({ ...lean, at: Date.now() }, 'doc:' + id);
  for (const [k, v] of used) if (!known.has(k)) s.put(v, `media:${id}:${k}`);
  for (const k of known) if (!used.has(k)) s.delete(`media:${id}:${k}`);
  await txDone(t);
  return new Set(used.keys());
}
async function removeSlot(db, id) {
  const t = db.transaction(STORE, 'readwrite'), s = t.objectStore(STORE);
  s.delete('doc:' + id); s.delete(mediaRange(id));
  await txDone(t);
}
const draftInfo = (id, v) => ({ id, title: v.title || 'Névtelen dokumentum', at: v.at || 0, path: v.path || null });

/** Save this window's state (one save at a time; pictures that are already stored are not written again). */
export function autosave(value) {
  const run = async () => {
    if (!slot) return false;
    const db = await idb();
    try {
      wrote = await writeSlot(db, slot, value, wrote, mediaIds);
      for (const [url, id] of mediaIds) if (!wrote.has(id)) mediaIds.delete(url);       // pictures no longer in the document
      return true;
    } finally { db.close(); }
  };
  saveChain = saveChain.then(run, run).catch(() => false);
  return saveChain;
}
/** Start-up: the state this window continues with ({title, tpl, doc, …, path, dirty} or null). */
export async function loadAutosave() {
  let db = null;
  try {
    db = await idb();
    const store = mode => db.transaction(STORE, mode).objectStore(STORE);
    // versions up to 0.10.1 kept a single state for every window
    const old = await req(store('readonly').get('last'));
    if (old) { await writeSlot(db, newSlot(), old, new Set(), new Map()); await req(store('readwrite').delete('last')); }

    let own = null; try { own = sessionStorage.getItem(SLOT_KEY); } catch (e) { own = null; }
    drafts = [];
    if (own) { slot = own; claim(slot, true); }                 // the same window after a reload
    else {
      const ids = (await req(store('readonly').getAllKeys())).filter(k => typeof k === 'string' && k.startsWith('doc:')).map(k => k.slice(4));
      const live = await liveSlots(), free = [];
      for (const id of ids) if (!live.has(id)) { const v = await req(store('readonly').get('doc:' + id)); if (v) free.push({ id, v }); }
      free.sort((a, b) => (b.v.at || 0) - (a.v.at || 0));
      for (const { id, v } of free) {
        if (!slot) { if (await claim(id)) slot = id; continue; }
        if (v.dirty && (v.doc || v.html)) { drafts.push(draftInfo(id, v)); continue; }
        const release = await claim(id);                        // nothing unsaved in it: no longer needed
        if (release) { try { await removeSlot(db, id); } finally { release(); } }
      }
      if (!slot) { slot = newSlot(); claim(slot, true); }
      try { sessionStorage.setItem(SLOT_KEY, slot); } catch (e) { /* ignore */ }
    }
    const r = await readSlot(db, slot);
    wrote = new Set(Object.keys(r?.media || {}));
    mediaIds = new Map(Object.entries(r?.media || {}).map(([id, url]) => [url, id]));
    return r ? r.value : null;
  } catch (e) {
    if (!slot) { slot = newSlot(); claim(slot, true); try { sessionStorage.setItem(SLOT_KEY, slot); } catch (e2) { /* ignore */ } }
    return null;
  } finally { db?.close(); }
}
/** Unsaved documents of windows that are no longer running: [{id, title, at, path}], newest first. */
export const recoverableDrafts = () => drafts;
/** Take a recoverable draft out of the store (it continues in this window). Null when it is gone or open elsewhere. */
export async function takeDraft(id) {
  let db = null;
  try {
    const release = await claim(id); if (!release) return null;
    try {
      db = await idb();
      const r = await readSlot(db, id);
      await removeSlot(db, id);
      drafts = drafts.filter(d => d.id !== id);
      return r ? r.value : null;
    } finally { release(); }
  } catch (e) { return null; } finally { db?.close(); }
}
export async function dropDraft(id) { await takeDraft(id); drafts = drafts.filter(d => d.id !== id); }
/** Put a state aside as a recoverable draft (before this window continues with another document). */
export async function shelveDraft(value) {
  let db = null;
  try {
    db = await idb();
    const id = newSlot(); await writeSlot(db, id, { ...value, dirty: true }, new Set(), new Map());
    drafts = [draftInfo(id, { ...value, at: Date.now() }), ...drafts];
    return true;
  } catch (e) { return false; } finally { db?.close(); }
}

/** Pick a Word document; returns {buf, name} or null. */
export async function pickDocx() {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readFile } = await import('@tauri-apps/plugin-fs');
    const path = await open({ multiple: false, filters: [{ name: 'Word-dokumentum', extensions: ['docx'] }] });
    if (!path) return null;
    return { buf: await readFile(path), name: baseName(path) };
  }
  return new Promise(resolve => {
    const inp = document.getElementById('docxIn');
    inp.onchange = async () => { const f = inp.files[0]; inp.value = ''; resolve(f ? { buf: new Uint8Array(await f.arrayBuffer()), name: f.name } : null); };
    inp.click();
  });
}

/* ---------- template files (.mdsab = Matekos Doksi SABlon) ---------- */
let lastTplPath = null;                 // the path of the template file last saved / opened (desktop app)
export const templateFilePath = () => lastTplPath;
/** Overwrite a template file (desktop app: the given path; otherwise a download). */
export async function updateTemplateFile(path, data) {
  const json = JSON.stringify({ app: 'matekos-doksi-sablon', v: 1, ...data });
  if (isTauri() && path) { await writeTextSafely(path, json); return baseName(path); }
  return saveTemplateFile(data, data.name || 'sablon');
}
export async function saveTemplateFile(data, suggested) {
  const json = JSON.stringify({ app: 'matekos-doksi-sablon', v: 1, ...data });
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({ defaultPath: safeName(suggested) + '.mdsab', filters: [{ name: 'Matekos Doksi Sablon', extensions: ['mdsab'] }] });
    if (!path) return null;
    await writeTextFile(path, json);
    lastTplPath = path;
    return baseName(path);
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })), a = document.createElement('a');
  a.href = url; a.download = safeName(suggested) + '.mdsab'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  return a.download;
}
/** Pick a template file: {data, name} or null. */
export async function openTemplateFile() {
  let text, name;
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await open({ multiple: false, filters: [{ name: 'Matekos Doksi Sablon', extensions: ['mdsab'] }] });
    if (!path) return null;
    text = await readTextFile(path); name = baseName(path); lastTplPath = path;
  } else {
    const f = await new Promise(res => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.mdsab'; inp.onchange = () => res(inp.files[0] || null); inp.click(); });
    if (!f) return null;
    text = await f.text(); name = f.name;
  }
  const data = JSON.parse(text);
  if (!data || data.app !== 'matekos-doksi-sablon' || !data.tpl) throw new Error('Ez nem Matekos Doksi sablonfájl (.mdsab).');
  return { data, name };
}

/* ---------- Markdown ---------- */
export async function pickMarkdown() {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await open({ multiple: false, filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }] });
    if (!path) return null;
    return { text: await readTextFile(path), name: baseName(path) };
  }
  const f = await new Promise(res => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.md,.markdown,.txt'; inp.onchange = () => res(inp.files[0] || null); inp.click(); });
  return f ? { text: await f.text(), name: f.name } : null;
}
export async function saveMarkdown(text, title) {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({ defaultPath: safeName(title) + '.md', filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (!path) return 'Mentés megszakítva';
    await writeTextFile(path, text);
    return 'Markdown elmentve: ' + baseName(path);
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' })), a = document.createElement('a');
  a.href = url; a.download = safeName(title) + '.md'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'Markdown elmentve';
}
