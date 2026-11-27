import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { fetchNodeSecretRequests, runNodeLifecycleAction, type HubConfig } from './api';
import { scopedSecrets } from './scoped-secrets-api';
import { mergeNodeSecretKeys, nodeSecretsNeedsUpgrade, validSecretInput, type SecretScope, type SecretSnapshot, type SecretWrite } from './scoped-secrets';
import {
  SECRET_LIST_SOFT_TIMEOUT_MS,
  secretFormEditable,
  secretListStatusText,
  secretSaveDisabled,
  type SecretHardBlock,
  type SecretListState,
} from './scoped-secrets-ui-model';
import {
  manualRestartCommand, restartChoiceAfterAttempt, restartChoiceAfterSecret, restartChoiceText,
  type RestartChoice,
} from './node-restart-after-secret';
import SecretRequestCard from './SecretRequestCard';
import { useTranslation } from './i18n-react';
import './i18n-scoped-secrets';
import './i18n-provider-management';
import { providerHttpWarning } from './daemon-provider-management-api';
import { colors, spacing, radius, type } from './theme';
import { buttonStyle, buttonTextStyle } from './elevation';

type Props = { cfg: HubConfig; daemonId?: string | null; nodeId?: string | null; nodeRuntimeVersion?: string | null; nodeSecretsCapable?: boolean; alias?: string; configUpdateCapable?: boolean | null | undefined; online?: boolean };

export default function ScopedSecretsSection(props: Props) {
  return <Page key={JSON.stringify([props.cfg.serverUrl, props.cfg.networkId, props.cfg.token, props.daemonId, props.nodeId, props.nodeRuntimeVersion])} {...props} />;
}

