import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text } from './ui-text';
import type { HubConfig } from './api';
import { colors, radius, spacing } from './theme';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-session-control';
import { canBackgroundSession, runSessionControl, type SessionControlState, type SessionControlTarget } from './node-session-control';

// Parents key by Hub/token/network/node/session. Nothing from an old page can
// authorise an action after navigation or account changes.
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
      if (!unknown) setNotice(t(`sessionControl.error.${result.error}`));
      return;
    }
    setState(result.state); setReadAt(Date.now()); setNow(Date.now());
    if (!unknown) setNotice(result.outcome ? t(result.outcome === 'already_idle' ? 'sessionControl.alreadyIdle' : 'sessionControl.processed') : '');
  };
  const enabled = !busy && !unknown && canBackgroundSession(state, readAt, now);
  const button = (label: string, action: () => void, disabled: boolean, id: string) => (
    <Pressable testID={id} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled}
      onPress={action} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md,
        borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 })}>
      <Text style={{ color: disabled ? colors.textMuted : colors.accent, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
  return (
    <View testID="node-session-control" style={{ padding: spacing.md, gap: spacing.sm, backgroundColor: colors.card, borderRadius: radius.surface }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }}>
        <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }}>{t('sessionControl.title')}</Text>
        {state ? <Text testID="session-control-status" style={{ color: state.active ? colors.accent : colors.textMuted, fontSize: 13 }}>{t(state.active ? 'sessionControl.running' : 'sessionControl.idle')}</Text> : null}
        {busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
      </View>
      {busy ? <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{t(busy === 'background' ? 'sessionControl.requesting' : 'sessionControl.loading')}</Text> : null}
      {notice ? <Text testID="session-control-notice" accessibilityLiveRegion="polite" style={{ color: unknown ? colors.blocked : colors.textSecondary, fontSize: 12, lineHeight: 18 }}>{notice}</Text> : null}
      {state && !state.supported ? <Text testID="session-control-unsupported" style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>{t('sessionControl.error.unsupported')}</Text> : null}
      {!busy && state && now - readAt >= 30_000 ? <Text style={{ color: colors.textMuted, fontSize: 12 }}>{t('sessionControl.stale')}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {button(t(readAt ? 'sessionControl.refresh' : 'sessionControl.read'), () => void run(false), !!busy, 'session-control-refresh')}
        {button(t('sessionControl.background'), () => void run(true), !enabled, 'session-control-background')}
      </View>
      <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>{t(state ? 'sessionControl.hint' : 'sessionControl.initial')}</Text>
    </View>
  );
}
