// 设置 → 语音输入 → 麦克风(桌面端;Vincent 09-27「Mac 客户端要能检测并选择输入设备」)。
//
//   下拉框:「跟随系统默认」+ enumerateDevices() 的音频输入。设备名在授权前是空的 → 显示
//           「允许访问麦克风」,点了弹一次系统授权、立刻关流、重新枚举。
//   电平表:AnalyserNode RMS,只在这一栏挂着且窗口可见时开流;离开设置页 / 窗口隐藏就释放
//           (macOS 菜单栏的橙色麦克风点随之消失)。
//   插拔:devicechange 刷新列表;选中的那台没了 → 改回默认、存盘、行内提示。
//
// 只在 web 平台渲染(Tauri 壳 = react-native-web),下拉框直接用 DOM <select>:macOS WKWebView /
// WebView2 各自画系统原生弹出菜单。手机不出现这一栏(settings-model 的 platforms: ['desktop'])。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { colors, onThemeChange, radius, spacing } from './theme';
import { uiScale } from './ui-scale';
import { MIC_REMOVED_NOTICE, micListView, rmsLevel, type RawMediaDevice } from './mic-device-model';
import { listMediaDevices, loadMicDeviceId, onMediaDevicesChange, openMicStream, requestMicPermission, saveMicDeviceId, stopStream } from './mic-device';

const METER_INTERVAL_MS = 80;

const pageVisible = (): boolean => {
  const d = (globalThis as { document?: Document }).document;
  return !d || d.visibilityState !== 'hidden';
};

/** 设置页可见期间的实时电平;deviceId 变了就换流。enabled=false 时不开流。 */
function useInputLevel(enabled: boolean, deviceId: string): number {
  const [level, setLevel] = useState(0);
  const [visible, setVisible] = useState(pageVisible());
  useEffect(() => {
    const d = (globalThis as { document?: Document }).document;
    if (!d) return;
    const on = () => setVisible(pageVisible());
    d.addEventListener('visibilitychange', on);
    return () => d.removeEventListener('visibilitychange', on);
  }, []);
  useEffect(() => {
    if (!enabled || !visible) { setLevel(0); return; }
    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    void (async () => {
      try {
        const opened = await openMicStream(deviceId);
        if (cancelled) { stopStream(opened.stream); return; }
        stream = opened.stream;
        const AC = (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
        if (!AC) return;
        ctx = new AC() as AudioContext;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        // 经 0 增益接到 destination(不回放):图里没有终点时,有的引擎不驱动分析节点。Chromium 不接也行,
        // WKWebView 上是否需要没有在真机上单独验过 —— 接上没有代价,所以保守接上。
        const mute = ctx.createGain();
        mute.gain.value = 0;
        ctx.createMediaStreamSource(stream).connect(analyser);
        analyser.connect(mute);
        mute.connect(ctx.destination);
        const buf = new Float32Array(analyser.fftSize);
        if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
        timer = setInterval(() => { analyser.getFloatTimeDomainData(buf); setLevel(rmsLevel(buf)); }, METER_INTERVAL_MS);
      } catch { if (!cancelled) setLevel(0); }
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      stopStream(stream);
      void ctx?.close().catch(() => {});
      setLevel(0);
    };
  }, [enabled, visible, deviceId]);
  return level;
}

export default function MicDeviceSetting() {
  const [devices, setDevices] = useState<RawMediaDevice[] | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);

  const refresh = useCallback(() => { void listMediaDevices().then(setDevices); }, []);
  useEffect(() => {
    setSaved(loadMicDeviceId());
    refresh();
    return onMediaDevicesChange(refresh);
  }, [refresh]);

  const view = useMemo(() => micListView(devices ?? [], saved), [devices, saved]);
  const ready = devices !== null && saved !== null;

  useEffect(() => {
    if (!ready || !view.selectedRemoved) return;
    setSaved('');
    saveMicDeviceId('');
    setNotice(MIC_REMOVED_NOTICE);
  }, [ready, view.selectedRemoved]);

  const level = useInputLevel(ready && !view.needsPermission, view.selected);

  const onPick = (id: string) => { setSaved(id); setNotice(null); saveMicDeviceId(id); };
  const onAllow = async () => {
    setAsking(true);
    setPermError(null);
    try {
      await requestMicPermission();
    } catch (e) {
      const name = (e as { name?: string })?.name;
      setPermError(name === 'NotAllowedError' || name === 'SecurityError' ? '麦克风权限被拒绝:请在系统设置的隐私 → 麦克风里允许本应用' : name === 'NotFoundError' ? '没有找到麦克风' : '麦克风无法启动');
    } finally {
      setAsking(false);
      refresh();
    }
  };

  const fontSize = 14 * uiScale().fontMultiplier;

  return (
    <View style={styles.block} testID="voice-mic">
      <Text style={styles.label}>麦克风</Text>
      <View style={styles.row} testID="voice-mic-row">
        <View style={styles.selectWrap}>
          <select
            data-testid="voice-mic-select"
            aria-label="麦克风"
            value={view.selected}
            disabled={!ready}
            onChange={e => onPick(e.target.value)}
            style={{
              width: '100%', height: 34, boxSizing: 'border-box', margin: 0, paddingLeft: spacing.md, paddingRight: spacing.md,
              borderWidth: 1, borderStyle: 'solid', borderColor: colors.border, borderRadius: radius.sm,
              backgroundColor: colors.inputBg, color: colors.text, fontSize, fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
            }}
          >
            {view.options.map(o => <option key={o.id || 'default'} value={o.id}>{o.label}</option>)}
          </select>
        </View>
        <View
          style={styles.meter}
          testID="voice-mic-meter"
          accessibilityRole="progressbar"
          accessibilityLabel="麦克风输入电平"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(level * 100)}
        >
          <View style={[styles.meterFill, { width: `${Math.round(level * 100)}%` }]} />
        </View>
      </View>
      {ready && view.needsPermission ? (
        <View style={styles.permRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="允许访问麦克风" disabled={asking} onPress={() => void onAllow()} style={({ pressed }) => [styles.secondary, asking && styles.disabled, pressed && { opacity: 0.7 }]} testID="voice-mic-allow">
            <Text style={styles.secondaryText}>{asking ? '等待授权…' : '允许访问麦克风'}</Text>
          </Pressable>
          <Text style={styles.hint}>授权后才能看到设备名称。</Text>
        </View>
      ) : null}
      {permError ? <Text style={[styles.hint, styles.error]} testID="voice-mic-error">{permError}</Text> : null}
      {notice ? <Text style={[styles.hint, styles.warn]} testID="voice-mic-notice">{notice}</Text> : null}
      <Text style={styles.hint}>语音输入和「测试语音识别」都用这里选的麦克风;选的设备拔掉时自动改用系统默认。</Text>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  block: { paddingVertical: spacing.sm, gap: 6 },
  label: { color: colors.text, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  selectWrap: { flex: 1, minWidth: 0 },
  meter: { width: 96, height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  meterFill: { height: '100%', backgroundColor: colors.accent },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  secondary: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.lg, height: 32, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: colors.text, fontSize: 13 },
  disabled: { opacity: 0.45 },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  error: { color: colors.failed },
  warn: { color: colors.accent },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
