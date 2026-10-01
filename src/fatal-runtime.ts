// 「上次异常退出」的真实接线:平台后端 + 全局处理器安装 + recordFatal(给 FatalBoundary 用)。
// index.ts 在 registerRootComponent 之前调 installFatalRuntime(),越早装,能记到的越多。
import { Dimensions, Platform } from 'react-native';
import { APP_VERSION } from './version';
import { buildFatalReport, installFatalRecorder, type ErrorUtilsLike, type FatalKind, type FatalMeta } from './fatal-report';
import { createFatalStore, type FatalBackend } from './fatal-store';
import { readRecipient, writeRecipient } from './diagnostics-recipient';

const FILE_NAME = 'last-fatal.json';
const WEB_KEY = 'anet.lastFatal.v1';

function nativeBackend(name: string): FatalBackend {
  // 同步 API(expo-file-system 新 File 类:write / textSync / delete 都是同步原生函数)。
  // 懒加载:web 包不碰它。字符串参数走 Either<String, TypedArray> 的 String 分支,安全。
  const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
  const file = () => new File(Paths.document, name);
  return {
    read: () => { const f = file(); return f.exists ? f.textSync() : null; },
    write: text => { file().write(text); },
    remove: () => { const f = file(); if (f.exists) f.delete(); },
  };
}

function webBackend(key: string): FatalBackend {
  const ls = (): Storage | undefined => { try { return (globalThis as any).localStorage; } catch { return undefined; } };
  return {
    read: () => ls()?.getItem(key) ?? null,
    write: text => { ls()?.setItem(key, text); },
    remove: () => { ls()?.removeItem(key); },
  };
}

const backend = (file: string, webKey: string): FatalBackend => (Platform.OS === 'web' ? webBackend(webKey) : nativeBackend(file));

export const fatalStore = createFatalStore(backend(FILE_NAME, WEB_KEY));

/** 「发送诊断」上次选的收件人(按账号,本机)。见 diagnostics-recipient.ts。 */
const recipientBackend = backend('diagnostics-recipient.json', 'anet.diagnosticsRecipient.v1');
type Scope = { profileId?: string; serverUrl?: string; username?: string };
export function loadDiagnosticsRecipient(cfg: Scope): string | null {
  try { return readRecipient(recipientBackend.read(), cfg); } catch { return null; }
}
export function saveDiagnosticsRecipient(cfg: Scope, alias: string): void {
  try { recipientBackend.write(writeRecipient(recipientBackend.read(), cfg, alias)); } catch { /* 只影响下次预选 */ }
}

function meta(): FatalMeta {
  let width = 0, height = 0;
  try { ({ width, height } = Dimensions.get('window')); } catch { /* 没有窗口尺寸也照记 */ }
  return { appVersion: APP_VERSION, platform: Platform.OS, osVersion: String(Platform.Version ?? ''), width, height };
}

export function recordFatal(error: unknown, kind: FatalKind, componentStack?: string | null): void {
  try { fatalStore.save(buildFatalReport(error, meta(), kind, componentStack)); } catch { /* 绝不因记录再抛 */ }
}

export function installFatalRuntime(): boolean {
  return installFatalRecorder((globalThis as any).ErrorUtils as ErrorUtilsLike | undefined, error => recordFatal(error, 'global'));
}
