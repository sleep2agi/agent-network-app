// 设置里看节点的项目文件夹(只读)— run: bun src/node-files.test.ts
// @ts-expect-error app tsconfig 不带 node 类型(其余读源码的 ck 测试同样处理);运行时由 bun 提供。
import { readFileSync } from 'node:fs';
import { listNodeFiles, readNodeFile, type HubConfig } from './api';
import {
  FILES_MIN_AGENT_NODE, FILES_MIN_ANET_FOR_CLAUDE_CODE, FILES_MIN_HUB, SECRET_FILE_MESSAGE,
  childPath, entryAction, entryIcon, fileNotice, filesStatusMessage, filesSupport, filesTarget, filesUnsupportedMessage, formatSize,
  friendlyNodeError, isSafeEntryName, lineNumberGutter, normalizeRelPath, parentPath, parseFileContent, parseFilesListing, pathCrumbs,
  relativeTime, viewerModeFor,
} from './node-files';
import { visibleNodeSections } from './node-page-model';

let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) { pass++; console.log('✅', name); }
  else console.log('❌', name, extra);
};

// ── 能不能答:只认 files_capable;答不了当场说要升级什么(不发请求、不转 60 秒圈) ──
{
  ck('files_capable=true → capable', filesSupport({ alias: 'a', agent: 'agent-node:codex', version: '2.5.0-preview.88', files_capable: true } as any).kind === 'capable');
  const hub = filesSupport({ alias: 'a', agent: 'agent-node:codex', version: '2.5.0-preview.88' } as any);
  ck('/api/status 没有 files_capable 这个键 → 服务器太旧', hub.kind === 'unsupported' && hub.component === 'hub' && hub.minVersion === FILES_MIN_HUB, JSON.stringify(hub));
  const an = filesSupport({ alias: 'a', agent: 'agent-node:codex', version: '2.5.0-preview.80', files_capable: false } as any);
  ck('agent-node 旧 → 升级 agent-node', an.kind === 'unsupported' && an.component === 'agent-node' && an.kind === 'unsupported' && filesUnsupportedMessage(an).includes(FILES_MIN_AGENT_NODE) && filesUnsupportedMessage(an).includes('2.5.0-preview.80'), an.kind === 'unsupported' ? filesUnsupportedMessage(an) : '');
  const fresh = filesSupport({ alias: 'a', agent: 'agent-node:codex', version: FILES_MIN_AGENT_NODE, files_capable: false } as any);
  ck('agent-node 版本够但没上报 → 说重启,不说升级', fresh.kind === 'unsupported' && /重启/.test(filesUnsupportedMessage(fresh)) && !/升级到/.test(filesUnsupportedMessage(fresh)));
  const cc = filesSupport({ alias: 'a', agent: 'claude-code', version: '2.3.0-preview.100', files_capable: false } as any);
  ck('Claude Code 会话 → 升级 anet', cc.kind === 'unsupported' && cc.component === 'anet' && filesUnsupportedMessage(cc).includes(`anet ${FILES_MIN_ANET_FOR_CLAUDE_CODE}`));
  const other = filesSupport({ alias: 'a', agent: 'mystery', files_capable: false } as any);
  ck('其它进程 → 两个最低版本都说', other.kind === 'unsupported' && filesUnsupportedMessage(other).includes(FILES_MIN_AGENT_NODE) && filesUnsupportedMessage(other).includes(FILES_MIN_ANET_FOR_CLAUDE_CODE));
  ck('服务器太旧的文案点名 commhub-server', hub.kind === 'unsupported' && filesUnsupportedMessage(hub).includes(`commhub-server ${FILES_MIN_HUB}`));
}

// ── 请求目标 ──
ck('未 capable → 无目标', filesTarget({ node: { node_id: 'n1', alias: 'a' }, session: { alias: 'a' } }) === null);
ck('有 nodes 行 → node_id', filesTarget({ node: { node_id: 'n1', alias: 'a', runtime: 'codex' }, session: { alias: 'a', files_capable: true } })?.node_id === 'n1');
{
  const t = filesTarget({ node: null, session: { alias: 'demo-node', files_capable: true } });
  ck('没有 nodes 行 → 按 alias', !!t && t.alias === 'demo-node' && !t.node_id);
}

