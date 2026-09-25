// 节点「项目文件夹」区块的纯逻辑(只读)。
//
// 节点按自己的工作目录列目录 / 读文件(主仓 agent-node/src/runtime/node-files.ts,claude-code
// 会话的通道进程用同一份逐字节复制),经 rules-file 同一条门铃回来:
//   list_node_files → get_rules_file_result.content = JSON {path, entries:[…], truncated, total}
//   read_node_file  → content = JSON {path, name, kind: text|binary|too_large|secret, size?, mtime?, content?}
// 🔴 桌面端只传**相对工作目录**的路径;安全边界(拒绝 ..、realpath 收口、凭据不回内容)在 hub
//    和节点两侧,这里的路径拼接只用列表里节点回来的名字,且同样拒绝 `..` / `/`。
// 纯逻辑,不 import react-native。

import type { RulesTarget, Session } from './api';
import { compareNodeVersion, isAgentNodeSession } from './node-rules';

export type NodeFileType = 'dir' | 'file' | 'symlink' | 'other';
export type HiddenReason = 'secret' | 'skipped';

export interface NodeFileEntry {
  name: string;
  type: NodeFileType;
  size?: number;
  mtime?: number;
  hidden_reason?: HiddenReason;
  no_descend?: boolean;
  link_type?: 'dir' | 'file' | null;
}

export interface NodeFilesListing {
  path: string;
  entries: NodeFileEntry[];
  truncated: boolean;
  total: number;
}

export type NodeFileKind = 'text' | 'binary' | 'too_large' | 'secret';

export interface NodeFileContent {
  path: string;
  name: string;
  kind: NodeFileKind;
  size?: number;
  mtime?: number;
  content?: string;
}

/** 这一版起节点会答 files_list / file_read(主仓 feat/node-project-folder 之后的第一个 preview)。 */
export const FILES_MIN_AGENT_NODE = '2.5.0-preview.88';
export const FILES_MIN_ANET_FOR_CLAUDE_CODE = '2.3.0-preview.115';
export const FILES_MIN_HUB = '0.9.0-preview.59';

export const SECRET_FILE_MESSAGE = '凭据文件，不显示内容';

/**
 * 发请求**之前**判断节点能不能答 —— 答不了就当场说清楚要升级什么,不转 60 秒圈(同 app#347)。
 * 没有「猜它会答」的兜底:这项能力和 files_capable 同一版上线,没上报就是答不了。
 *  - capable:   会话上报了 files_capable。
 *  - hub:       /api/status 里压根没有 files_capable 这个键 ⇒ 服务器还是旧版。
 *  - agent-node / anet:节点或 Claude Code 通道太旧。
 *  - node:      其它类型的会话(不知道是什么进程)。
 */
export type FilesSupport =
  | { kind: 'capable' }
  | { kind: 'unsupported'; component: 'hub' | 'agent-node' | 'anet' | 'node'; version: string | null; minVersion: string | null };

export function filesSupport(session: (Pick<Session, 'agent' | 'version'> & { files_capable?: boolean }) | null | undefined): FilesSupport {
  if (session?.files_capable === true) return { kind: 'capable' };
  const version = session?.version ?? null;
  if (!session || !('files_capable' in session)) return { kind: 'unsupported', component: 'hub', version: null, minVersion: FILES_MIN_HUB };
  if (isAgentNodeSession(session)) return { kind: 'unsupported', component: 'agent-node', version, minVersion: FILES_MIN_AGENT_NODE };
  if (typeof session.agent === 'string' && session.agent.toLowerCase() === 'claude-code') {
    return { kind: 'unsupported', component: 'anet', version, minVersion: FILES_MIN_ANET_FOR_CLAUDE_CODE };
  }
  return { kind: 'unsupported', component: 'node', version, minVersion: null };
}

export function filesUnsupportedMessage(s: Extract<FilesSupport, { kind: 'unsupported' }>): string {
  const ver = s.version ? `（v${s.version}）` : '';
  switch (s.component) {
    case 'hub':
      return `服务器版本还不支持查看项目文件夹，升级到 commhub-server ${s.minVersion} 或更新后可用`;
    case 'agent-node': {
      // 版本认得出且已经不旧:那是还没重连上报(或 hub 没收到),不是版本问题。
      const c = compareNodeVersion(s.version, s.minVersion ?? '');
      if (c !== null && c >= 0) return `这个节点${ver}还没有上报项目文件夹能力，重启节点后可用`;
      return `这个节点的 agent-node 版本${ver}还不支持查看项目文件夹，升级到 ${s.minVersion} 或更新后可用`;
    }
    case 'anet':
      return `这个 Claude Code 会话的 anet 版本${ver}还不支持查看项目文件夹，升级到 anet ${s.minVersion} 或更新并重启会话后可用`;
    case 'node':
      return `这个节点还不支持查看项目文件夹（agent-node 需要 ${FILES_MIN_AGENT_NODE} 或更新，Claude Code 会话需要 anet ${FILES_MIN_ANET_FOR_CLAUDE_CODE} 或更新）`;
  }
}

