// Copies the parts of MathJax 4 and the Bonum math font that the app needs into
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
const font = join(out, 'fonts', 'mathjax-bonum-font');
mkdirSync(font, { recursive: true });
cpSync(join(nm, '@mathjax', 'mathjax-bonum-font', 'svg.js'), join(font, 'svg.js'));
cpSync(join(nm, '@mathjax', 'mathjax-bonum-font', 'svg'), join(font, 'svg'), { recursive: true });
console.log('MathJax + Bonum math font copied to public/mathjax');
