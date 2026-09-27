// 设置 → 语音输入 → 麦克风(桌面端)的纯模型:设备列表怎么显示、要不要先授权、选中的设备被拔掉了
// 怎么办、录音时 getUserMedia 该带什么约束。运行时(真的枚举 / 开流)在 mic-device.ts。
//
// 🔴 选中值 '' = 「跟随系统默认」:录音不带 deviceId 约束,系统默认设备换了也跟着换。
// 纯逻辑,不 import react-native。

/** 「跟随系统默认」的选中值。存盘也是这个(空串),读不出来同样当默认。 */
export const SYSTEM_DEFAULT_MIC = '';
export const SYSTEM_DEFAULT_MIC_LABEL = '跟随系统默认';
export const MIC_REMOVED_NOTICE = '之前选的麦克风已断开,已改回跟随系统默认';

/** enumerateDevices() 的一项里我们用到的字段(MediaDeviceInfo 的子集,方便测试造数据)。 */
export type RawMediaDevice = { readonly deviceId: string; readonly kind: string; readonly label: string; readonly groupId?: string };

export type MicOption = { readonly id: string; readonly label: string };

export type MicListView = {
  /** 第一项永远是「跟随系统默认」。 */
  readonly options: readonly MicOption[];
  /** 设备名是空的(还没授权):显示「允许访问麦克风」按钮,先别判断选中项在不在。 */
  readonly needsPermission: boolean;
  /** 下拉框实际选中的值:选中的设备不在列表里时回落到默认。 */
  readonly selected: string;
  /** 之前选的设备这次不在了(已授权、列表可信时才判)。调用方据此改回默认并提示。 */
  readonly selectedRemoved: boolean;
};

// Chromium / WebView2 会额外给两个伪设备:'default'(= 系统默认)和 'communications'(Windows 通讯设备)。
// 第一项已经是「跟随系统默认」,再列一个「默认 - xxx」只会让人以为是两台设备。
const PSEUDO_IDS = new Set(['default', 'communications']);

export function audioInputs(devices: readonly RawMediaDevice[]): RawMediaDevice[] {
  return devices.filter(d => d.kind === 'audioinput' && !PSEUDO_IDS.has(d.deviceId));
}

/**
 * @param devices enumerateDevices() 的原始结果(含摄像头 / 扬声器,这里筛)
 * @param saved   本机存的选中值('' = 默认)
 */
export function micListView(devices: readonly RawMediaDevice[], saved: string | null | undefined): MicListView {
  const all = devices.filter(d => d.kind === 'audioinput');
  const inputs = audioInputs(devices);
  // 未授权时:Chromium 给 label '' 且 deviceId ''、WebKit 可能只给一项空 label;没有任何音频输入也
  // 可能是「还没授权所以不告诉你」—— 这三种都先让用户授权,授权后再枚举一次才可信。
  const needsPermission = all.length === 0 || all.some(d => !d.label);
  const options: MicOption[] = [{ id: SYSTEM_DEFAULT_MIC, label: SYSTEM_DEFAULT_MIC_LABEL }];
  if (!needsPermission) {
    const seen = new Set<string>();
    inputs.forEach((d, i) => {
      if (!d.deviceId || seen.has(d.deviceId)) return;
      seen.add(d.deviceId);
      options.push({ id: d.deviceId, label: d.label || `麦克风 ${i + 1}` });
    });
  }
  const want = saved ?? SYSTEM_DEFAULT_MIC;
  const present = want === SYSTEM_DEFAULT_MIC || options.some(o => o.id === want);
  const selectedRemoved = !needsPermission && !present;
  return { options, needsPermission, selected: present ? want : SYSTEM_DEFAULT_MIC, selectedRemoved };
}

/** 录音 / 电平表共用的音频约束。和 0.2.112 起的录音参数一致,选了设备就再加 deviceId exact。 */
export function micConstraints(deviceId: string | null | undefined): MediaTrackConstraints {
  const base: MediaTrackConstraints = { channelCount: 1, echoCancellation: true, noiseSuppression: true };
  return deviceId ? { ...base, deviceId: { exact: deviceId } } : base;
}

/** 带 deviceId 开流失败时,哪些错误说明「那台设备没了」→ 改用默认再试一次。权限拒绝不在内。 */
export function isMissingDeviceError(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name;
  return name === 'OverconstrainedError' || name === 'NotFoundError';
}

/** AnalyserNode 的时域数据(-1..1)→ 0..1 的电平。RMS 再开方,让说话声不至于只点亮一小截。 */
export function rmsLevel(samples: ArrayLike<number>): number {
  const n = samples.length;
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) { const v = samples[i]; sum += v * v; }
  const rms = Math.sqrt(sum / n);
  return Math.max(0, Math.min(1, Math.sqrt(rms) * 1.4));
}
