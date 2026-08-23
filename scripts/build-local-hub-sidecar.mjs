import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sidecarRoot = join(root, 'local-hub-sidecar');
const packageJson = JSON.parse(readFileSync(join(sidecarRoot, 'node_modules/@sleep2agi/commhub-server/package.json'), 'utf8'));
const sidecarPackage = JSON.parse(readFileSync(join(sidecarRoot, 'package.json'), 'utf8'));
const sidecarLock = JSON.parse(readFileSync(join(sidecarRoot, 'package-lock.json'), 'utf8'));
const pinnedVersion = sidecarPackage.dependencies['@sleep2agi/commhub-server'];
const sourceIntegrity = sidecarLock.packages?.['node_modules/@sleep2agi/commhub-server']?.integrity;
if (!sourceIntegrity) throw new Error('CommHub npm integrity is missing from package-lock.json');
if (packageJson.version !== pinnedVersion) {
  throw new Error(`locked CommHub version ${packageJson.version} does not match pin ${pinnedVersion}`);
}

const rustc = process.env.LOCAL_HUB_TARGET ? null : spawnSync('rustc', ['-vV'], { encoding: 'utf8' });
if (rustc && rustc.status !== 0) throw new Error(`rustc -vV failed: ${rustc.stderr || rustc.error}`);
const target = process.env.LOCAL_HUB_TARGET || rustc?.stdout.match(/^host:\s*(\S+)$/m)?.[1];
if (!target) throw new Error('cannot determine Rust host target');

const work = mkdtempSync(join(tmpdir(), 'agent-network-local-hub-'));
try {
  const packageCopy = join(work, 'commhub-server');
  cpSync(join(sidecarRoot, 'node_modules/@sleep2agi/commhub-server'), packageCopy, { recursive: true });
  symlinkSync(join(sidecarRoot, 'node_modules'), join(work, 'node_modules'), 'dir');
  const serverPath = join(packageCopy, 'src/server.ts');
  const source = readFileSync(serverPath, 'utf8');
  const versionBlock = /const SERVER_VERSION = \(\(\) => \{[\s\S]*?\n\}\)\(\);/;
  if (!versionBlock.test(source)) throw new Error('CommHub version block changed; refusing an unversioned sidecar build');
  writeFileSync(serverPath, source.replace(versionBlock, `const SERVER_VERSION = ${JSON.stringify(pinnedVersion)};`));

  const outDir = join(root, 'src-tauri/binaries');
  mkdirSync(outDir, { recursive: true });
  const extension = target.includes('windows') ? '.exe' : '';
  const output = join(outDir, `commhub-${target}${extension}`);
  const build = spawnSync('bun', ['build', '--compile', join(packageCopy, 'src/index.ts'), '--outfile', output], {
    cwd: sidecarRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (build.status !== 0) throw new Error(`Bun sidecar build failed:\n${build.stdout}\n${build.stderr}`);

  const bytes = readFileSync(output);
  const size = statSync(output).size;
  const maxBytes = 110 * 1024 * 1024;
  if (size > maxBytes) throw new Error(`CommHub sidecar ${size} bytes exceeds ${maxBytes}-byte gate`);
  const manifest = {
    schemaVersion: 1,
    commhubVersion: pinnedVersion,
    apiVersion: 'v3',
    target,
    executable: `commhub${extension}`,
    sourceIntegrity,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size,
  };
  writeFileSync(join(outDir, 'commhub-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest));
} finally {
  rmSync(work, { recursive: true, force: true });
}
