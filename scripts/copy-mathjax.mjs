// Copies the parts of MathJax 4 and the math fonts that the app needs into
// public/mathjax so the desktop app works fully offline.
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const nm = join(root, 'node_modules');
const out = join(root, 'public', 'mathjax');
if (existsSync(out)) rmSync(out, { recursive: true });
mkdirSync(out, { recursive: true });
for (const f of ['startup.js', 'core.js', 'loader.js', 'input', 'output', 'adaptors', 'LICENSE']) {
  cpSync(join(nm, 'mathjax', f), join(out, f), { recursive: true });
}
// the 9 math fonts of the font sets
for (const name of ['bonum', 'pagella', 'termes', 'schola', 'modern', 'newcm', 'stix2', 'fira', 'dejavu']) {
  const src = join(nm, '@mathjax', `mathjax-${name}-font`), dst = join(out, 'fonts', `mathjax-${name}-font`);
  mkdirSync(dst, { recursive: true });
  cpSync(join(src, 'svg.js'), join(dst, 'svg.js'));
  if (existsSync(join(src, 'svg'))) cpSync(join(src, 'svg'), join(dst, 'svg'), { recursive: true });
}
console.log('MathJax + 9 math fonts copied to public/mathjax');
