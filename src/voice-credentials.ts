// 语音输入凭据的持久化 —— 只在本机,永不上传 hub。
//
//   安卓 / iOS:expo-secure-store(Android Keystore 加密 / iOS Keychain),与登录 token 同一套。
//   桌面(Tauri):Rust 侧 keyring(macOS 钥匙串 / Windows 凭据管理器),与登录 token 同一个
//                 service,只是 account 不同(src-tauri/src/lib.rs voice_credentials_entry)。
//   纯网页:没有安全存储(expo-secure-store 无 web 实现,网页版登录本来就走不通),
//           不支持语音输入 —— 不退回 localStorage 明文存密钥。
//
// 订阅:设置页保存/清除后,聊天页的麦克风立刻知道「配没配」(不用重进聊天)——
// 包括桌面上设置在**另一个窗口**的情况(voice-credentials-store.ts:跨窗口广播 + 焦点兜底)。

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { needsScrub, type VoiceCredentials } from './voice-credentials-model';
import { createVoiceCredentialsStore, type VoiceCredentialsBus } from './voice-credentials-store';

const KEY = 'voice_asr_v1';

const isTauriDesktop = (): boolean =>
  typeof globalThis !== 'undefined' && !!(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

export type VoiceStorageKind = 'secure-store' | 'keychain' | 'unsupported';

export function voiceStorageKind(): VoiceStorageKind {
  if (isTauriDesktop()) return 'keychain';
  if (Platform.OS === 'android' || Platform.OS === 'ios') return 'secure-store';
  return 'unsupported';
}

// 跨窗口广播的事件名(桌面:设置是单独窗口,见 voice-credentials-store.ts 顶部)。
export const VOICE_CREDENTIALS_CHANGED_EVENT = 'anet-voice-credentials-changed';

const tauriBus: VoiceCredentialsBus = {
  async post(origin) {
    const { emit } = await import('@tauri-apps/api/event');
    await emit(VOICE_CREDENTIALS_CHANGED_EVENT, { origin });
  },
  async listen(handler) {
    const { listen } = await import('@tauri-apps/api/event');
    await listen<{ origin?: string }>(VOICE_CREDENTIALS_CHANGED_EVENT, e => handler(String(e.payload?.origin ?? '')));
  },
};

const windowFocus = (handler: () => void) => {
  const w = globalThis as { addEventListener?: (type: string, fn: () => void) => void };
  w.addEventListener?.('focus', handler);
};

const store = createVoiceCredentialsStore({
  async readRaw() {
    const kind = voiceStorageKind();
    if (kind === 'keychain') {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<string | null>('load_voice_credentials');
    }
    if (kind === 'secure-store') return SecureStore.getItemAsync(KEY);
    return null;
  },
  async writeRaw(json) {
    const kind = voiceStorageKind();
    if (kind === 'keychain') {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('save_voice_credentials', { json });
    } else if (kind === 'secure-store') {
      await SecureStore.setItemAsync(KEY, json);
    } else {
      throw new Error('当前平台没有安全存储,不支持语音输入');
    }
  },
  async deleteRaw() {
    const kind = voiceStorageKind();
    if (kind === 'keychain') {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('clear_voice_credentials');
    } else if (kind === 'secure-store') {
      await SecureStore.deleteItemAsync(KEY);
    }
  },
  // 0.2.112 存过 Secret Key(两个接口都用不到):静默重写一次,把它从安全存储里去掉。
  afterLoad(creds, raw) { if (creds && needsScrub(raw)) void saveVoiceCredentials(creds).catch(() => { /* 下次再试 */ }); },
  bus: isTauriDesktop() ? tauriBus : null,
  onFocus: isTauriDesktop() ? windowFocus : null,
});

/** 订阅「配没配」的变化 —— 本窗口保存 / 清除,以及**别的窗口**(桌面设置窗口)保存 / 清除。 */
export function subscribeVoiceCredentials(listener: () => void): () => void {
  return store.subscribe(listener);
}

export function loadVoiceCredentials(): Promise<VoiceCredentials | null> {
  return store.load();
}

export function saveVoiceCredentials(creds: VoiceCredentials): Promise<void> {
  return store.save(creds);
}

export function clearVoiceCredentials(): Promise<void> {
  return store.clear();
}

/** 测试用。 */
export function _resetVoiceCredentialsCache(): void { store.reset(); }
