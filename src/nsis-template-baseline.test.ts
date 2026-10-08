// #789 provenance / #788 reviewed adaptation; not an upgrade-behavior test.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const dir = new URL('src-tauri/windows/vendor/', root);
const source = JSON.parse(readFileSync(new URL('source.json', dir), 'utf8'));
const template = readFileSync(new URL(source.localPath, dir));
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
let passed = 0, total = 0;
function ck(label: string, ok: boolean) {
  total++;
  if (ok) passed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
}
ck('template bytes match reviewed SHA256', sha256(template) === (source.localSha256 ?? source.sha256));
ck('template Git blob matches reviewed content',
  createHash('sha1').update(`blob ${template.length}\0`).update(template).digest('hex') === (source.localGitBlob ?? source.gitBlob));
ck('upstream MIT license is preserved', sha256(readFileSync(new URL('LICENSE-MIT', dir))) === source.licenseSha256);
ck('baseline matches locked bundler version',
  readFileSync(new URL('bun.lock', root), 'utf8').includes(`"@tauri-apps/cli": ["@tauri-apps/cli@${source.cliVersion}",`));
ck('source uses an immutable commit', /^[a-f0-9]{40}$/.test(source.commit));
console.log(`${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
