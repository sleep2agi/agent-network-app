// 语音输入凭据的持久化 —— 只在本机,永不上传 hub。
//
//   安卓 / iOS:expo-secure-store(Android Keystore 加密 / iOS Keychain),与登录 token 同一套。
//   桌面(Tauri):Rust 侧 keyring(macOS 钥匙串 / Windows 凭据管理器),与登录 token 同一个
//                 service,只是 account 不同(src-tauri/src/lib.rs voice_credentials_entry)。
//   纯网页:没有安全存储(expo-secure-store 无 web 实现,网页版登录本来就走不通),
//           不支持语音输入 —— 不退回 localStorage 明文存密钥。
//
// 订阅:设置页保存/清除后,聊天页的麦克风立刻知道「配没配」(不用重进聊天)。

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { needsScrub, parseVoiceCredentials, type VoiceCredentials } from './voice-credentials-model';

const KEY = 'voice_asr_v1';

const isTauriDesktop = (): boolean =>
  typeof globalThis !== 'undefined' && !!(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

export type VoiceStorageKind = 'secure-store' | 'keychain' | 'unsupported';

export function voiceStorageKind(): VoiceStorageKind {
  if (isTauriDesktop()) return 'keychain';
  if (Platform.OS === 'android' || Platform.OS === 'ios') return 'secure-store';
  return 'unsupported';
}

let cache: VoiceCredentials | null | undefined;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

export function subscribeVoiceCredentials(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function loadVoiceCredentials(): Promise<VoiceCredentials | null> {
  if (cache !== undefined) return cache;
  let raw: string | null = null;
  try {
    const kind = voiceStorageKind();
    if (kind === 'keychain') {
      const { invoke } = await import('@tauri-apps/api/core');
      raw = await invoke<string | null>('load_voice_credentials');
    } else if (kind === 'secure-store') {
      raw = await SecureStore.getItemAsync(KEY);
    }
  } catch {
    raw = null; // 读失败 = 当作未配置;不把异常(可能含路径)透给界面
  }
  cache = parseVoiceCredentials(raw);
  // 0.2.112 存过 Secret Key(两个接口都用不到):静默重写一次,把它从安全存储里去掉。
  if (cache && needsScrub(raw)) void saveVoiceCredentials(cache).catch(() => { /* 下次再试 */ });
  return cache;
}

export async function saveVoiceCredentials(creds: VoiceCredentials): Promise<void> {
  const json = JSON.stringify(creds);
  const kind = voiceStorageKind();
  if (kind === 'keychain') {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('save_voice_credentials', { json });
  } else if (kind === 'secure-store') {
    await SecureStore.setItemAsync(KEY, json);
  } else {
    throw new Error('当前平台没有安全存储,不支持语音输入');
  }
  cache = creds;
  emit();
}

export async function clearVoiceCredentials(): Promise<void> {
  const kind = voiceStorageKind();
  if (kind === 'keychain') {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('clear_voice_credentials');
  } else if (kind === 'secure-store') {
    await SecureStore.deleteItemAsync(KEY);
  }
  cache = null;
  emit();
}

/** 测试用。 */
export function _resetVoiceCredentialsCache(): void { cache = undefined; }