// ── 路径:只用节点回来的名字拼,拒绝 .. / 分隔符 ──
ck('合法名字', isSafeEntryName('README.md') && isSafeEntryName('.env') && isSafeEntryName('a b'));
ck('坏名字', !isSafeEntryName('..') && !isSafeEntryName('.') && !isSafeEntryName('a/b') && !isSafeEntryName('') && !isSafeEntryName('a\0b') && !isSafeEntryName(3));
ck('childPath', childPath('', 'src') === 'src' && childPath('src', 'lib') === 'src/lib' && childPath('src', '..') === null && childPath('src', 'a/b') === null);
ck('parentPath', parentPath('src/lib') === 'src' && parentPath('src') === '' && parentPath('') === '');
ck('normalizeRelPath 同 hub 规则', normalizeRelPath('./src//lib/') === 'src/lib' && normalizeRelPath('../x') === null && normalizeRelPath('/etc') === null && normalizeRelPath('~/x') === null && normalizeRelPath('a\\b') === null);
{
  const c = pathCrumbs('src/lib');
  ck('面包屑:项目 / src / lib', c.map(x => x.label).join('|') === '项目|src|lib' && c.map(x => x.path).join('|') === '|src|src/lib', JSON.stringify(c));
  ck('根目录面包屑只有「项目」', pathCrumbs('').length === 1);
}

// ── 列表载荷容错;凭据条目不带大小 ──
{
  const l = parseFilesListing(JSON.stringify({ path: 'src', total: 7, truncated: true, entries: [
    { name: 'lib', type: 'dir', mtime: 1 },
    { name: 'a.ts', type: 'file', size: 12, mtime: 2 },
    { name: '.env', type: 'file', size: 99, hidden_reason: 'secret' },
    { name: 'node_modules', type: 'dir', hidden_reason: 'skipped', no_descend: true },
    { name: 'out', type: 'symlink', link_type: 'bogus' },
    { name: '../evil', type: 'file' },
    { name: 'weird', type: 'socket' },
    null,
  ] }));
  ck('坏名字/空条目丢掉', !!l && l.entries.length === 6 && !l.entries.some(e => e.name === '../evil'), JSON.stringify(l));
  ck('凭据条目即使带了 size 也丢掉', l?.entries.find(e => e.name === '.env')?.size === undefined && l?.entries.find(e => e.name === '.env')?.hidden_reason === 'secret');
  ck('未知类型 → other;坏 link_type → null', l?.entries.find(e => e.name === 'weird')?.type === 'other' && l?.entries.find(e => e.name === 'out')?.link_type === null);
  ck('truncated / total 保留', l?.truncated === true && l.total === 7 && l.path === 'src');
  ck('非 JSON / 缺 entries → null', parseFilesListing('nope') === null && parseFilesListing('{}') === null && parseFilesListing(undefined) === null);
  ck('path 里的 .. 不被信任', parseFilesListing(JSON.stringify({ path: '../x', entries: [] }))?.path === '');
}
{
  const s = parseFileContent(JSON.stringify({ path: '.env', name: '.env', kind: 'secret', size: 30, content: 'API_KEY=x' }));
  ck('凭据文件:不留 size 也不留 content', s?.kind === 'secret' && s.size === undefined && s.content === undefined);
  const b = parseFileContent(JSON.stringify({ path: 'logo.bin', kind: 'binary', size: 2048, content: 'junk' }));
  ck('二进制:有 size 无 content', b?.kind === 'binary' && b.size === 2048 && b.content === undefined && b.name === 'logo.bin');
  const t = parseFileContent(JSON.stringify({ path: 'a.md', name: 'a.md', kind: 'text', size: 3, content: '# a' }));
  ck('文本', t?.kind === 'text' && t.content === '# a');
  ck('未知 kind 按二进制处理', parseFileContent(JSON.stringify({ path: 'x', kind: 'weird', content: 'y' }))?.kind === 'binary');
}

