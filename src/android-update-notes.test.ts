// 安卓更新页的「更新内容」从哪来(owner 2026-09-30 截图:v0.2.160 更新页只有一句「此版本包含功能改进和问题修复。」)。
// 安卓通道先于桌面镜像发布,desktop/<ver>/latest.json 那时还不存在 → 旧代码退回通用默认句。
// 规则:安卓通道 android/<ver>/notes.md → desktop/<ver>/latest.json → GitHub release 正文;
// desktop 通道先 latest.json 再 notes.md 再 GitHub。都没有 → notes 为空,更新页给「查看更新说明」链接,
// **永远不显示通用默认句**。
//
// URL 在这里写死、模型函数动态取:这个文件要能喂给修复前的代码,逐条看红。
import { createHash } from 'node:crypto';
import { __resetAndroidUpdaterForTest, checkAndroidUpdate } from './android-updater';
import { MIRROR_BASE, MIRROR_VERSION_URL, mirrorApkUrl, mirrorManifestUrl, mirrorSumsUrl } from './android-update-core';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) { p++; console.log(`PASS: ${name}`); } else console.log(`FAIL: ${name}`); };

const GENERIC = '此版本包含功能改进和问题修复。';
const ANDROID_VERSION = `${MIRROR_BASE}/android/latest/VERSION`;
const androidApk = (v: string) => `${MIRROR_BASE}/android/agent-network-${v}.apk`;
const androidSha = (v: string) => `${MIRROR_BASE}/android/agent-network-${v}.apk.sha256`;
const androidNotes = (v: string) => `${MIRROR_BASE}/android/${v}/notes.md`;
const ghTag = (v: string) => `https://api.github.com/repos/sleep2agi/agent-network-app/releases/tags/desktop-v${v}`;
const ghPage = (v: string) => `https://github.com/sleep2agi/agent-network-app/releases/tag/desktop-v${v}`;
const SHA = createHash('sha256').update('apk').digest('hex');
const body = (v: string, line: string) => `Signed and notarized stable update.\n\nWhat's new in ${v}:\n- ${line}\n\nWhat's new in 0.2.159:\n- 旧版本的说明\n`;

type Resp = { status: number; body?: string; json?: unknown; headers?: Record<string, string> };
function makeFetch(routes: Record<string, Resp>) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init?: any) => {
    const key = init?.method === 'HEAD' ? `HEAD ${url}` : url;
    calls.push(key);
    const r = routes[key] ?? { status: 404, body: '' };
    const headers = { get: (k: string) => r.headers?.[k.toLowerCase()] ?? null };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, headers, text: async () => r.body ?? JSON.stringify(r.json ?? ''), json: async () => r.json ?? JSON.parse(r.body ?? 'null') };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, gh: () => calls.filter(c => c.startsWith('https://api.github.com')).length };
}
/** 安卓通道 0.2.160,desktop 还在 0.2.159(截图当时的镜像)。 */
const androidAhead = (v = '0.2.160'): Record<string, Resp> => ({
  [MIRROR_VERSION_URL]: { status: 200, body: '0.2.159\n' },
  [ANDROID_VERSION]: { status: 200, body: `${v}\n` },
  [androidSha(v)]: { status: 200, body: `${SHA}  agent-network-${v}.apk\n` },
  [`HEAD ${androidApk(v)}`]: { status: 200, headers: { 'content-length': '1000' } },
});
const desktopAhead = (v = '0.2.160'): Record<string, Resp> => ({
  [MIRROR_VERSION_URL]: { status: 200, body: `${v}\n` },
  [ANDROID_VERSION]: { status: 200, body: '0.2.159\n' },
  [mirrorSumsUrl(v)]: { status: 200, body: `${SHA}  Agent.Network_${v}_android-universal.apk\n` },
  [`HEAD ${mirrorApkUrl(v)}`]: { status: 200, headers: { 'content-length': '1000' } },
});
const noSleep = { minVisibleMs: 0, sleep: async () => {} };
const check = async (routes: Record<string, Resp>) => {
  __resetAndroidUpdaterForTest(undefined);
  const f = makeFetch(routes);
  const s = await checkAndroidUpdate('0.2.159', { fetchImpl: f.fetchImpl, ...noSleep });
  return { s, f, notes: s.kind === 'available' ? s.notes : `<${s.kind}>` };
};

