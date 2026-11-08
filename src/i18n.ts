/** UI copy only. Never pass message bodies, aliases or other user content to t(). */
export type LanguagePreference = 'system' | 'zh' | 'en';
export type Language = 'zh' | 'en';
export type TranslationTable = Record<string, readonly [string, string]>;
export const LANGUAGE_STORAGE_KEY = 'anet.language.v1';
const tables: TranslationTable = {
  'teams.title': ['Agent 组织', 'Agent teams'],
  'teams.loadFailed': ['无法读取团队，请重试', 'Could not load teams. Please retry.'],
  'teams.retry': ['重试', 'Retry'],
  'language.label': ['语言', 'Language'],
  'language.system': ['跟随系统', 'Follow system'],
  'nav.agents': ['Agent', 'Agents'],
  'nav.messages': ['消息', 'Messages'],
  'nav.unread': ['{label}，{count} 条未读', '{label}, {count} unread'],
  'nav.tasks': ['任务', 'Tasks'],
  'nav.tasksUpdated': ['{count} 个任务有新动态', '{count} tasks updated'],
  'nav.tasksUnread': ['{label}，{count} 个任务有新动态', '{label}, {count} tasks updated'],
  'nav.settings': ['设置', 'Settings'],
  'nav.server': ['Hub 设置', 'Hub settings'],
  'nav.scheduled': ['定时任务', 'Schedules'],
  'chat.empty': ['选择一个 agent 开始聊天', 'Select an agent to start chatting'],
  'chat.emptyHint': ['会话显示在右侧，列表始终保留', 'Chat opens on the right; your conversation list stays visible'],
  'chat.reportedModel': ['节点上报：{model}', 'Node-reported: {model}'],
  'chat.modelCatalogSeeBelow': ['模型目录见下方「节点模型」区（同一份受权读取，不重复查询）', 'Model catalog is in the node-model section below (same authorized read, no duplicate query)'],
  'chat.forkNoNodeId': ['会话没有 node_id：拒绝用 alias 或其它节点代替', 'Session has no node_id: refusing to substitute alias or another node'],
  'chat.forkNodeMissing': ['当前账号/network 内找不到该 node_id 的受权详情', 'No authorized node detail for this node_id in the current account/network'],
  'chat.forkNodeAmbiguous': ['该 node_id 在本 network 内有 {count} 条歧义记录，拒绝写入', 'node_id has {count} ambiguous rows in this network; refusing to write'],
  'chat.switchDisabled': ['切换未启用：{reason}', 'Switch disabled: {reason}'],
  'chat.switchLoading': ['切换未启用：正在读取该节点的受权详情…', 'Switch disabled: reading this node authorized detail…'],
  'chat.variantSuffix': [' · 档位 {value}', ' · variant {value}'],
  'chat.variantUnknownShort': ['未知', 'unknown'],
  'chat.variantDefaultShort': ['默认', 'default'],
  'chat.modelSheetOpen': ['查看当前模型与可用模型目录', 'Show current model and catalog'],
  'chat.modelUnknown': ['模型未知或已过期', 'Model unknown or stale'],
  'server.overview': ['概览', 'Overview'],
  'server.nodes': ['节点', 'Nodes'],
  'server.create': ['新建节点', 'Create node'],
  'server.logs': ['事件与日志', 'Events and logs'],
  'server.current': ['当前 Hub', 'Current Hub'],
  'server.connecting': ['正在连接', 'Connecting'],
  'server.connected': ['已连接', 'Connected'],
  'server.failed': ['连接失败', 'Connection failed'],
  'server.online': ['{online}/{total} 在线', '{online}/{total} online'],
  'server.management': ['Hub 管理', 'Hub management'],
  'server.hub': ['Hub', 'Hub'],
  'server.hub.skills': ['SKILLS', 'SKILLS'],
  'server.hub.tokens': ['令牌', 'Tokens'],
  'server.hub.env': ['环境变量', 'Environment'],
  'server.hub.providers': ['Provider', 'Provider'],
  'server.navLabel': ['Hub：{label}', 'Hub: {label}'],
  'server.network': ['网络', 'Network'],
  'server.integrations': ['Hub 域集成', 'Hub integrations'],
  'server.integrations.daemon': ['Daemon', 'Daemon'],
  'server.pendingTitle.skills': ['SKILLS', 'SKILLS'],
  'server.pendingTitle.tokens': ['令牌', 'Tokens'],
  'server.pendingTitle.provider': ['Provider', 'Provider'],
  'server.pendingTitle.runtime': ['Runtime 支持', 'Runtime support'],
};
export function registerTranslations(table: TranslationTable): void { Object.assign(tables, table); }
export function parseLanguagePreference(raw: unknown): LanguagePreference {
  return raw === 'zh' || raw === 'en' ? raw : 'system';
}
export function resolveLanguage(preference: LanguagePreference, locale: string): Language {
  return preference === 'system' ? (/^zh(?:[-_]|$)/i.test(locale) ? 'zh' : 'en') : preference;
}
function systemLocale(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().locale; } catch { return 'en'; }
}
let preference: LanguagePreference = 'system';
let locale = systemLocale();
let revision = 0;
let writer: ((value: string) => void) | undefined;
const listeners = new Set<() => void>();
try { preference = parseLanguagePreference(globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY)); } catch { /* Memory-only if storage is unavailable. */ }
export const languagePreference = () => preference;
export const currentLanguage = () => resolveLanguage(preference, locale);
export const languageSnapshot = () => `${preference}:${currentLanguage()}`;
export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function notify(): void { listeners.forEach(listener => listener()); }
export function refreshSystemLanguage(next = systemLocale()): void {
  const before = languageSnapshot();
  locale = next;
  if (before !== languageSnapshot()) notify();
}
export function setLanguagePreference(next: LanguagePreference): void {
  preference = parseLanguagePreference(next);
  revision++;
  try { globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, preference); } catch { /* Session preference still works. */ }
  writer?.(preference);
  notify();
}
/** A late native storage read must not replace a selection already made by the user. */
export async function hydrateLanguage(read: () => Promise<string | null>, write: (value: string) => void): Promise<void> {
  const atStart = revision;
  writer = write;
  let raw: string | null = null;
  try { raw = await read(); } catch { /* Follow system for missing/unreadable storage. */ }
  if (revision !== atStart) return;
  preference = parseLanguagePreference(raw);
  notify();
}
export function acceptLanguageStorage(raw: string | null): void {
  preference = parseLanguagePreference(raw);
  revision++;
  notify();
}
export function t(key: string, values: Record<string, string | number> = {}): string {
  const entry = tables[key];
  const text = entry ? entry[currentLanguage() === 'zh' ? 0 : 1] : key;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match);
}
