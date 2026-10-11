// Saving, opening and printing – native dialogs in the desktop app, downloads in the browser.
export const isTauri = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

const enc = s => new TextEncoder().encode(s);
export const safeName = t => (t || 'dokumentum').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 120) || 'dokumentum';

let currentPath = null;
export const getCurrentPath = () => currentPath;
export const setCurrentPath = p => { currentPath = p; };

/** Browser download (or the claude.ai downloads capability when running as a published page). */
async function download(filename, blob) {
  let dl = null;
  try { if (window.claude && window.claude.use) dl = await window.claude.use('downloads'); } catch (e) { dl = null; }
  if (dl) {
    try { await dl.save({ filename, data: blob }); return 'Elmentve: ' + filename; }
    catch (e) { return e && e.code === 'declined' ? 'Mentés megszakítva' : 'A fájl mentése nem sikerült' + (e && e.code ? ' (' + e.code + ')' : ''); }
  }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'Elmentve: ' + filename;
}

export function documentJSON(data) { return JSON.stringify({ app: 'matekos-doksi', v: 2, ...data }); }

/** A browser-readable .html file that also carries the full editable document. */
export function documentHTML(data, bodyHTML) {
  const json = documentJSON(data).replace(/</g, '\\u003c');
  const css = "body{font-family:'TeX Gyre Bonum',Georgia,serif;max-width:170mm;margin:40px auto;padding:0 16px;line-height:1.3}"
    + "img.wl{float:left;margin:.2em 1em .5em 0}img.wr{float:right;margin:.2em 0 .5em 1em}img.ctr{display:block;margin:.4em auto}img{max-width:100%}"
    + "table{width:100%;border-collapse:collapse}td,th{border:.75pt solid #7d8590;padding:3pt 5pt;vertical-align:top}"
    + "[data-shade]{background:var(--shade)}.math{font-family:monospace;color:#555}";
  return '<!doctype html>\n<html lang="hu"><head><meta charset="utf-8"><meta name="generator" content="Matekos Doksi">'
    + '<title>' + (data.title || '').replace(/</g, '&lt;') + '</title><style>' + css + '</style></head><body>'
    + bodyHTML + '<script type="application/json" id="mdoksi-data">' + json + '<\/script></body></html>';
}

export function parseDocumentFile(text) {
  if (/^\s*\{/.test(text)) return JSON.parse(text);
  const d = new DOMParser().parseFromString(text, 'text/html');
  const s = d.getElementById('mdoksi-data') || d.getElementById('kiadvany-data');
  if (!s) throw new Error('not a Matekos Doksi document');
  return JSON.parse(s.textContent);
}

export async function saveEditable(data, bodyHTML, saveAs) {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    let path = !saveAs && currentPath;
    if (!path) {
      path = await save({ defaultPath: safeName(data.title) + '.mdoksi', filters: [{ name: 'Matekos Doksi dokumentum', extensions: ['mdoksi'] }] });
      if (!path) return 'Mentés megszakítva';
    }
    if (/\.html?$/i.test(path)) await writeTextFile(path, documentHTML(data, bodyHTML));
    else await writeTextFile(path, documentJSON(data));
    currentPath = path;
    return 'Elmentve: ' + path.split(/[\\/]/).pop();
  }
  return download(safeName(data.title) + '.html', new Blob([documentHTML(data, bodyHTML)], { type: 'text/html' }));
}

/** Desktop: read a document from a path (e.g. a double-clicked .mdoksi file). */
export async function openPathFile(path) {
  const { readTextFile } = await import('@tauri-apps/plugin-fs');
  const text = await readTextFile(path);
  return { data: parseDocumentFile(text), path, name: String(path).split(/[\\/]/).pop() };
}
/** Desktop: files the operating system asked us to open (double-click), plus later requests. */
export async function watchOpenedFiles(onFile) {
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  await listen('open-files', e => { const p = e.payload && e.payload[0]; if (p) onFile(p); });
  const first = await invoke('take_opened_files');
  return first && first.length ? first[0] : null;
}

export async function openDocumentFile() {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await open({ multiple: false, filters: [{ name: 'Matekos Doksi dokumentum', extensions: ['mdoksi', 'kiadvany', 'html', 'htm', 'json'] }] });
    if (!path) return null;
    const text = await readTextFile(path);
    return { data: parseDocumentFile(text), path, name: String(path).split(/[\\/]/).pop() };
  }
  return new Promise(resolve => {
    const inp = document.getElementById('openIn');
    inp.onchange = async () => {
      const f = inp.files[0]; inp.value = '';
      if (!f) return resolve(null);
      try { resolve({ data: parseDocumentFile(await f.text()), path: null, name: f.name }); }
      catch (e) { resolve({ error: e }); }
    };
    inp.click();
  });
}

export async function savePdfBlob(blob, title) {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({ defaultPath: safeName(title) + '.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (!path) return 'Mentés megszakítva';
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return 'Elmentve: ' + String(path).split(/[\\/]/).pop();
  }
  return download(safeName(title) + '.pdf', blob);
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
