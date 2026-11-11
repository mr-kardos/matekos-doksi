// "A new version is out" notice. At start-up the app reads a small announcement file (update.json) and, when
// the version in it is newer than this app's, shows the message with a download button. Nothing is sent about the
// user; without internet (or without the file) the app simply starts as usual.
// To announce an update: edit update.json in the GitHub repository (version, message, url).
export const UPDATE_URL = 'https://raw.githubusercontent.com/mr-kardos/matekos-doksi/main/update.json';
export const APP_VERSION = __APP_VERSION__;

const parts = v => String(v || '').replace(/^v/i, '').split(/[.\-+]/).map(x => parseInt(x, 10) || 0);
export function newer(a, b) {           // is version a newer than b?
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}
/** {version, message, url} when there is a newer version, otherwise null (also on any error). */
export async function checkForUpdate(url = UPDATE_URL) {
  if (!url || /FELHASZNALONEV/.test(url)) return null;          // not set up yet
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), {cache: 'no-store', signal: ctl.signal});
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.version && newer(j.version, APP_VERSION) ? j : null;
  } catch (e) { return null; }
}
export async function openLink(url) {
  try { if (window.__TAURI_INTERNALS__) { const {openUrl} = await import('@tauri-apps/plugin-opener'); await openUrl(url); return; } } catch (e) { /* fall back */ }
  window.open(url, '_blank', 'noopener');
}