/** 请求发给谁:有 nodes 行按 node_id,没有(claude-code 会话)按 alias。只在 capable 时有目标。 */
export function filesTarget(args: {
  node: Pick<RulesTarget, 'node_id' | 'alias' | 'runtime'> | null | undefined;
  session: (Pick<Session, 'alias'> & { files_capable?: boolean }) | null | undefined;
}): RulesTarget | null {
  const { node, session } = args;
  if (session?.files_capable !== true) return null;
  if (node?.node_id) return { node_id: node.node_id, alias: node.alias, runtime: node.runtime ?? null };
  return session.alias ? { alias: session.alias } : null;
}

/** 节点回来的名字:一段、非空、不是 . / ..、不含 / 和 NUL。不合格的条目整条丢掉。 */
export function isSafeEntryName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name.length <= 255 && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\0');
}

/** 规范化相对路径(与 hub / 节点同规则);不合法返回 null。 */
export function normalizeRelPath(p: string): string | null {
  if (p.includes('\0') || p.includes('\\') || p.startsWith('/') || p.startsWith('~') || /^[A-Za-z]:/.test(p)) return null;
  const segs = p.split('/').filter(s => s !== '' && s !== '.');
  if (segs.some(s => s === '..')) return null;
  return segs.join('/');
}

export function childPath(dir: string, name: string): string | null {
  if (!isSafeEntryName(name)) return null;
  return dir ? `${dir}/${name}` : name;
}

export function parentPath(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

export interface Crumb { label: string; path: string }

/** 面包屑:第一段是「项目」(工作目录根),之后每段一个。 */
export function pathCrumbs(p: string): Crumb[] {
  const out: Crumb[] = [{ label: '项目', path: '' }];
  let acc = '';
  for (const seg of p.split('/').filter(Boolean)) {
    acc = acc ? `${acc}/${seg}` : seg;
    out.push({ label: seg, path: acc });
  }
  return out;
}

const TYPES: readonly NodeFileType[] = ['dir', 'file', 'symlink', 'other'];
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);

/** 容错解析列表;坏条目丢掉,不抛。 */
export function parseFilesListing(content: string | undefined | null): NodeFilesListing | null {
  if (!content) return null;
  let d: any;
  try { d = JSON.parse(content); } catch { return null; }
  if (!d || typeof d !== 'object' || !Array.isArray(d.entries)) return null;
  const entries: NodeFileEntry[] = [];
  for (const e of d.entries) {
    if (!e || !isSafeEntryName(e.name)) continue;
    const type: NodeFileType = TYPES.includes(e.type) ? e.type : 'other';
    const hidden = e.hidden_reason === 'secret' || e.hidden_reason === 'skipped' ? e.hidden_reason as HiddenReason : undefined;
    entries.push({
      name: e.name,
      type,
      ...(hidden ? {} : num(e.size) !== undefined ? { size: num(e.size) } : {}),
      ...(num(e.mtime) !== undefined ? { mtime: num(e.mtime) } : {}),
      ...(hidden ? { hidden_reason: hidden } : {}),
      ...(e.no_descend === true || hidden ? { no_descend: true } : {}),
      ...(type === 'symlink' ? { link_type: e.link_type === 'dir' || e.link_type === 'file' ? e.link_type : null } : {}),
    });
  }
  const path = typeof d.path === 'string' ? normalizeRelPath(d.path) ?? '' : '';
  const total = num(d.total) ?? entries.length;
  return { path, entries, truncated: d.truncated === true, total: Math.max(total, entries.length) };
}

export function parseFileContent(content: string | undefined | null): NodeFileContent | null {
  if (!content) return null;
  let d: any;
  try { d = JSON.parse(content); } catch { return null; }
  if (!d || typeof d !== 'object' || typeof d.path !== 'string') return null;
  const kind: NodeFileKind = d.kind === 'text' || d.kind === 'binary' || d.kind === 'too_large' || d.kind === 'secret' ? d.kind : 'binary';
  const name = typeof d.name === 'string' && d.name ? d.name : d.path.split('/').pop() || d.path;
  return {
    path: d.path,
    name,
    kind,
    ...(kind !== 'secret' && num(d.size) !== undefined ? { size: num(d.size) } : {}),
    ...(num(d.mtime) !== undefined ? { mtime: num(d.mtime) } : {}),
    ...(kind === 'text' && typeof d.content === 'string' ? { content: d.content } : {}),
  };
}

/** 点一行会发生什么。凭据文件不发请求,直接显示提示。 */
export type EntryAction =
  | { kind: 'descend'; path: string }
  | { kind: 'open'; path: string }
  | { kind: 'secret'; path: string }
  | { kind: 'none'; reason: string };

