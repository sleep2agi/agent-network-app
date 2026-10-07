// 语音凭据的内存缓存 + 订阅 + 跨窗口同步(纯逻辑,依赖全部注入;voice-credentials.ts 接上真存储)。
//
// 🔴 为什么要跨窗口(0.2.219 真机截图):桌面版的「设置」是单独的 Tauri 窗口
// (desktop-settings-window.ts),每个窗口是独立的 JS 运行环境,各有一份缓存和订阅者。
// 在设置窗口保存 API Key,只有设置窗口自己知道;主窗口的聊天输入框还拿着启动时读到的
// 「没有凭据」,一直提示「未配置语音识别，去设置」,重启才好。清除时反过来:主窗口还在用已清掉的 Key。
//
// 做法:保存 / 清除之后发一条跨窗口广播(桌面 = Tauri 全局事件);每个窗口收到就丢掉缓存、
// 通知订阅者,订阅者重新 load() → 从钥匙串重读(钥匙串是唯一事实来源,广播不带凭据内容)。
// 兜底:窗口重新获得焦点时同样失效一次(广播丢了 / 监听还没挂上的窗口)。

import { parseVoiceCredentials, type VoiceCredentials } from './voice-credentials-model';

/** 跨窗口通道:post 发给所有窗口(可能包括自己),listen 收。origin 用来跳过自己发的那条。 */
export type VoiceCredentialsBus = {
  post(origin: string): void | Promise<void>;
  listen(handler: (origin: string) => void): void | Promise<void>;
};

export type VoiceCredentialsStoreDeps = {
  readRaw(): Promise<string | null>;
  writeRaw(json: string): Promise<void>;
  deleteRaw(): Promise<void>;
  /** 读完之后的钩子(比如静默重写旧存档);拿到的是解析后的值和原始串。 */
  afterLoad?(creds: VoiceCredentials | null, raw: string | null): void;
  bus?: VoiceCredentialsBus | null;
  /** 窗口重新获得焦点时回调(兜底)。 */
  onFocus?: ((handler: () => void) => void) | null;
};

export type VoiceCredentialsStore = {
  load(): Promise<VoiceCredentials | null>;
  save(creds: VoiceCredentials): Promise<void>;
  clear(): Promise<void>;
  subscribe(listener: () => void): () => void;
  /** 丢掉缓存并通知订阅者(收到别的窗口的广播 / 窗口重新获得焦点)。 */
  invalidate(): void;
  /** 测试用:只丢缓存,不通知。 */
  reset(): void;
};

let realmSeq = 0;

export function createVoiceCredentialsStore(deps: VoiceCredentialsStoreDeps): VoiceCredentialsStore {
  const origin = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${++realmSeq}`;
  let cache: VoiceCredentials | null | undefined;
  // 读的过程中缓存被失效了(别的窗口刚保存):这次读出来的值不能写回缓存。
  let generation = 0;
  const listeners = new Set<() => void>();
  const notify = () => { for (const l of [...listeners]) l(); };
  let wired = false;

  const invalidate = () => { cache = undefined; generation++; notify(); };

  // 跨窗口监听 / 焦点兜底:第一次有人订阅时才挂(不 import 就不挂,测试和纯网页都安全)。
  const wire = () => {
    if (wired) return;
    wired = true;
    try {
      void Promise.resolve(deps.bus?.listen(from => { if (from !== origin) invalidate(); })).catch(() => {});
    } catch { /* 没有跨窗口通道:只剩焦点兜底 */ }
    try { deps.onFocus?.(() => { if (listeners.size > 0) invalidate(); }); } catch { /* 无窗口 */ }
  };

  const broadcast = () => {
    try { void Promise.resolve(deps.bus?.post(origin)).catch(() => {}); } catch { /* 广播失败:靠焦点兜底 */ }
  };

  return {
    async load() {
      if (cache !== undefined) return cache;
      const gen = generation;
      let raw: string | null = null;
      try { raw = await deps.readRaw(); } catch { raw = null; } // 读失败 = 当作未配置;不把异常透给界面
      const creds = parseVoiceCredentials(raw);
      if (gen === generation) cache = creds;
      deps.afterLoad?.(creds, raw);
      return creds;
    },
    async save(creds) {
      await deps.writeRaw(JSON.stringify(creds));
      cache = creds;
      generation++;
      notify();
      broadcast();
    },
    async clear() {
      await deps.deleteRaw();
      cache = null;
      generation++;
      notify();
      broadcast();
    },
    subscribe(listener) {
      wire();
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    invalidate,
    reset() { cache = undefined; generation++; },
  };
}
