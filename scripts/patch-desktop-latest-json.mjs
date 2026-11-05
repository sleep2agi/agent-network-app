// Linux 腿要往 tauri-action 写好的 latest.json 里补 linux-x86_64 条目。
//
// 2026-11-05 两条真红都是这段逻辑造成的，别再退回「下载不到就写一份新的」：
//   · 第 4 次：`gh release download` 对草稿资产拿不到文件 ⇒ 写了一份只有 version/platforms(linux) 的清单
//     ⇒ verify 报 `latest.json version undefined`（那版还有自愈 version 的逻辑，掩盖了一半）
//   · 第 5 次：把 version 自愈上以后，清单里没有 darwin-aarch64 ⇒ verify 报
//     `latest.json missing darwin-aarch64 url` —— macOS/Windows 的条目被这份新清单**覆盖掉了**
//
// 现在的规则（fail-closed）：
//   1. 必须用 REST 取回草稿里的 latest.json（GET /releases/assets/<id> + Accept: application/octet-stream）。
//      `gh release download` 在草稿上不可靠，不要再用。
//   2. 取不到、或者取回来的清单不是本版本、或缺少 darwin-aarch64 / windows-x86_64 ⇒ 直接报错退出。
//      宁可让 verify-draft 红在「清楚的一句话」上，也不产出一份只有 linux 的假清单。
//   3. linux 两个条目的 url 必须用 release 资产的 `browser_download_url`（草稿期是 untagged-…），
//      verify-draft 的 matchesAsset 只认这个值。
import { readFileSync, writeFileSync } from 'node:fs';

const MANIFEST_PLATFORMS = ['darwin-aarch64', 'windows-x86_64'];

/**
 * Merge the Linux updater entries into an existing latest.json document.
 * Pure: throws instead of inventing a document when the input is not already a
 * complete macOS/Windows manifest.
 */
export function withLinuxUpdaterEntries({ manifest, version, debName, debUrl, signature }) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('latest.json is missing; refusing to write a linux-only manifest');
  }
  if (manifest.version !== version) {
    throw new Error(`latest.json version ${JSON.stringify(manifest.version)} is not ${version}`);
  }
  const platforms = manifest.platforms;
  if (!platforms || typeof platforms !== 'object' || Array.isArray(platforms)) {
    throw new Error('latest.json platforms missing; refusing to write a linux-only manifest');
  }
  for (const key of MANIFEST_PLATFORMS) {
    const entry = platforms[key];
    if (!entry || typeof entry.url !== 'string' || !entry.url || typeof entry.signature !== 'string' || !entry.signature) {
      throw new Error(`latest.json is missing ${key}; refusing to overwrite the macOS/Windows entries`);
    }
  }
  if (!debUrl) throw new Error(`release has no download url for ${debName}`);
  if (!signature) throw new Error(`${debName}.sig is empty`);
  return {
    ...manifest,
    platforms: {
      ...platforms,
      'linux-x86_64': { signature, url: debUrl },
      'linux-x86_64-deb': { signature, url: debUrl },
    },
  };
}

/** Find the download URL verify-draft will accept for `name` on a draft release. */
export function assetDownloadUrl(release, name) {
  const asset = (release?.assets ?? []).find((candidate) => candidate?.name === name);
  if (!asset) throw new Error(`release ${release?.tag_name ?? '?'} has no asset ${name}`);
  // Drafts report `untagged-…` here; that is exactly what `gh release view --json assets`
  // hands verify-desktop-release-draft.mjs, so the manifest has to agree with it.
  const url = asset.browser_download_url || asset.url;
  if (!url) throw new Error(`asset ${name} has no browser_download_url`);
  return url;
}

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

if (process.argv[1]?.endsWith('patch-desktop-latest-json.mjs')) {
  const manifestPath = arg('manifest', '/tmp/latest.json');
  const releasePath = arg('release-json');
  const version = arg('version');
  const debName = arg('deb');
  const sigPath = arg('sig-file');
  if (!releasePath || !version || !debName || !sigPath) {
    throw new Error('usage: patch-desktop-latest-json.mjs --release-json <file> --version <v> --deb <deb name> --sig-file <file.sig> [--manifest /tmp/latest.json]');
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const release = JSON.parse(readFileSync(releasePath, 'utf8'));
  const patched = withLinuxUpdaterEntries({
    manifest,
    version,
    debName,
    debUrl: assetDownloadUrl(release, debName),
    signature: readFileSync(sigPath, 'utf8').trim(),
  });
  writeFileSync(manifestPath, `${JSON.stringify(patched, null, 2)}\n`);
  console.log(`latest.json patched with linux entries for ${version} (${debName})`);
}