// ── 点一行会发生什么 ──
{
  const dir = 'src';
  ck('目录 → 进入', JSON.stringify(entryAction(dir, { name: 'lib', type: 'dir' })) === JSON.stringify({ kind: 'descend', path: 'src/lib' }));
  ck('文件 → 打开', entryAction(dir, { name: 'a.ts', type: 'file' }).kind === 'open');
  ck('凭据文件 → secret(不发请求)', entryAction(dir, { name: '.env', type: 'file', hidden_reason: 'secret' }).kind === 'secret');
  ck('凭据目录 → 不展开', entryAction('', { name: '.git', type: 'dir', hidden_reason: 'secret', no_descend: true }).kind === 'none');
  ck('node_modules → 不展开', entryAction('', { name: 'node_modules', type: 'dir', hidden_reason: 'skipped', no_descend: true }).kind === 'none');
  ck('指向目录的内部链接 → 进入', entryAction('', { name: 'docs-link', type: 'symlink', link_type: 'dir' }).kind === 'descend');
  ck('指向文件的内部链接 → 打开', entryAction('', { name: 'l', type: 'symlink', link_type: 'file' }).kind === 'open');
  const out = entryAction('', { name: 'link-out', type: 'symlink', link_type: null });
  ck('外部 / 失效链接 → 不跟随,有说明', out.kind === 'none' && /之外/.test(out.reason));
}

// ── 查看器 ──
ck('Markdown / 代码 / 纯文本', viewerModeFor('README.md') === 'markdown' && viewerModeFor('a.MDX') === 'markdown' && viewerModeFor('x.ts') === 'code' && viewerModeFor('Dockerfile') === 'code' && viewerModeFor('notes.txt') === 'plain' && viewerModeFor('LICENSE') === 'plain');
ck('图标', entryIcon({ name: 'a', type: 'dir' }) === 'folder-outline' && entryIcon({ name: '.env', type: 'file', hidden_reason: 'secret' }) === 'lock-closed-outline' && entryIcon({ name: 'x.ts', type: 'file' }) === 'code-slash-outline' && entryIcon({ name: 'l', type: 'symlink', link_type: null }) === 'link-outline');
ck('凭据文件的提示逐字', fileNotice({ path: '.env', name: '.env', kind: 'secret' }) === '凭据文件，不显示内容' && SECRET_FILE_MESSAGE === '凭据文件，不显示内容');
ck('超大 / 二进制提示带大小', /300 KB/.test(fileNotice({ path: 'b', name: 'b', kind: 'too_large', size: 300 * 1024 })) && /2 KB/.test(fileNotice({ path: 'b', name: 'b', kind: 'binary', size: 2048 })));
{
  const g = lineNumberGutter('a\nb\nc\n');
  ck('行号栏与行数一致(末尾换行不多算一行)', g.lines === 3 && g.gutter === '1\n2\n3', JSON.stringify(g));
  ck('单行 / 空文本', lineNumberGutter('x').gutter === '1' && lineNumberGutter('').lines === 1);
}
ck('大小', formatSize(0) === '0 B' && formatSize(1023) === '1023 B' && formatSize(1536) === '1.5 KB' && formatSize(300 * 1024) === '300 KB' && formatSize(5 * 1024 * 1024) === '5 MB' && formatSize(undefined) === '');
{
  const now = Date.UTC(2026, 8, 25, 12, 0, 0);
  ck('相对时间', relativeTime(now - 10_000, now) === '刚刚' && relativeTime(now - 5 * 60_000, now) === '5 分钟前' && relativeTime(now - 3 * 3_600_000, now) === '3 小时前' && relativeTime(now - 2 * 86_400_000, now) === '2 天前' && /^\d{4}-\d{2}-\d{2}$/.test(relativeTime(now - 90 * 86_400_000, now)) && relativeTime(undefined, now) === '');
}
ck('超时文案不说版本', /60 秒/.test(filesStatusMessage('timeout', null)) && !/版本/.test(filesStatusMessage('timeout', null)));
ck('节点错误翻成中文', /工作目录之外/.test(friendlyNodeError('refused: link-out resolves outside the work dir')) && /凭据目录/.test(friendlyNodeError('refused: .git is not browsable (secret)')) && /不存在/.test(friendlyNodeError('not found: x')));

// ── 分区:项目文件夹始终出现(没能力时区内说明升级) ──
ck('项目文件夹分区在只读页和详情页都出现', visibleNodeSections({ readOnly: true, hasRulesTarget: false, skillsCapable: false }).includes('files') && visibleNodeSections({ readOnly: false, hasRulesTarget: true, skillsCapable: true }).includes('files'));

