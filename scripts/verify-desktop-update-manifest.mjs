#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ENDPOINT = 'https://www.anet.sh/desktop/update/latest.json';
const DEFAULT_REPOSITORY = 'sleep2agi/agent-network-app';

const sorted = (value) => {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  }
  return value;
};

export const canonicalJson = (value) => JSON.stringify(sorted(value));

const jsonResponse = async (response, label, requireJsonContentType = true) => {
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (requireJsonContentType && !contentType.toLowerCase().includes('json')) {
    throw new Error(`${label}: expected JSON content-type, got ${contentType || '(missing)'}`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${label}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
};

export async function verifyDesktopUpdateManifest({
  fetchImpl = fetch,
  endpoint = DEFAULT_ENDPOINT,
  repository = DEFAULT_REPOSITORY,
  token = '',
} = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const deployed = await jsonResponse(await fetchImpl(endpoint), 'deployed manifest');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(deployed?.version ?? '')) {
    throw new Error(`deployed manifest: invalid version ${JSON.stringify(deployed?.version)}`);
  }

  const tag = `desktop-v${deployed.version}`;
  const releaseUrl = `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`;
  const release = await jsonResponse(await fetchImpl(releaseUrl, { headers }), `release ${tag}`);
  if (release.draft) throw new Error(`release ${tag}: still a draft`);
  const asset = Array.isArray(release.assets)
    ? release.assets.find((candidate) => candidate?.name === 'latest.json')
    : undefined;
  if (!asset?.browser_download_url) throw new Error(`release ${tag}: latest.json asset missing`);

  const generated = await jsonResponse(
    await fetchImpl(asset.browser_download_url, { headers }),
    `release ${tag} latest.json`,
    false,
  );
  if (canonicalJson(deployed) !== canonicalJson(generated)) {
    throw new Error(`desktop updater drift: deployed manifest differs from ${tag} release asset`);
  }

  return { version: deployed.version, tag, assetUrl: asset.browser_download_url };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  verifyDesktopUpdateManifest({
    endpoint: process.env.DESKTOP_UPDATE_ENDPOINT || DEFAULT_ENDPOINT,
    repository: process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY,
    token: process.env.GITHUB_TOKEN || '',
  }).then(({ version, tag }) => {
    console.log(`desktop updater manifests match: ${version} (${tag})`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
