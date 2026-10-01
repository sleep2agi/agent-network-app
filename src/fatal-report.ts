// 「上次异常退出」诊断(owner 2026-10-01):JS 致命错误在 release 包里会直接杀掉进程(RCTFatal),
// 崩溃日志里只有原生栈、没有 JS 消息 —— build 28 iPad 那次闪退就是这样什么线索都没留下。
// 这里只负责「记成什么样」:序列化 / 截断 / 接在原全局处理器前面。读写盘在 fatal-store.ts,
// 界面在 FatalBoundary.tsx(渲染期错误)和 LastCrashChip.tsx(下次启动的小提示)。
//
// 原生崩溃(比如 0.2.178 的 manipulate SIGTRAP)根本到不了 JS,这里记不到 —— 那类靠 ios-crash-feedback。

export const FATAL_REPORT_VERSION = 1;
export const MAX_MESSAGE = 500;
export const MAX_STACK = 4000;
export const MAX_COMPONENT_STACK = 2000;

export type FatalKind = 'global' | 'boundary';

export interface FatalMeta {
  appVersion: string;
  platform: string;
  osVersion: string;
  width: number;
  height: number;
}

export interface FatalReport extends FatalMeta {
  v: number;
  kind: FatalKind;
  at: string;
  name: string;
  message: string;
  stack: string;
  componentStack?: string;
  /** 下次启动的小提示已经出现过(自动隐藏);设置 › 关于 里仍能复制,不再自动弹。 */
  shown?: boolean;
}

/** 超长截断,尾巴标出截掉了多少,读的人知道不是全文。 */
export function truncate(value: unknown, max: number): string {
  const s = typeof value === 'string' ? value : value == null ? '' : String(value);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…[+${s.length - max}]`;
}

/** 任何被 throw 的东西(Error / 字符串 / 对象 / undefined)都能变成一份报告,本身绝不抛。 */
export function buildFatalReport(error: unknown, meta: FatalMeta, kind: FatalKind, componentStack?: string | null, now: Date = new Date()): FatalReport {
  let name = 'Error';
  let message = '';
  let stack = '';
  try {
    if (error && typeof error === 'object') {
      const e = error as { name?: unknown; message?: unknown; stack?: unknown };
      name = typeof e.name === 'string' && e.name ? e.name : 'Error';
      message = typeof e.message === 'string' ? e.message : safeJson(error);
      stack = typeof e.stack === 'string' ? e.stack : '';
    } else {
      name = typeof error;
      message = String(error);
    }
  } catch {
    message = '<unreadable error>';
  }
  const report: FatalReport = {
    v: FATAL_REPORT_VERSION,
    kind,
    at: now.toISOString(),
    name: truncate(name, 100),
    message: truncate(message, MAX_MESSAGE),
    stack: truncate(stack, MAX_STACK),
    appVersion: meta.appVersion,
    platform: meta.platform,
    osVersion: meta.osVersion,
    width: Math.round(meta.width),
    height: Math.round(meta.height),
  };
  if (componentStack) report.componentStack = truncate(componentStack, MAX_COMPONENT_STACK);
  return report;
}

function safeJson(value: unknown): string {
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
}

export const serializeFatal = (report: FatalReport): string => JSON.stringify(report);

/** 盘上的内容不可信(旧版本 / 写一半 / 被改过):不是这个形状就当没有。 */
export function parseFatalReport(text: string | null | undefined): FatalReport | null {
  if (!text) return null;
  try {
    const r = JSON.parse(text);
    if (!r || typeof r !== 'object' || r.v !== FATAL_REPORT_VERSION) return null;
    if (typeof r.message !== 'string' || typeof r.at !== 'string' || (r.kind !== 'global' && r.kind !== 'boundary')) return null;
    return r as FatalReport;
  } catch {
    return null;
  }
}

/** 一行摘要:小提示和设置行用。 */
export const fatalSummary = (r: FatalReport, max = 80): string => truncate(`${r.name}: ${r.message}`.replace(/\s+/g, ' '), max);

/** 发给维护者 / 复制出去的正文:一行说明 + 完整 JSON(去掉本地的 shown 标记)。 */
export function fatalDiagnosticsText(r: FatalReport): string {
  const { shown: _shown, ...rest } = r;
  return `[diagnostics] last fatal JS error · v${r.appVersion} · ${r.platform} ${r.osVersion} · ${r.at}\n${JSON.stringify(rest, null, 2)}`;
}

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
export interface ErrorUtilsLike {
  getGlobalHandler(): GlobalHandler;
  setGlobalHandler(handler: GlobalHandler): void;
}

const INSTALLED = Symbol.for('anet.fatalRecorder');

/**
 * 接在原全局处理器前面:isFatal 时先同步落盘,再原样交给原处理器(release 包里仍然闪退,
 * 行为不变,只是多留一份记录)。记录本身任何一步出错都吞掉 —— 绝不能因为「记错误」再抛一个错误。
 * 重复安装是空操作(热重载 / 测试)。返回是否装上。
 */
export function installFatalRecorder(errorUtils: ErrorUtilsLike | undefined | null, record: (error: unknown) => void): boolean {
  if (!errorUtils || typeof errorUtils.getGlobalHandler !== 'function' || typeof errorUtils.setGlobalHandler !== 'function') return false;
  let previous: GlobalHandler | undefined;
  try { previous = errorUtils.getGlobalHandler(); } catch { previous = undefined; }
  if (previous && (previous as any)[INSTALLED]) return true;
  const handler: GlobalHandler = (error, isFatal) => {
    if (isFatal) {
      try { record(error); } catch { /* 记录失败不影响原处理器 */ }
    }
    if (previous) previous(error, isFatal);
  };
  (handler as any)[INSTALLED] = true;
  try {
    errorUtils.setGlobalHandler(handler);
  } catch {
    return false;
  }
  return true;
}
