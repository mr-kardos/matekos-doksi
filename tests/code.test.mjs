// The editor's code (src/main.js = the joined parts in src/main/, see vite.config.js): no part is forgotten, the
// joined module is valid, and no file uses a name that does not exist, reassigns a constant or declares something twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ESLint } from 'eslint';
import globals from 'globals';
import { transform } from 'esbuild';
import { joinParts } from '../vite.config.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const main = path.join(root, 'src', 'main.js'), partsDir = path.join(root, 'src', 'main');
const lint = () => new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: [{
  languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser, __APP_VERSION__: 'readonly' } },
  linterOptions: { reportUnusedDisableDirectives: 'off' },
  rules: { 'no-undef': 'error', 'no-const-assign': 'error', 'no-import-assign': 'error', 'no-redeclare': 'error', 'no-dupe-keys': 'error', 'no-dupe-args': 'error', 'no-func-assign': 'error' }
}] });
const problems = results => results.flatMap(r => r.messages.filter(m => m.severity === 2).map(m => `${path.relative(root, r.filePath)}:${m.line}  ${m.message}`));

test('every file in src/main/ is listed in main.js exactly once', () => {
  const listed = joinParts(main).parts.map(f => path.basename(f)), found = readdirSync(partsDir).filter(f => f.endsWith('.js'));
  assert.deepEqual([...listed].sort(), [...found].sort());
  assert.equal(new Set(listed).size, listed.length);
});

test('the joined editor module is valid JavaScript', async () => {
  await transform(joinParts(main).code, { loader: 'js', format: 'esm' });
});

test('no undefined names, no reassigned constants (joined editor and the other modules)', async () => {
  const eslint = lint();
  const joined = await eslint.lintText(joinParts(main).code, { filePath: main });
  const others = (await eslint.lintFiles(['src/**/*.js'])).filter(r => r.filePath !== main && path.dirname(r.filePath) !== partsDir);   // the parts are checked joined
  assert.deepEqual(problems([...joined, ...others]), []);
});
