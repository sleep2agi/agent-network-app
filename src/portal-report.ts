// 日志 / SKILLS 上报到门户(agent.tianma.cn)。
//
// admin 2026-10-25:「日志上报及 SKILLS 上报功能，支持匿名上传和 PAT 上传」。
// 门户侧的 schema 由 TMA门户欧 给(任务 #2301)；这里把**与契约无关的部分**先定死:
//   · 两种鉴权:匿名(不带 Authorization) / PAT(Bearer);
//   · 请求体一律 { kind, client, batch_id, sent_at, items };
//   · 体积上限与条数上限在这里截断,不把整份日志塞进一次请求;
//   · **不报** token、消息正文、私钥、文件内容 —— redactDiagnostics/redactSkill 只放白名单字段。
import { APP_VERSION } from './version';

export const PORTAL_BASE = 'https://agent.tianma.cn';
export const REPORT_LOG_PATH = '/api/report/logs';
export const REPORT_SKILLS_PATH = '/api/report/skills';

/** 单次请求的硬上限(门户可再收紧;这里先自我约束,避免一次几 MB)。 */
export const MAX_ITEMS_PER_BATCH = 200;
export const MAX_BODY_BYTES = 256 * 1024;

export type ReportAuth = { mode: 'anonymous' } | { mode: 'pat'; token: string };
export type ReportKind = 'logs' | 'skills';

export interface LogItem {
  at: string;
  level: 'info' | 'warn' | 'error';
  module: string;
  message: string;
}

export interface SkillItem {
  name: string;
  source: string;
  enabled: boolean;
  version?: string;
}

export interface ReportClient {
  app: 'anet-client';
  version: string;
  platform: string;
  locale: string;
}

/** 白名单:只留这几个字段,别的全丢。 */
export const redactLog = (raw: Partial<LogItem> & { message?: string }): LogItem => ({
  at: typeof raw.at === 'string' ? raw.at : new Date().toISOString(),
  level: raw.level === 'error' || raw.level === 'warn' ? raw.level : 'info',
  module: String(raw.module ?? 'app').slice(0, 40),
  // 消息里出现的 token/密钥形态统一替换,避免日志本身泄密。
  message: String(raw.message ?? '')
    .replace(/\b(ntok|pat|sk|ghp)_[A-Za-z0-9_\-]{8,}/g, '<redacted>')
    .replace(/Bearer\s+[A-Za-z0-9._\-]{8,}/gi, 'Bearer <redacted>')
    .slice(0, 500),
});

export const redactSkill = (raw: Partial<SkillItem>): SkillItem => ({
  name: String(raw.name ?? '').slice(0, 80),
  source: String(raw.source ?? 'unknown').slice(0, 40),
  enabled: raw.enabled === true,
  ...(raw.version ? { version: String(raw.version).slice(0, 32) } : {}),
});

export const batchId = (now: number, rand: () => number = Math.random): string =>
  `b${now.toString(36)}${Math.floor(rand() * 1e6).toString(36)}`;

/** 截断到条数与体积上限;返回被丢掉多少条,便于界面如实显示。 */
export function capItems<T>(items: readonly T[], maxItems = MAX_ITEMS_PER_BATCH): { items: T[]; dropped: number } {
  if (items.length <= maxItems) return { items: [...items], dropped: 0 };
  return { items: items.slice(0, maxItems), dropped: items.length - maxItems };
}

export function buildBody(kind: ReportKind, client: ReportClient, items: readonly unknown[], now = Date.now()) {
  const capped = capItems(items);
  const body = { kind, client, batch_id: batchId(now), sent_at: new Date(now).toISOString(), items: capped.items, dropped: capped.dropped };
  const size = new TextEncoder().encode(JSON.stringify(body)).length;
  return { body, bytes: size, tooBig: size > MAX_BODY_BYTES, dropped: capped.dropped };
}

export const reportPath = (kind: ReportKind): string => (kind === 'logs' ? REPORT_LOG_PATH : REPORT_SKILLS_PATH);

/** 匿名 = 不带 Authorization;PAT = Bearer。无效 PAT 由门户回 401/403,这里只负责如实转成文案。 */
export function headersFor(auth: ReportAuth): Record<string, string> {
  const base: Record<string, string> = { 'content-type': 'application/json' };
  if (auth.mode === 'pat' && auth.token.trim()) base.authorization = `Bearer ${auth.token.trim()}`;
  return base;
}

export const clientInfo = (platform: string, locale: string): ReportClient => ({
  app: 'anet-client',
  version: APP_VERSION,
  platform,
  locale,
});

export function describeFailure(status: number, error?: string): string {
  if (status === 401 || status === 403) return 'portalReport.badPat';
  if (status === 413) return 'portalReport.tooBig';
  if (status === 429) return 'portalReport.rateLimited';
  if (status >= 500) return 'portalReport.server';
  return error ? 'portalReport.failed' : 'portalReport.failed';
}
