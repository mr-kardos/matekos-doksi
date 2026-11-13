import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// src/main.js is only a list of its parts (src/main/*.js): they are joined here, in the listed order, into one module –
// the parts share one scope, exactly as if they were still one long file.
export function joinParts(file) {
  const dir = dirname(file), parts = readFileSync(file, 'utf8').split(/\r?\n/).map(l => /^\/\/@part\s+(\S+)/.exec(l)?.[1]).filter(Boolean).map(p => join(dir, p));
  return { parts, code: parts.map(f => readFileSync(f, 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '')).join('\n') + '\n' };
}
const joinedParts = () => ({
  name: 'matekos-joined-parts', enforce: 'pre',
  load(id) {
    const file = id.split('?')[0];
    if (!file.replace(/\\/g, '/').endsWith('/src/main.js')) return null;
    const { parts, code } = joinParts(file);
    for (const f of parts) this.addWatchFile(f);
    return { code, map: null };
  }
});

// "npm run build" -> dist/ (loaded by the desktop app; MathJax and fonts served locally, works offline)
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [joinedParts()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: { target: 'es2021', outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 5000 }
});
