const fs = require('node:fs');
const assert = require('node:assert/strict');
const Handlebars = require('/usr/share/nodejs/handlebars');
const source = fs.readFileSync('src-tauri/windows/vendor/main.tauri-2.11.2.wxs', 'utf8');
function check(template) {
  // Real Handlebars rendering, then expand the single WiX identity define.
  const rendered = Handlebars.compile(template, { noEscape: true })({
    manufacturer: 'vansin', product_name: 'ANet',
  }).replaceAll('$(var.InstallIdentity)', 'Agent Network');
  const keys = [...rendered.matchAll(/Key="([^"]*Agent Network)"/g)].map(m => m[1]);
  assert.equal(keys.length, 7);
  for (const key of keys) assert.equal(key, 'Software\\vansin\\Agent Network', 'rendered registry key has invalid separators');
}
check(source);
console.log('PASS rendered registry paths match published MSI identity (7 keys)');
const mutant = source.replaceAll('\\$(var.InstallIdentity)', '\\\\$(var.InstallIdentity)');
assert.notEqual(mutant, source);
assert.throws(() => check(mutant), /rendered registry key has invalid separators/);
console.log('MUTATION_RED: doubled separator before WiX variable fails rendered-key assertion');