// 1. 安卓通道:android/<ver>/notes.md 优先
{
  const { s, notes, f } = await check({
    ...androidAhead(),
    [androidNotes('0.2.160')]: { status: 200, body: body('0.2.160', '日历里拖动任务改期限') },
    [mirrorManifestUrl('0.2.160')]: { status: 200, json: { version: '0.2.160', notes: body('0.2.160', '来自 latest.json') } },
  });
  ck('android channel: notes from android/<ver>/notes.md', s.kind === 'available' && notes.includes('日历里拖动任务改期限'));
  ck('android channel: notes.md wins over desktop latest.json', !notes.includes('来自 latest.json'));
  ck('android channel with notes.md: GitHub not asked', f.gh() === 0);
}
// 2. 安卓通道,notes.md 没有 → desktop/<ver>/latest.json
{
  const { notes, f } = await check({ ...androidAhead(), [mirrorManifestUrl('0.2.160')]: { status: 200, json: { version: '0.2.160', notes: body('0.2.160', '来自 latest.json') } } });
  ck('android channel, no notes.md → desktop latest.json', notes.includes('来自 latest.json'));
  ck('…GitHub still not asked', f.gh() === 0);
}
// 3. 两个镜像来源都没有 → GitHub release 正文(按 tag)
{
  const { notes } = await check({ ...androidAhead(), [ghTag('0.2.160')]: { status: 200, json: { tag_name: 'desktop-v0.2.160', body: body('0.2.160', '来自 GitHub 正文') } } });
  ck('android channel, no mirror notes → GitHub release body', notes.includes('来自 GitHub 正文'));
}
// 4. 截图现场:哪都没有 → 不是通用默认句;notes 为空,更新页给「查看更新说明」链接
{
  const { s, notes } = await check({ ...androidAhead(), [ghTag('0.2.160')]: { status: 404, json: { message: 'Not Found' } } });
  ck('no notes anywhere: still available (notes never block an update)', s.kind === 'available');
  ck('no notes anywhere: never the generic default sentence', !notes.includes(GENERIC));
  ck('no notes anywhere: notes are empty', notes === '');
  const model: any = await import('./update-prompt-model');
  const view = typeof model.androidNotesView === 'function'
    ? model.androidNotesView(notes, { currentVersion: '0.2.159', targetVersion: '0.2.160', releaseUrl: ghPage('0.2.160') })
    : undefined;
  ck('prompt: no groups → 「查看更新说明」 link to the GitHub release page',
    !!view && view.groups.length === 0 && view.link?.label === '查看更新说明' && view.link?.url === ghPage('0.2.160'));
  const withNotes = typeof model.androidNotesView === 'function'
    ? model.androidNotesView(body('0.2.160', '某条'), { currentVersion: '0.2.159', targetVersion: '0.2.160', releaseUrl: ghPage('0.2.160') })
    : undefined;
  ck('prompt: with notes → groups, no link', !!withNotes && withNotes.groups.length === 1 && !withNotes.link);
}
// 5. 镜像上的说明不是这一版的(latest.json 里只有旧版本段)→ 不用,继续往下找
{
  const { notes } = await check({
    ...androidAhead(),
    [mirrorManifestUrl('0.2.160')]: { status: 200, json: { version: '0.2.160', notes: "What's new in 0.2.159:\n- 旧版本的说明\n" } },
    [ghTag('0.2.160')]: { status: 200, json: { tag_name: 'desktop-v0.2.160', body: body('0.2.160', '来自 GitHub 正文') } },
  });
  ck('notes that lack this version\'s section are skipped', notes.includes('来自 GitHub 正文'));
}
// 6. desktop 通道:latest.json 优先;没有时用 android/<ver>/notes.md;都没有 → 空,不是默认句
{
  const a = await check({ ...desktopAhead(), [mirrorManifestUrl('0.2.160')]: { status: 200, json: { version: '0.2.160', notes: body('0.2.160', '来自 latest.json') } }, [androidNotes('0.2.160')]: { status: 200, body: body('0.2.160', '来自 notes.md') } });
  ck('desktop channel: latest.json first', a.notes.includes('来自 latest.json'));
  const b = await check({ ...desktopAhead(), [androidNotes('0.2.160')]: { status: 200, body: body('0.2.160', '来自 notes.md') } });
  ck('desktop channel, no latest.json → android notes.md', b.notes.includes('来自 notes.md'));
  const c = await check({ ...desktopAhead() });
  ck('desktop channel, nothing → empty notes, not the default sentence', c.s.kind === 'available' && c.notes === '');
}
// 7. GitHub 回答检查(镜像不可用)时正文为空 → 也不是默认句
{
  const { notes } = await check({
    [MIRROR_VERSION_URL]: { status: 503 },
    [ANDROID_VERSION]: { status: 503 },
    'https://api.github.com/repos/sleep2agi/agent-network-app/releases/latest': { status: 200, json: {
      tag_name: 'desktop-v0.2.160', body: '', html_url: ghPage('0.2.160'),
      assets: [{ name: 'Agent.Network_0.2.160_android-universal.apk', size: 1000, browser_download_url: 'https://x', digest: `sha256:${SHA}` }],
    } },
  });
  ck('GitHub-answered check with an empty body → empty notes, not the default sentence', notes === '');
}

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
