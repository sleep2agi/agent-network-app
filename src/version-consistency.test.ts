import fs from 'node:fs';

const expected = '0.2.48';
const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const appJson = JSON.parse(fs.readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
const tauriConfig = JSON.parse(fs.readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const cargoToml = fs.readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
const cargoLock = fs.readFileSync(new URL('../src-tauri/Cargo.lock', import.meta.url), 'utf8');
const versionSource = fs.readFileSync(new URL('./version.ts', import.meta.url), 'utf8');
const normalizeNewlines = (text: string) => text.replace(/\r\n?/g, '\n');
const prerelease = expected.split('-', 2)[1];
const cargoPackagePattern = new RegExp(
  `name = "agent-network-desktop"\\nversion = "${expected.replaceAll('.', '\\.')}"`,
);

const checks: Array<[string, boolean]> = [
  ['release version is numeric major.minor.patch for Apple compatibility', /^\d+\.\d+\.\d+$/.test(expected)],
  ['Windows MSI prerelease identifier', !prerelease || /^\d+$/.test(prerelease) && Number(prerelease) <= 65535],
  ['package.json', packageJson.version === expected],
  ['package-lock root', packageLock.version === expected],
  ['package-lock workspace', packageLock.packages?.['']?.version === expected],
  ['app.json', appJson.expo?.version === expected],
  ['tauri.conf.json', tauriConfig.version === expected],
  ['Cargo.toml', new RegExp(`^version = "${expected.replaceAll('.', '\\.')}"$`, 'm').test(cargoToml)],
  ['Cargo.lock root package', cargoPackagePattern.test(normalizeNewlines(cargoLock))],
  ['Cargo.lock CRLF checkout', cargoPackagePattern.test(normalizeNewlines(normalizeNewlines(cargoLock).replaceAll('\n', '\r\n')))],
  ['display version', versionSource.includes(`APP_VERSION = '${expected}'`)],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name} must be ${expected}`);
  console.log(`PASS: ${name} = ${expected}`);
}
