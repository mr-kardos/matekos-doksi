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
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
  let path = !saveAs && currentPath && /\.mdoksi$/i.test(currentPath) ? currentPath : null;
  if (!path) {
    path = await save({ defaultPath: safeName(data.title) + '.mdoksi', filters: [{ name: 'Matekos Doksi dokumentum', extensions: ['mdoksi'] }] });
    if (!path) return 'Mentés megszakítva';
  }
  await writeTextFile(path, json);
  currentPath = path;
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
    currentPath = target; return name;
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
  try { return { data: parseDocumentFile(text), path, name: baseName(path) }; }
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

/* ---------- autosave: the last state survives a crash or a closed window (IndexedDB: room for pictures) ---------- */
const DB = 'matekos-doksi', STORE = 'autosave';
function idb() {
  return new Promise((ok, err) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error);
  });
}
export async function autosave(value) {
  try {
    const db = await idb();
    await new Promise((ok, err) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(value, 'last'); t.oncomplete = ok; t.onerror = () => err(t.error); });
    db.close(); return true;
  } catch (e) { return false; }
}
export async function loadAutosave() {
  try {
    const db = await idb();
    const v = await new Promise((ok, err) => { const r = db.transaction(STORE).objectStore(STORE).get('last'); r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error); });
    db.close(); return v || null;
  } catch (e) { return null; }
}