function Page({ cfg, daemonId, nodeId, nodeRuntimeVersion, nodeSecretsCapable, alias, configUpdateCapable, online }: Props) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<SecretSnapshot | null>(null);
  const [independentSnap, setIndependentSnap] = useState<SecretSnapshot | null>(null);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  // #5675 PR-2 —— 名称列表读取（listState）与写入提交（writing）完全解耦：
  // 读取名称列表绝不锁住输入框和保存按钮；超过 8 秒没结果立刻停转圈并提示可直接保存新密钥。
  const [listState, setListState] = useState<SecretListState>('idle');
  const [hardBlock, setHardBlock] = useState<SecretHardBlock>(null);
  const [writing, setWriting] = useState(false);
  const [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  // #4827 —— agent 举手要的 key：卡片级 saving/saved 状态（写完整份刷新后由 pending 消失体现）。
  const [requestSaving, setRequestSaving] = useState<string | null>(null);
  // #4827 —— REST GET /secrets 只回 pending（字段缺省 = 无）；MCP 轮询端点不带它。
  const [pendingRest, setPendingRest] = useState<{ key: string; label?: string }[]>([]);
  // #1511 / #5505 —— 保存/删除后统一在密钥页给重启闭环（倒计时自动重启或可照抄命令）。
  const [restartChoice, setRestartChoice] = useState<RestartChoice | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const restartTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const listCtrl = useRef<AbortController | null>(null);
  const writeCtrl = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  const supported = !!(daemonId || nodeId) && !!cfg.networkId;
  const independent = !!nodeId && !daemonId;
  const upgradeRequired = independent && nodeSecretsCapable !== true
    && (nodeRuntimeVersion == null || nodeSecretsNeedsUpgrade(nodeRuntimeVersion));

  const clearRestartTimer = useCallback(() => {
    if (restartTimer.current) { clearInterval(restartTimer.current); restartTimer.current = null; }
  }, []);

  const dispatchRestartNow = useCallback(async (planned: RestartChoice) => {
    if (!nodeId) return;
    clearRestartTimer();
    if (mounted.current) setCountdown(null);
    const r = await runNodeLifecycleAction(cfg, 'restart_node', { node_id: nodeId, alias: alias ?? '' });
    if (!mounted.current) return;
    setRestartChoice(prev => restartChoiceAfterAttempt(prev ?? planned, r.ok ? { ok: true } : r, alias));
  }, [alias, cfg, clearRestartTimer, nodeId]);

  const offerRestartAfterSave = useCallback(() => {
    if (!nodeId) return;
    const planned = restartChoiceAfterSecret({ configUpdateCapable, online: online ?? false, alias });
    setRestartChoice(planned);
    if (planned.kind !== 'scheduled') { setCountdown(null); return; }
    clearRestartTimer();
    setCountdown(planned.countdownSeconds);
    let left = planned.countdownSeconds;
    restartTimer.current = setInterval(() => {
      left -= 1;
      if (left > 0) { if (mounted.current) setCountdown(left); return; }
      void dispatchRestartNow(planned);
    }, 1000);
  }, [alias, clearRestartTimer, configUpdateCapable, dispatchRestartNow, nodeId, online]);

  const cancelScheduledRestart = useCallback(() => {
    clearRestartTimer();
    if (mounted.current) setCountdown(null);
    setRestartChoice({ kind: 'manual', command: manualRestartCommand(alias) });
  }, [alias, clearRestartTimer]);

  const loadList = async () => {
    if (!supported || upgradeRequired) return;
    listCtrl.current?.abort();
    const ctrl = new AbortController();
    listCtrl.current = ctrl;
    setListState('loading');
    setNotice('');
    setDeleting(null);
    const pendingRead = nodeId ? fetchNodeSecretRequests(cfg, nodeId) : Promise.resolve([]);
    const primaryScope: SecretScope = { networkId: cfg.networkId!, daemonId: daemonId ?? null, nodeId: nodeId ?? null };
    const independentScope: SecretScope = { networkId: cfg.networkId!, daemonId: null, nodeId: nodeId ?? null };

    const result = await scopedSecrets(cfg, primaryScope, ctrl.signal, undefined, { timeoutMs: SECRET_LIST_SOFT_TIMEOUT_MS });
    const extraRead = daemonId && nodeId && nodeSecretsCapable && result.kind === 'ready'
      ? scopedSecrets(cfg, independentScope, ctrl.signal, undefined, { timeoutMs: SECRET_LIST_SOFT_TIMEOUT_MS }).catch(() => null)
      : Promise.resolve(null);
    const extraResult = await extraRead;
    void pendingRead.then(rows => { if (mounted.current) setPendingRest(rows); });
    if (!mounted.current || ctrl.signal.aborted || listCtrl.current !== ctrl) return;
    listCtrl.current = null;

    if (extraResult && extraResult.kind === 'ready') setIndependentSnap(extraResult.snapshot);
    else if (!daemonId) setIndependentSnap(null);

    if (result.kind === 'ready') {
      setHardBlock(null);
      setSnapshot(result.snapshot);
      setListState('ready');
    } else if (result.kind === 'unsupported' || result.kind === 'forbidden') {
      setSnapshot(null);
      setHardBlock(result.kind);
      setListState('error');
      setNotice(t(result.kind === 'unsupported' && independent ? 'scopedSecrets.nodeUnsupported' : `scopedSecrets.${result.kind}`));
    } else {
      // 超时 / 未确认（节点正在忙）：停止转圈、不锁输入框和保存按钮，允许直接保存新密钥。
      setHardBlock(null);
      setListState('timed_out');
    }
  };

  const resolveRevisionForWrite = async (scope: SecretScope, signal: AbortSignal, knownRev?: number): Promise<{ ok: true; revision: number } | { ok: false; kind: string }> => {
    if (typeof knownRev === 'number' && Number.isSafeInteger(knownRev) && knownRev >= 0) {
      return { ok: true, revision: knownRev };
    }
    const listed = await scopedSecrets(cfg, scope, signal);
    if (listed.kind === 'ready') return { ok: true, revision: listed.snapshot.revision };
    return { ok: false, kind: listed.kind };
  };

  const runWrite = async (write: Omit<SecretWrite, 'revision'> & { revision?: number }, targetIndependent = false) => {
    if (!supported || upgradeRequired || writeCtrl.current) return;
    listCtrl.current?.abort();
    listCtrl.current = null;
    const ctrl = new AbortController();
    writeCtrl.current = ctrl;
    setWriting(true);
    setNotice('');
    setDeleting(null);
    if (write.action === 'put') setValue('');

    const primaryScope: SecretScope = { networkId: cfg.networkId!, daemonId: daemonId ?? null, nodeId: nodeId ?? null };
    const independentScope: SecretScope = { networkId: cfg.networkId!, daemonId: null, nodeId: nodeId ?? null };
    const scope = targetIndependent ? independentScope : primaryScope;
    const knownRev = write.revision ?? (targetIndependent ? independentSnap?.revision : snapshot?.revision);

    const revRes = await resolveRevisionForWrite(scope, ctrl.signal, knownRev);
    if (!mounted.current || ctrl.signal.aborted) return;
    if (!revRes.ok) {
      writeCtrl.current = null;
      setWriting(false);
      if (revRes.kind === 'unsupported' || revRes.kind === 'forbidden') {
        setHardBlock(revRes.kind);
        setNotice(t(revRes.kind === 'unsupported' && independent ? 'scopedSecrets.nodeUnsupported' : `scopedSecrets.${revRes.kind}`));
      } else {
        setNotice(t(`scopedSecrets.${revRes.kind === 'cancelled' ? 'unconfirmed' : revRes.kind}`));
      }
      return;
    }

    const result = await scopedSecrets(cfg, scope, ctrl.signal, {
      action: write.action,
      key: write.key,
      ...(write.value !== undefined ? { value: write.value } : {}),
      revision: revRes.revision,
    });
    const extraRead = daemonId && nodeId && nodeSecretsCapable && !targetIndependent && result.kind === 'ready'
      ? scopedSecrets(cfg, independentScope, ctrl.signal, undefined, { timeoutMs: SECRET_LIST_SOFT_TIMEOUT_MS }).catch(() => null)
      : Promise.resolve(null);
    const extraResult = await extraRead;
    const pendingRead = nodeId ? fetchNodeSecretRequests(cfg, nodeId) : Promise.resolve([]);
    void pendingRead.then(rows => { if (mounted.current) setPendingRest(rows); });
    if (!mounted.current || ctrl.signal.aborted) return;

    if (targetIndependent) {
      if (result.kind === 'ready') {
        setIndependentSnap(result.snapshot);
        setNotice(t(write.action === 'put' ? 'scopedSecrets.nodeSaved' : 'scopedSecrets.nodeDeleted'));
        offerRestartAfterSave();
      } else {
        setNotice(t(`scopedSecrets.${result.kind === 'cancelled' ? 'unconfirmed' : result.kind}`));
      }
    } else {
      if (extraResult && extraResult.kind === 'ready') setIndependentSnap(extraResult.snapshot);
      else if (!daemonId) setIndependentSnap(null);
      if (result.kind === 'ready') {
        setHardBlock(null);
        setSnapshot(result.snapshot);
        setListState('ready');
        setNotice(t(independent
          ? write.action === 'put' ? 'scopedSecrets.nodeSaved' : 'scopedSecrets.nodeDeleted'
          : write.action === 'put' ? 'scopedSecrets.saved' : 'scopedSecrets.deleted'));
        offerRestartAfterSave();
      } else {
        if (result.kind === 'unsupported' || result.kind === 'forbidden') setHardBlock(result.kind);
        setNotice(t(result.kind === 'unsupported' && independent ? 'scopedSecrets.nodeUnsupported' : `scopedSecrets.${result.kind === 'cancelled' ? 'unconfirmed' : result.kind}`));
      }
    }
    writeCtrl.current = null;
    setWriting(false);
  };

  useEffect(() => {
    mounted.current = true;
    void loadList();
    return () => {
      mounted.current = false;
      clearRestartTimer();
      listCtrl.current?.abort();
      writeCtrl.current?.abort();
    };
  }, []);

  const displayedKeys = snapshot ? mergeNodeSecretKeys(snapshot.keys, independentSnap?.keys ?? []) : [];
  const formEditable = secretFormEditable({ writing, hardBlock });
  const saveDisabled = secretSaveDisabled({ writing, hardBlock });
  const listStatus = secretListStatusText(listState);
  const field = { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm, color: colors.text, fontSize: type.body, backgroundColor: colors.bg };
  const Button = ({ title, press, disabled = false, testID }: { title: string; press: () => void; disabled?: boolean; testID?: string }) => (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={press} style={[buttonStyle('secondary'), { opacity: disabled ? 0.45 : 1 }]}>
      <Text style={buttonTextStyle('secondary')}>{title}</Text>
    </Pressable>
  );

  return <View testID="scoped-secrets" style={{ gap: spacing.md }}>
    <Text style={{ fontSize: type.title, fontWeight: '600', color: colors.text }}>{t('scopedSecrets.title')}</Text>
    <Text style={{ color: colors.textMuted }}>{t(independent ? 'scopedSecrets.nodeIndependent' : nodeId ? 'scopedSecrets.node' : 'scopedSecrets.daemon')}</Text>
    <Text style={{ color: colors.textMuted, fontSize: type.small }}>{t(independent ? 'scopedSecrets.nodeBoundary' : 'scopedSecrets.boundary')}</Text>
    {providerHttpWarning(cfg.serverUrl) ? <Text style={{ color: colors.textMuted }}>{t('providerManagement.httpWarning')}</Text> : null}
    {!supported ? <Text>{t('scopedSecrets.unbound')}</Text> : upgradeRequired ? <View testID="scoped-secret-upgrade" style={{ gap: spacing.sm }}>
      <Text style={{ color: colors.text }}>{t('scopedSecrets.nodeRuntimeVersion', { version: nodeRuntimeVersion! })}</Text>
      <Text style={{ color: colors.textMuted }}>{t('scopedSecrets.nodeUnsupported')}</Text>
    </View> : <>
      <Button title={t('scopedSecrets.refresh')} testID="scoped-secret-refresh" disabled={writing || listState === 'loading'} press={() => void loadList()} />
      {writing ? <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}><ActivityIndicator color={colors.textMuted}/><Text style={{color:colors.textMuted}}>{t(independent ? 'scopedSecrets.nodeSaving' : 'scopedSecrets.saving')}</Text></View> : null}
      {restartChoice ? <View testID="node-secrets-restart-choice" style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, gap: spacing.xs }}>
        <Text testID={`node-secrets-restart-${restartChoice.kind}`} style={{ color: restartChoice.kind === 'busy' ? colors.blocked : colors.textSecondary, fontSize: type.small }}>
          {restartChoiceText(restartChoice)}{countdown !== null ? `（剩余 ${countdown} 秒）` : ''}
        </Text>
        {countdown !== null ? <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <Pressable testID="node-secrets-restart-now" disabled={writing} onPress={() => void dispatchRestartNow(restartChoice)}>
            <Text style={{ color: colors.accent, fontSize: type.small }}>立即重启</Text>
          </Pressable>
          <Pressable testID="node-secrets-restart-cancel" disabled={writing} onPress={cancelScheduledRestart}>
            <Text style={{ color: colors.textMuted, fontSize: type.small }}>取消重启</Text>
          </Pressable>
        </View> : null}
      </View> : null}
      {[...pendingRest, ...(snapshot?.pending ?? [])].filter((p, i, all) => all.findIndex(x => x.key === p.key) === i)
        .filter(p => !displayedKeys.some(k => k.key === p.key && k.source === (nodeId ? 'node' : 'daemon'))).map(p => <SecretRequestCard
          key={p.key}
          testID={`secret-request-${p.key}`}
          request={{ key: p.key, ...(p.label ? { label: p.label } : {}) }}
          phase={requestSaving === p.key ? 'saving' : 'idle'}
          onSave={v => {
            setRequestSaving(p.key);
            void runWrite({ action: 'put', key: p.key, value: v, ...(snapshot ? { revision: snapshot.revision } : {}) }).finally(() => setRequestSaving(null));
          }}
        />)}
      {listState === 'loading' ? (
        <View testID="scoped-secret-list-status" style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md }}>
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Text style={{ color: colors.textMuted, fontSize: type.small }}>{listStatus}</Text>
        </View>
      ) : listState === 'timed_out' ? (
        <View testID="scoped-secret-list-status" style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md }}>
          <Text style={{ color: colors.blocked, fontSize: type.small }}>{listStatus}</Text>
        </View>
      ) : snapshot ? <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm }}>
        {!displayedKeys.length ? <Text style={{ color: colors.textMuted }}>{t('scopedSecrets.empty')}</Text> : displayedKeys.map(item => <View key={item.key} style={{ gap: spacing.xs }}>
          <Text style={{ color: colors.text }}>{item.key}</Text><Text style={{ color: colors.textMuted, fontSize: type.small }}>{t(item.source === 'node' ? 'scopedSecrets.sourceNode' : nodeId ? 'scopedSecrets.sourceDaemon' : 'scopedSecrets.sourceOwnDaemon')}</Text>
          {item.source === (nodeId ? 'node' : 'daemon') ? <Button title={t(deleting === item.key ? 'scopedSecrets.confirmDelete' : 'scopedSecrets.delete')} disabled={writing} press={() => {
            if (deleting === item.key) {
              if (item.independentOnly && independentSnap) {
                void runWrite({ action: 'delete', key: item.key, revision: independentSnap.revision }, true);
              } else {
                void runWrite({ action: 'delete', key: item.key, revision: snapshot.revision });
              }
            } else setDeleting(item.key);
          }} /> : null}
        </View>)}
      </View> : null}
      <Text>{t('scopedSecrets.name')}</Text>
      <TextInput testID="scoped-secret-name" accessibilityLabel={t('scopedSecrets.name')} value={key} onChangeText={setKey} editable={formEditable} autoCapitalize="characters" autoCorrect={false} style={field} />
      <Text>{t('scopedSecrets.value')}</Text>
      <TextInput testID="scoped-secret-value" accessibilityLabel={t('scopedSecrets.value')} value={value} onChangeText={setValue} editable={formEditable} secureTextEntry autoCapitalize="none" autoCorrect={false} style={field} />
      <Button title={t('scopedSecrets.save')} testID="scoped-secret-save" disabled={saveDisabled} press={() => {
        if (!validSecretInput(key.trim(), value)) { setNotice(t('scopedSecrets.invalid')); return; }
        void runWrite({ action: 'put', key: key.trim(), value });
      }} />
      {notice ? <Text testID="scoped-secret-notice" style={{ color: colors.textMuted }}>{notice}</Text> : null}
    </>}
  </View>;
}