// ── 真打 api:工具名、参数形状(只有目标 + network_id + 相对 path)、旧 hub/单飞映射 ──
const originalFetch = globalThis.fetch;
const calls: any[] = [];
let mode: 'ok' | 'unknown_tool' | 'in_flight' = 'ok';
globalThis.fetch = (async (input: any, init?: any) => {
  const body = init?.body ? JSON.parse(init.body) : undefined;
  calls.push({ url: String(input), body });
  const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
  if (mode === 'unknown_tool') return json({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: `Tool ${body.params.name} not found` } });
  const payload = mode === 'in_flight' ? { ok: false, error: 'request_in_flight', existing_request_id: 'r-prev' } : { ok: true, request_id: 'r1', op: body.params.name === 'read_node_file' ? 'file_read' : 'files_list' };
  return json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } });
}) as typeof fetch;
try {
  const cfg: HubConfig = { serverUrl: 'https://hub.example.test', token: 'utok_test', networkId: 'net_main', username: 'admin' } as HubConfig;
  const l = await listNodeFiles(cfg, { node_id: 'n1', alias: 'demo-node' }, 'src/lib');
  const lc = calls.at(-1)?.body?.params;
  ck('list 走 list_node_files', lc?.name === 'list_node_files' && l.ok === true && l.request_id === 'r1', JSON.stringify(lc));
  ck('list 参数 = node_id + network_id + path', JSON.stringify(Object.keys(lc?.arguments ?? {}).sort()) === JSON.stringify(['network_id', 'node_id', 'path']) && lc.arguments.path === 'src/lib', JSON.stringify(lc?.arguments));
  await readNodeFile(cfg, { alias: 'demo-node' }, 'README.md');
  const rc = calls.at(-1)?.body?.params;
  ck('read 走 read_node_file,按 alias,只带 path', rc?.name === 'read_node_file' && rc.arguments.path === 'README.md' && rc.arguments.alias === 'demo-node' && !('node_id' in rc.arguments) && !('content' in rc.arguments), JSON.stringify(rc));
  mode = 'unknown_tool';
  const u = await listNodeFiles(cfg, { node_id: 'n1', alias: 'a' }, '');
  ck('旧 hub(没有这个工具)→ unsupported,文案说项目文件夹', !u.ok && u.unsupported === true && /项目文件夹/.test(u.error) && !/规则文件|技能/.test(u.error), JSON.stringify(u));
  mode = 'in_flight';
  const f = await readNodeFile(cfg, { node_id: 'n1', alias: 'a' }, 'a.ts');
  ck('单飞被拒 → 带回 existing_request_id', !f.ok && f.existing_request_id === 'r-prev', JSON.stringify(f));
} finally {
  globalThis.fetch = originalFetch;
}

// ── 挂载契约 ──
{
  const comp = readFileSync(new URL('./NodeFilesSection.tsx', import.meta.url), 'utf8');
  ck('导出 NodeFilesSection(命名 + 默认)', /export function NodeFilesSection\(/.test(comp) && /export default NodeFilesSection;/.test(comp));
  ck('Markdown 复用 MarkdownMessage', /import MarkdownMessage from '\.\/MarkdownMessage'/.test(comp) && /<MarkdownMessage>\{file\.content\}<\/MarkdownMessage>/.test(comp));
  ck('能力不够时不发请求:先判 filesSupport 再建浏览器', /const support = filesSupport\(s\);[\s\S]{0,400}if \(support\.kind !== 'capable' \|\| !target\)[\s\S]{0,400}return <FilesBrowser/.test(comp));
  ck('凭据文件点开不发请求', /if \(secret\) \{ setFile\(\{ path, name, kind: 'secret' \}\);[^\n]*return; \}/.test(comp));
  const screen = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
  ck('节点页「项目文件夹」分区挂载', /section === 'files'[\s\S]{0,400}<NodeFilesSection cfg=\{cfg\} alias=\{alias\} node=\{rulesTarget\} session=\{s\}[^>]*\/>/.test(screen));
  ck('只挂载一次', (screen.match(/<NodeFilesSection /g) ?? []).length === 1);
}

console.log(`\n${pass}/${total} passed`);
if (pass !== total) process.exit(1);
