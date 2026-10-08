// #806 provenance / #807 reviewed adaptation; not an upgrade-behavior test.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const dir = new URL('src-tauri/windows/vendor/', root);
const source = JSON.parse(readFileSync(new URL('wix-source.json', dir), 'utf8'));
const template = readFileSync(new URL(source.localPath, dir));
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const config = JSON.parse(readFileSync(new URL('src-tauri/tauri.conf.json', root), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('package-lock.json', root), 'utf8'));
let passed = 0, total = 0;
function ck(label: string, ok: boolean) {
  total++;
  if (ok) passed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
}
ck('WiX template bytes match reviewed SHA256', sha256(template) === (source.localSha256 ?? source.sha256));
ck('WiX Git blob matches reviewed content', createHash('sha1').update(`blob ${template.length}\0`).update(template).digest('hex') === (source.localGitBlob ?? source.gitBlob));
ck('WiX MIT license is preserved', sha256(readFileSync(new URL(source.licensePath, dir))) === source.licenseSha256);
ck('WiX baseline matches locked bundler', lock.packages['node_modules/@tauri-apps/cli'].version === source.cliVersion);
ck('WiX source uses an immutable commit', source.commit === '499df79be65ef8c0670abc0207cd9e37b55d8491');
ck('Tauri selects the reviewed WiX template', config.bundle.windows.wix.template === `./windows/vendor/${source.localPath}`);
console.log(`${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
