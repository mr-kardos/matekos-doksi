// No file uses a name that does not exist, reassigns a constant or declares something twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ESLint } from 'eslint';
import globals from 'globals';

const root = fileURLToPath(new URL('..', import.meta.url));
test('no undefined names, no reassigned constants', async () => {
  const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: [{
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser, __APP_VERSION__: 'readonly' } },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: { 'no-undef': 'error', 'no-const-assign': 'error', 'no-import-assign': 'error', 'no-redeclare': 'error', 'no-dupe-keys': 'error', 'no-dupe-args': 'error', 'no-func-assign': 'error' }
  }] });
  const results = await eslint.lintFiles(['src/**/*.js']);
  assert.deepEqual(results.flatMap(r => r.messages.filter(m => m.severity === 2).map(m => `${path.relative(root, r.filePath)}:${m.line}  ${m.message}`)), []);
});