export function entryAction(dir: string, e: NodeFileEntry): EntryAction {
  const p = childPath(dir, e.name);
  if (!p) return { kind: 'none', reason: '名字不合法' };
  const isDirLike = e.type === 'dir' || (e.type === 'symlink' && e.link_type === 'dir');
  if (e.hidden_reason === 'secret') return isDirLike ? { kind: 'none', reason: '凭据目录，不展开' } : { kind: 'secret', path: p };
  if (e.hidden_reason === 'skipped' || (isDirLike && e.no_descend)) return { kind: 'none', reason: '依赖目录，不展开' };
  if (isDirLike) return { kind: 'descend', path: p };
  if (e.type === 'symlink' && e.link_type !== 'file') return { kind: 'none', reason: '链接指向工作目录之外或已失效' };
  if (e.type === 'other') return { kind: 'none', reason: '不是普通文件' };
  return { kind: 'open', path: p };
}

export type ViewerMode = 'markdown' | 'code' | 'plain';

const CODE_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'json', 'jsonc', 'json5', 'py', 'rs', 'go', 'java', 'kt', 'kts', 'swift',
  'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'rb', 'php', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf',
  'css', 'scss', 'less', 'html', 'htm', 'xml', 'svg', 'sql', 'lua', 'dart', 'vue', 'svelte', 'gradle', 'proto', 'graphql', 'r', 'scala',
]);
const CODE_NAMES = new Set(['dockerfile', 'makefile', 'justfile', 'gemfile', 'rakefile', 'procfile', '.gitignore', '.dockerignore', '.editorconfig', '.prettierrc', '.eslintrc']);
const MARKDOWN_EXT = new Set(['md', 'markdown', 'mdx', 'mdc']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'icns', 'tiff']);

const ext = (name: string): string => {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
};

export function viewerModeFor(name: string): ViewerMode {
  const e = ext(name);
  if (MARKDOWN_EXT.has(e)) return 'markdown';
  if (CODE_EXT.has(e) || CODE_NAMES.has(name.toLowerCase())) return 'code';
  return 'plain';
}

/** Ionicons 名。 */
export function entryIcon(e: NodeFileEntry): string {
  if (e.hidden_reason === 'secret') return 'lock-closed-outline';
  if (e.type === 'dir') return 'folder-outline';
  if (e.type === 'symlink') return e.link_type === 'dir' ? 'folder-open-outline' : 'link-outline';
  const m = viewerModeFor(e.name);
  if (m === 'markdown') return 'document-text-outline';
  if (m === 'code') return 'code-slash-outline';
  if (IMAGE_EXT.has(ext(e.name))) return 'image-outline';
  return 'document-outline';
}

/** 1023 B / 1.5 KB / 12 MB。 */
export function formatSize(bytes: number | undefined | null): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v)} ${units[u]}`;
}

/** 刚刚 / 5 分钟前 / 3 小时前 / 2 天前 / 超过 30 天给日期。未来时间(时钟偏差)按「刚刚」。 */
export function relativeTime(ms: number | undefined | null, nowMs: number = Date.now()): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '';
  const d = nowMs - ms;
  if (d < 60_000) return '刚刚';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`;
  if (d < 30 * 86_400_000) return `${Math.floor(d / 86_400_000)} 天前`;
  const t = new Date(ms);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}`;
}

/** 代码视图的行号栏:与正文逐行对齐(同字号同行高、正文不折行)。 */
export function lineNumberGutter(text: string): { gutter: string; lines: number } {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  const lines = body === '' ? 1 : body.split('\n').length;
  let g = '';
  for (let i = 1; i <= lines; i++) g += i === lines ? String(i) : `${i}\n`;
  return { gutter: g, lines };
}

/** 读文件结果 → 查看器里显示什么。 */
export function fileNotice(f: NodeFileContent): string {
  switch (f.kind) {
    case 'secret': return SECRET_FILE_MESSAGE;
    case 'too_large': return `文件太大（${formatSize(f.size)}），超过 256 KB，不在这里显示`;
    case 'binary': return `二进制文件（${formatSize(f.size)}），不显示内容`;
    case 'text': return f.content === '' ? '空文件' : '';
  }
}

export function filesStatusMessage(status: 'pending' | 'in_progress' | 'done' | 'failed' | 'timeout', error: string | null): string {
  switch (status) {
    case 'pending':
    case 'in_progress':
      return '正在向节点读取…';
    case 'done':
      return '';
    case 'failed':
      return `节点读取失败:${friendlyNodeError(error)}`;
    case 'timeout':
      // 只对上报了 files_capable 的会话发请求,所以超时不是版本问题。
      return '节点 60 秒内没有取走这次请求:多半是节点和服务器之间的实时连接断了,或节点卡住了;重启这个节点通常能恢复';
  }
}

/** 节点回来的英文错误 → 一句中文;认不出原样返回。 */
export function friendlyNodeError(error: string | null): string {
  const e = error ?? '';
  if (/outside the work dir/.test(e)) return '这个路径指向工作目录之外，已拒绝';
  if (/not browsable \(secret\)/.test(e)) return '凭据目录，不展开';
  if (/not browsable/.test(e)) return '依赖目录，不展开';
  if (/^not found/.test(e)) return '文件或目录不存在（可能刚被删掉）';
  if (/invalid path/.test(e)) return '路径不合法';
  if (/not a directory/.test(e)) return '不是目录';
  if (/not a regular file/.test(e)) return '不是普通文件';
  return e || '未说明原因';
}
