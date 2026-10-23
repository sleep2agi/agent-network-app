#!/usr/bin/env node
// 发版漂移看门狗(CI 版):线上四处的版本是否还一致。
//
// 为什么放进 CI:0.2.289 的静态兜底停在 0.2.288 且完全没有 Linux 条目,没人发现;
// 0.2.292 的草稿少了 APK,是发到一半才看出来。这些都能在发布后几分钟内被判出来,
// 不该靠人隔几小时想起来看一眼。
//
// 检查项(任一不一致 → 退出码 1):
//   releases/latest         正式版、非预发布、tag 是 desktop-v<version>
//   该版本的 latest.json     版本一致、平台数 = 有无 .deb 决定 5/7、每项有签名、URL 全公共
//   站点动态 endpoints       /desktop/update/latest.json 版本与平台数一致
//   站点静态兜底             fallback.json 版本一致(落后只警告,缺平台键算失败)
//   镜像                     desktop/android latest/VERSION 一致
//
// 用法:node scripts/release-drift-check.mjs [expected-version]
// 只读:GET/HEAD 与公开 API,不需要任何凭据(GITHUB_TOKEN 有则带上,避免限流)。
import process from 'node:process';

const REPO = 'sleep2agi/agent-network-app';
const MIRROR = 'https://modelscope.cn/datasets/SmartFlowAI/agent-network-releases/resolve/master';
const SITE = 'https://www.anet.sh';
const HEADERS = { 'user-agent': 'anet-drift-check', accept: 'application/json' };
if (process.env.GITHUB_TOKEN) HEADERS.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const rows = [];
const bad = [];
const warn = [];

const get = async (url, timeoutMs = 25000) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
};
const getJson = async (url, timeoutMs) => {
  const r = await get(url, timeoutMs);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return JSON.parse(r.text);
};
const getText = async (url, timeoutMs) => {
  const r = await get(url, timeoutMs);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text.trim();
};

const expected = process.argv[2] || '';

const release = await getJson(`https://api.github.com/repos/${REPO}/releases/latest`, 30000);
const version = String(release.tag_name || '').replace(/^desktop-v/, '');
if (!version) bad.push('releases/latest has no desktop-v* tag');
if (expected && version !== expected) bad.push(`releases/latest is ${version}, expected ${expected}`);
if (release.draft || release.prerelease) bad.push('releases/latest is a draft or prerelease');
rows.push(['github release', release.tag_name, `${(release.assets ?? []).length} assets`]);

const manifestAsset = (release.assets ?? []).find(a => a.name === 'latest.json');
if (!manifestAsset) {
  bad.push('release has no latest.json');
} else {
  const manifest = await getJson(manifestAsset.browser_download_url, 40000);
  const plats = Object.keys(manifest.platforms ?? {});
  const expectCount = plats.some(k => k.endsWith('-deb')) ? 7 : 5;
  rows.push(['release latest.json', manifest.version, `${plats.length} platforms (expect ${expectCount})`]);
  if (manifest.version !== version) bad.push(`manifest ${manifest.version} != release ${version}`);
  if (plats.length !== expectCount) bad.push(`manifest platform count ${plats.length} != ${expectCount}`);
  const unsigned = plats.filter(k => !manifest.platforms[k].signature);
  if (unsigned.length) bad.push(`manifest entries without signature: ${unsigned.join(', ')}`);
  const nonpublic = plats.filter(k => !String(manifest.platforms[k].url || '').startsWith('https://github.com/'));
  if (nonpublic.length) bad.push(`manifest URLs not public: ${nonpublic.join(', ')}`);
}

try {
  const dyn = await getJson(`${SITE}/desktop/update/latest.json`, 30000);
  rows.push(['site dynamic', dyn.version, `${Object.keys(dyn.platforms ?? {}).length} platforms`]);
  if (dyn.version !== version) bad.push(`site dynamic ${dyn.version} != ${version}`);
} catch (e) {
  bad.push(`site dynamic failed: ${e.message}`);
}

try {
  const fb = await getJson(`${SITE}/desktop/update/fallback.json`, 30000);
  const fbPlats = Object.keys(fb.platforms ?? {});
  rows.push(['site fallback', fb.version, `${fbPlats.length} platforms`]);
  if (fb.version !== version) warn.push(`static fallback is ${fb.version}, current release is ${version}`);
} catch (e) {
  bad.push(`site fallback failed: ${e.message}`);
}

for (const [label, path] of [['mirror desktop', 'desktop/latest/VERSION'], ['mirror android', 'android/latest/VERSION']]) {
  try {
    const v = await getText(`${MIRROR}/${path}`, 30000);
    rows.push([label, v, path]);
    if (v !== version) bad.push(`${label} is ${v}, expected ${version}`);
  } catch (e) {
    bad.push(`${label} failed: ${e.message}`);
  }
}

const width = Math.max(...rows.map(r => r[0].length), 10);
for (const [name, value, extra] of rows) console.log(`${name.padEnd(width)}  ${String(value).padEnd(10)} ${extra}`);
for (const w of warn) console.log(`WARN  ${w}`);
for (const b of bad) console.log(`DRIFT ${b}`);
if (bad.length) {
  console.log(`\nFAIL (${bad.length} drift)`);
  process.exit(1);
}
console.log('\nOK');
