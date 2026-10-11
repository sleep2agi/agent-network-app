import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import type { HubConfig } from './api';
import { Text, TextInput } from './ui-text';
import { managedProviderLogin, providerWriteTransportAllowed } from './daemon-provider-management-api';
import type { LoginView, SavedLoginAccount } from './daemon-provider-login';
import type { LoginIntent } from './daemon-provider-login-contract';
import { PendingPanelCard, PendingCardTitle } from './backend-pending-ui';
import { buttonStyle, buttonTextStyle } from './elevation';
import { colors, spacing, radius } from './theme';
import { useTranslation } from './i18n-react';
import './i18n-provider-login';
import type { ProviderSnapshot } from './daemon-provider-management';
import { providerAccountWrite } from './daemon-provider-account-binding';

// Only opaque ceremony IDs, scoped to the current credential and daemon. No codes
// or credentials are persisted. A panel refresh can resume the same ceremony.
const ceremonies = new Map<string, string>();
export default function DaemonCodexAccounts({ cfg, daemonId, scope, snapshot, bind, binding }: {
  cfg: HubConfig; daemonId: string; scope: string; snapshot: ProviderSnapshot;
  bind: (write: NonNullable<ReturnType<typeof providerAccountWrite>>) => Promise<void>; binding: boolean;
}) {
  const { t } = useTranslation();
  const [session, setSession] = useState<string | null>(() => ceremonies.get(scope) ?? null);
  const [view, setView] = useState<LoginView | null>(null);
  const [accounts, setAccounts] = useState<SavedLoginAccount[] | null>(null);
  const [label, setLabel] = useState('');
  const [models, setModels] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false), request = useRef<AbortController | null>(null);
  const secure = providerWriteTransportAllowed(cfg.serverUrl);
  const run = async (intent: LoginIntent) => {
    if (running.current || !secure) return;
    running.current = true; setBusy(true); setNote(null);
    const ctrl = new AbortController(); request.current = ctrl;
    try {
      const result = await managedProviderLogin(cfg, daemonId, intent, ctrl.signal);
      if (ctrl.signal.aborted) return;
      if (result.kind !== 'ready') { setNote(result.kind); return; }
      if ('accounts' in result.value) { setAccounts(result.value.accounts); return; }
      const next = result.value;
      setView(next);
      if (next.status === 'cancelled' || next.status === 'failed' || next.account_id) {
        ceremonies.delete(scope); setSession(null);
      }
      if (next.account_id) {
        const saved = await managedProviderLogin(cfg, daemonId, { action: 'accounts' }, ctrl.signal);
        if (!ctrl.signal.aborted && saved.kind === 'ready' && 'accounts' in saved.value) setAccounts(saved.value.accounts);
      }
    } finally {
      running.current = false;
      if (!ctrl.signal.aborted) setBusy(false);
    }
  };
  useEffect(() => {
    void run(session ? { action: 'read', session_id: session } : { action: 'accounts' });
    return () => request.current?.abort(); // Leaving does not claim remote cancellation.
  }, []);
  const start = () => {
    if (running.current) return;
    try {
      const id = randomUUID(); ceremonies.set(scope, id); setSession(id); setView(null);
      void run({ action: 'start', session_id: id });
    } catch { setNote('unconfirmed'); }
  };
  const button = (id: string, title: string, action: () => void, disabled = false) =>
    <Pressable testID={`daemon-login-${id}`} accessibilityRole="button" disabled={busy || binding || !secure || disabled}
      onPress={action} style={[buttonStyle('secondary'), (busy || binding || !secure || disabled) && { opacity: 0.45 }]}>
      <Text style={buttonTextStyle('secondary')}>{t(`providerLogin.${title}`)}</Text>
    </Pressable>;
  return <PendingPanelCard testID="daemon-login-card">
    <PendingCardTitle title={t('providerLogin.title')} />
    <Text style={{ color: colors.textSecondary }}>{t('providerLogin.boundary')}</Text>
    {!secure ? <Text style={{ color: colors.textSecondary }}>{t('providerLogin.insecure')}</Text> : null}
    {busy ? <View style={{ flexDirection: 'row', gap: spacing.sm }}><ActivityIndicator color={colors.accent} /><Text>{t('providerLogin.waiting')}</Text></View> : null}
    {note ? <Text testID="daemon-login-note" style={{ color: colors.textSecondary }}>{t(`providerLogin.${note}`)}</Text> : null}
    {view ? <Text testID="daemon-login-state" style={{ color: colors.text }}>{t(`providerLogin.state.${view.account_id ? 'saved' : view.status}`)}</Text> : null}
    {view?.status === 'awaiting_user' && view.challenge && !note ? <View style={{ gap: spacing.sm }}>
      <Text selectable testID="daemon-login-code" style={{ color: colors.text, fontSize: 24, fontWeight: '700' }}>{view.challenge.userCode}</Text>
      <Text style={{ color: colors.textSecondary }}>{t('providerLogin.instructions')}</Text>
      {button('open', 'open', () => { void Linking.openURL(view.challenge!.verificationUrl).catch(() => setNote('openFailed')); })}
    </View> : null}
    {session ? <View style={{ gap: spacing.sm }}>
      {button('check', 'check', () => { void run({ action: 'read', session_id: session }); })}
      {view?.status === 'authenticated' && !view.account_id ? <>
        <TextInput testID="daemon-login-label" accessibilityLabel={t('providerLogin.label')} placeholder={t('providerLogin.label')}
          value={label} onChangeText={setLabel} editable={!busy} maxLength={100}
          style={{ color: colors.text, padding: spacing.sm, borderColor: colors.border, borderWidth: 1, borderRadius: radius.control }} />
        {button('save', 'save', () => { void run({ action: 'save', session_id: session, label }); }, !label.trim())}
      </> : null}
      {button('cancel', 'cancel', () => { void run({ action: 'cancel', session_id: session }); })}
    </View> : button('start', 'start', start)}
    {button('refresh', 'refresh', () => { void run({ action: 'accounts' }); })}
    {accounts?.length ? <>
      <Text style={{ color: colors.textSecondary }}>{t('providerLogin.bindHint')}</Text>
      <TextInput testID="daemon-login-models" accessibilityLabel={t('providerLogin.models')} placeholder={t('providerLogin.models')}
        value={models} onChangeText={setModels} editable={!busy && !binding}
        style={{ color: colors.text, padding: spacing.sm, borderColor: colors.border, borderWidth: 1, borderRadius: radius.control }} />
    </> : null}
    {accounts ? accounts.length ? accounts.map(account => <View key={account.account_id} style={{ gap: spacing.xs }}>
      <Text style={{ color: colors.text }}>{account.label}</Text>
      <Text style={{ color: colors.textSecondary }}>{t('providerLogin.stored')} · {account.account_id.slice(0, 8)}</Text>
      {button(`bind-${account.account_id}`, 'bind', () => {
        const write = providerAccountWrite(snapshot, account.account_id, models); if (write) void bind(write);
      }, !providerAccountWrite(snapshot, account.account_id, models))}
    </View>) : <Text testID="daemon-login-empty" style={{ color: colors.textSecondary }}>{t('providerLogin.empty')}</Text> : null}
  </PendingPanelCard>;
}
