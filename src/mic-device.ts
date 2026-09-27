// 桌面(Tauri webview)/ 网页的麦克风入口 —— 全 app **唯一**调用 getUserMedia 的地方
// (src/mic-device.test.ts 静态断言)。录音(useVoiceRecorder)、设置页的电平表和「允许访问麦克风」
// 都从这里开流,所以「设置里选的麦克风」对每条录音路径都生效,不会有一条漏掉。
//
//   openMicStream()        按设置里选的设备开流;那台设备没了(OverconstrainedError / NotFoundError)
//                          → 改用系统默认再开一次,并告诉调用方「回落了」。
//   requestMicPermission() 只为拿到设备名:开一次默认设备、立刻关掉。
//   listMediaDevices()     enumerateDevices() 原样交给 mic-device-model 去筛。
//   load/saveMicDeviceId() 选中的设备('' = 跟随系统默认)。只有 webview 用得到,存 localStorage ——
//                          与 voice-prefs.ts / agent-list-prefs.ts 在 web / Tauri 上同一套存法;
//                          deviceId 按来源稳定、只在本机有意义,本来也不该同步。
//
// 手机(安卓 / iOS)不走这里:原生 expo-audio 录音,没有设备选择。

import { SYSTEM_DEFAULT_MIC, isMissingDeviceError, micConstraints, type RawMediaDevice } from './mic-device-model';

const MIC_KEY = 'voice_mic_device_v1';

const webStorage = (): Storage | null => {
  try {
    const ls = (globalThis as any).localStorage as Storage | undefined;
    return ls && typeof ls.getItem === 'function' ? ls : null;
  } catch { return null; }
};

export function loadMicDeviceId(): string {
  try { return webStorage()?.getItem(MIC_KEY) ?? SYSTEM_DEFAULT_MIC; } catch { return SYSTEM_DEFAULT_MIC; }
}

export function saveMicDeviceId(id: string): void {
  try { webStorage()?.setItem(MIC_KEY, id); } catch { /* 存不下就只在本次有效 */ }
}

const mediaDevices = (): MediaDevices | null =>
  (globalThis as { navigator?: Navigator }).navigator?.mediaDevices ?? null;

export function micApiAvailable(): boolean {
  return !!mediaDevices()?.getUserMedia;
}

export type OpenedMic = { stream: MediaStream; /** 选的设备开不了,改用了系统默认。 */ fellBack: boolean };

/** @param deviceId 不传 = 用设置里存的;传 '' = 系统默认。 */
export async function openMicStream(deviceId?: string): Promise<OpenedMic> {
  const md = mediaDevices();
  if (!md?.getUserMedia) throw Object.assign(new Error('getUserMedia unavailable'), { name: 'NotSupportedError' });
  const want = deviceId ?? loadMicDeviceId();
  try {
    return { stream: await md.getUserMedia({ audio: micConstraints(want) }), fellBack: false };
  } catch (e) {
    if (!want || !isMissingDeviceError(e)) throw e;
    return { stream: await md.getUserMedia({ audio: micConstraints(SYSTEM_DEFAULT_MIC) }), fellBack: true };
  }
}

export function stopStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const t of stream.getTracks()) { try { t.stop(); } catch { /* already stopped */ } }
}

/** 弹系统授权(第一次)并立刻释放 —— 目的只是让 enumerateDevices() 之后带上设备名。 */
export async function requestMicPermission(): Promise<void> {
  const { stream } = await openMicStream(SYSTEM_DEFAULT_MIC);
  stopStream(stream);
}

export async function listMediaDevices(): Promise<RawMediaDevice[]> {
  const md = mediaDevices();
  if (!md?.enumerateDevices) return [];
  try { return await md.enumerateDevices(); } catch { return []; }
}

/** 插拔设备时回调。返回取消订阅。 */
export function onMediaDevicesChange(listener: () => void): () => void {
  const md = mediaDevices();
  if (!md?.addEventListener) return () => {};
  md.addEventListener('devicechange', listener);
  return () => md.removeEventListener('devicechange', listener);
}
