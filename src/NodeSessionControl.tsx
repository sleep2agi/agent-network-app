import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text } from './ui-text';
import type { HubConfig } from './api';
import { colors, radius, spacing } from './theme';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-session-control';
import { pointerUi } from './pointer-ui';
import { canBackgroundSession, runSessionControl, type SessionControlState, type SessionControlTarget } from './node-session-control';

// Parents key by Hub/token/network/node/session. Nothing from an old page can
// authorise an action after navigation or account changes.
//
// 手机上的形态(2026-10-23 Vincent「这也太丑了」):一整块卡片占掉小半个屏、里面还有一条
// 永远禁用的按钮和两段解释文字,而且它的白底盖在消息上。现在只有**一行**:标题 · 状态 ·
// 两个小按钮;解释只有在真的出错/不支持时才出现一行。键盘提示(Ctrl+B)只在有指针的设备上给。
export default function NodeSessionControl({ cfg, target }: { cfg: HubConfig; target: SessionControlTarget }) {
  useTranslation();
  const [state, setState] = useState<SessionControlState | null>(null);
  const [readAt, setReadAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState<'state' | 'background' | null>(null);
  const [notice, setNotice] = useState('');
  const [unknown, setUnknown] = useState(false);
  const locked = useRef(false), live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const run = async (mutation: boolean) => {
    if (locked.current || (mutation && (unknown || !canBackgroundSession(state, readAt, Date.now())))) return;
    locked.current = true; setBusy(mutation ? 'background' : 'state');
    if (!unknown) setNotice('');
    if (!mutation) { setState(null); setReadAt(0); }
    const result = await runSessionControl(cfg, target, mutation ? state! : undefined, { cancelled: () => !live.current });
    locked.current = false;
    if (!live.current) return;
    setBusy(null);
    if (!result.ok) {
      setState(null); setReadAt(0);
      if (result.error === 'unknown') setUnknown(true);
      // 把「为什么读不出来」用短标签带出来（HTTP 404 / 超时 / 网络错误 / 响应不是预期格式），
      // 不含 URL、token 或响应正文 —— 这样用户/我们能立刻分辨「Hub 没上线接口」与「网络抖动」。
      if (!unknown) setNotice(result.detail ? `${t(`sessionControl.error.${result.error}`)}（${result.detail}）` : t(`sessionControl.error.${result.error}`));
      return;
    }
    setState(result.state); setReadAt(Date.now()); setNow(Date.now());
    if (!unknown) setNotice(result.outcome ? t(result.outcome === 'already_idle' ? 'sessionControl.alreadyIdle' : 'sessionControl.processed') : '');
  };
  const enabled = !busy && !unknown && canBackgroundSession(state, readAt, now);
  const action = (label: string, run_: () => void, disabled: boolean, id: string) => (
    <Pressable testID={id} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled}
      onPress={run_} hitSlop={6} style={({ pressed }) => ({ minHeight: 32, justifyContent: 'center', paddingHorizontal: spacing.sm,
        borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, opacity: disabled ? 0.45 : pressed ? 0.6 : 1 })}>
      <Text style={{ color: disabled ? colors.textMuted : colors.accent, fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
  // 一句解释足够：出错/不支持才占第二行。读出来之后不再复述怎么用。
  const line = notice
    ? notice
    : unknown
      ? t('sessionControl.error.unknown')
      : state && !state.supported
        ? t('sessionControl.error.unsupported')
        : '';
  return (
    <View testID="node-session-control" style={{ flexDirection: 'column', gap: 4, paddingHorizontal: spacing.lg, paddingVertical: 6,
      backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text numberOfLines={1} style={{ color: colors.textMuted, fontSize: 12, flexShrink: 1 }}>{t('sessionControl.title')}</Text>
        {state ? <Text testID="session-control-status" style={{ color: state.active ? colors.accent : colors.textMuted, fontSize: 12 }}>{t(state.active ? 'sessionControl.running' : 'sessionControl.idle')}</Text> : null}
        {busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
        <View style={{ flex: 1 }} />
        {action(t(readAt ? 'sessionControl.refresh' : 'sessionControl.read'), () => void run(false), !!busy, 'session-control-refresh')}
        {action(pointerUi() ? t('sessionControl.background') : t('sessionControl.backgroundTouch'), () => void run(true), !enabled, 'session-control-background')}
      </View>
      {line ? <Text testID="session-control-notice" accessibilityLiveRegion="polite" style={{ color: unknown ? colors.blocked : colors.textMuted, fontSize: 11, lineHeight: 15 }}>{line}</Text> : null}
    </View>
  );
}
