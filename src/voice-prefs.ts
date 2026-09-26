// 语音输入的非密钥偏好:识别模型(流式 / 极速版)、聊天输入区上次的输入方式(按住说话 / 键盘),
// 以及本次运行内「流式不可用」的记忆。
//
// 模式不是密钥,不进 SecureStore(那是给凭据的):native = documentDirectory 下一个小 JSON 文件,
// web / Tauri = localStorage(与 agent-list-prefs.ts 同一套做法)。读写都尽力而为,存不下就只在本次有效。
//
// 「流式不可用」**只在内存里**:进程重启、或用户保存了新凭据 / 重新选了「流式」,都会清掉重试 ——
// 用户去控制台开通之后不需要做任何额外操作。

import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { parseMode, type VoiceMode, type VoicePlatform } from './voice-stream-policy';
import { parseComposerInputMode, type ComposerInputMode } from './voice-input-model';
import type { StreamFailure } from './doubao-stream';

const MODE_KEY = 'voice_asr_mode_v1';
const COMPOSER_KEY = 'voice_composer_input_mode_v1';
const PREFS_FILE = () => `${FileSystem.documentDirectory}voice_prefs_v1.json`;

export function voicePlatform(): VoicePlatform {
  if ((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return 'desktop';
  if (Platform.OS === 'android' || Platform.OS === 'ios') return Platform.OS;
  return 'web';
}

const webStorage = (): Storage | null => {
  try {
    const ls = (globalThis as any).localStorage as Storage | undefined;
    return ls && typeof ls.getItem === 'function' ? ls : null;
  } catch { return null; }
};

let mode: VoiceMode | undefined;
let unavailable: { failure: StreamFailure; upstream?: string } | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

export function subscribeVoicePrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

type PrefsFile = { [MODE_KEY]?: string; [COMPOSER_KEY]?: string };

async function readNative(): Promise<PrefsFile> {
  try {
    if (!FileSystem.documentDirectory) return {};
    const info = await FileSystem.getInfoAsync(PREFS_FILE());
    if (!info.exists) return {};
    const v = JSON.parse(await FileSystem.readAsStringAsync(PREFS_FILE()));
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

// 两个键共用一个文件:写入串起来,避免「先存模式、紧接着存输入方式」的读改写互相覆盖。
let nativeWrite: Promise<unknown> = Promise.resolve();

async function readKey(key: keyof PrefsFile): Promise<string | null> {
  const ls = webStorage();
  if (ls) { try { return ls.getItem(key); } catch { return null; } }
  await nativeWrite;
  const v = (await readNative())[key];
  return typeof v === 'string' ? v : null;
}

function writeKey(key: keyof PrefsFile, value: string): Promise<void> {
  const ls = webStorage();
  if (ls) { try { ls.setItem(key, value); } catch { /* session only */ } return Promise.resolve(); }
  const next = nativeWrite.then(async () => {
    if (!FileSystem.documentDirectory) return;
    const prefs = await readNative();
    prefs[key] = value;
    await FileSystem.writeAsStringAsync(PREFS_FILE(), JSON.stringify(prefs));
  }).catch(() => { /* session only */ });
  nativeWrite = next;
  return next;
}

export async function loadVoiceMode(): Promise<VoiceMode> {
  if (mode) return mode;
  mode = parseMode(await readKey(MODE_KEY), voicePlatform());
  return mode;
}

/** 同步读(未加载完时 = 平台默认)。 */
export function currentVoiceMode(): VoiceMode {
  return mode ?? parseMode(null, voicePlatform());
}

export async function saveVoiceMode(next: VoiceMode): Promise<void> {
  mode = next;
  if (next === 'stream') unavailable = null; // 用户重新选流式 = 想再试一次
  emit();
  await writeKey(MODE_KEY, next);
}

/** 聊天输入区上次停在「按住说话」还是「键盘」(每台设备记一份,微信也是这样)。 */
export async function loadComposerInputMode(): Promise<ComposerInputMode> {
  return parseComposerInputMode(await readKey(COMPOSER_KEY));
}

export function saveComposerInputMode(next: ComposerInputMode): Promise<void> {
  return writeKey(COMPOSER_KEY, next);
}

export function streamUnavailable(): { failure: StreamFailure; upstream?: string } | null {
  return unavailable;
}

export function markStreamUnavailable(failure: StreamFailure, upstream?: string): void {
  unavailable = upstream ? { failure, upstream } : { failure };
  emit();
}

export function clearStreamUnavailable(): void {
  if (!unavailable) return;
  unavailable = null;
  emit();
}
