// 设置里管节点的「环境变量」(Vincent 2026-09-25:每个节点的环境变量和 token 都在客户端设置里管,
// 节点上其它东西都从这里读 —— 不再依赖某个人手敲的 shell 命令,重启不丢)。
//
// 数据流与规则文件 / 技能 / 项目文件夹同一条门铃:listNodeEnv / setNodeEnv / unsetNodeEnv → hub 落
// node_rules_requests(op=env_list / env_set / env_unset)+ 门铃 → 节点改自己 config.json 的 env 块
// → waitForRulesFileResult 轮询到终态。
// 🔴 值只写不读:列表只有键和长度;没有「显示」按钮。值只在弹窗的密码框里存在,保存后立刻清掉。
// 🔴 hub 在 list 的立即回复里说能不能写(write_allowed);不能写时「添加 / 修改」直接置灰并说明原因,
//    不让用户白敲一遍会被拒的密钥。
// 版本不够(没上报 env_capable)当场说要升级什么,不转 60 秒圈(同 app#347)。

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';

import {
  listNodeEnv, runNodeLifecycleAction, setNodeEnv, unsetNodeEnv, waitForRulesFileResult,
  type HubConfig, type HubNode, type NodeEnvEnqueueResult, type RulesFileOutcome, type RulesTarget, type Session,
} from './api';
import InfoTip from './InfoTip';
import {
  envErrorMessage, envStatusMessage, envSupport, envTarget, envUnsupportedMessage, insecureMessage, keyEditable, keyInputProblem,
  keyTags, lengthLabel, normalizeKeyInput, parseEnvChange, parseEnvListing, restartPlan, valueInputProblem,
  RESTART_NEEDED, WRITE_ONLY_NOTE, type EnvRestartMode, type NodeEnvKey, type NodeEnvListing,
} from './node-env';
import { isTerminal, nextPollDelayMs } from './node-rules';
import { colors, radius, spacing, type } from './theme';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const INFO = '节点进程的环境变量（API 密钥、服务地址等），保存在节点自己的 config.json 里（权限 0600），节点每次启动都从这里读，不依赖手敲的启动命令。值只写不读；改动在节点重启后生效。PATH、HOME、NODE_OPTIONS、LD_*、ANET_*、COMMHUB_* 等运行时依赖的变量不能在这里设置。';

export type NodeEnvSectionProps = {
  cfg: HubConfig;
  alias?: string;
  node?: RulesTarget | null;
  /** hub 的 nodes 行:决定「保存并重启」能不能用(node_id + lifecycle_controllable)。 */
  hubNode?: Pick<HubNode, 'node_id' | 'alias' | 'lifecycle_controllable'> | null;
  session: Session;
  readOnly?: boolean;
};

export function NodeEnvSection({ cfg, alias, node, hubNode, session, readOnly }: NodeEnvSectionProps) {
  const s = { ...session, alias: session.alias || alias || '' };
  const support = envSupport(s);
  const target = support.kind === 'capable' ? envTarget({ node: node ?? null, session: s }) : null;
  if (support.kind !== 'capable' || !target) {
    const msg = support.kind === 'unsupported' ? envUnsupportedMessage(support) : '找不到可以发请求的节点';
    return (
      <Card testID="node-env-unsupported">
        <Toolbar title={<Text style={{ color: colors.textSecondary, fontSize: 13 }}>环境变量</Text>} />
        <Text style={{ color: colors.failed, fontSize: type.small, lineHeight: 18 }}>{msg}</Text>
      </Card>
    );
  }
  return <EnvManager cfg={cfg} target={target} hubNode={hubNode ?? null} alias={s.alias} readOnly={!!readOnly} />;
}

type Phase = 'loading' | 'ready' | 'error';
type Editor = { mode: 'add' | 'edit'; key: string } | null;
type Blocked = { leg: 'client' | 'node' } | null;
type RestartState = { phase: 'idle' | 'busy' | 'done' | 'error'; message: string };

function EnvManager({ cfg, target, hubNode, alias, readOnly }: { cfg: HubConfig; target: RulesTarget; hubNode: NodeEnvSectionProps['hubNode']; alias: string; readOnly: boolean }) {
  const [listing, setListing] = useState<NodeEnvListing | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [msg, setMsg] = useState('');
  const [blocked, setBlocked] = useState<Blocked>(null);
  const [changed, setChanged] = useState<EnvRestartMode | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState('');
  const [restartState, setRestartState] = useState<RestartState>({ phase: 'idle', message: '' });
  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; }, []);
  const key = `${target.node_id ?? ''}|${target.alias}`;

  // 所有 env 操作共用一条单飞通道:上一条还在跑就先等它结束,再发自己的(绝不把别人的结果当成自己的)。
  const ask = useCallback(async (enqueue: () => Promise<NodeEnvEnqueueResult>): Promise<{ enq: NodeEnvEnqueueResult; res: RulesFileOutcome | null }> => {
    let enq = await enqueue();
    if (!enq.ok && enq.existing_request_id) {
      await waitForRulesFileResult(cfg, enq.existing_request_id, { nextDelayMs: nextPollDelayMs, isTerminal, isCancelled: () => cancelled.current });
      if (cancelled.current) return { enq, res: null };
      enq = await enqueue();
    }
    if (!enq.ok) return { enq, res: null };
    const res = await waitForRulesFileResult(cfg, enq.request_id, { nextDelayMs: nextPollDelayMs, isTerminal, isCancelled: () => cancelled.current });
    return { enq, res };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, key]);

  const load = useCallback(async () => {
    setPhase('loading'); setMsg(envStatusMessage('pending', null));
    const { enq, res } = await ask(() => listNodeEnv(cfg, target));
    if (cancelled.current) return;
    if (!enq.ok) { setPhase('error'); setMsg(envErrorMessage(enq)); return; }
    setBlocked(enq.write_allowed === false ? { leg: enq.write_blocked?.leg ?? 'node' } : null);
    if (!res) return;
    if (!res.ok) { setPhase('error'); setMsg(res.error); return; }
    if (res.status !== 'done') { setPhase('error'); setMsg(envStatusMessage(res.status, res.error)); return; }
    const l = parseEnvListing(res.content);
    if (!l) { setPhase('error'); setMsg('节点返回的环境变量列表无法解析'); return; }
    setListing(l); setPhase('ready'); setMsg('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask, key]);

  useEffect(() => { void load(); }, [load]);

  /** 写 / 删共用:返回 null = 成功;否则是给人看的错误。 */
  const change = useCallback(async (run: () => Promise<NodeEnvEnqueueResult>): Promise<string | null> => {
    const { enq, res } = await ask(run);
    if (cancelled.current) return null;
    if (!enq.ok) {
      if (enq.code === 'insecure_transport') setBlocked({ leg: enq.leg ?? 'node' });
      return envErrorMessage(enq);
    }
    if (!res) return '已取消';
    if (!res.ok) return res.error;
    if (res.status !== 'done') {
      if (res.error && /^insecure_transport/.test(res.error)) setBlocked({ leg: 'node' });
      return envStatusMessage(res.status, res.error, 'write');
    }
    const c = parseEnvChange(res.content);
    if (c?.requiresRestart !== false) setChanged(c?.restart ?? listing?.restart ?? 'manual');
    setRestartState({ phase: 'idle', message: '' });
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask, key, listing?.restart]);

  const onSave = async (k: string, value: string): Promise<string | null> => {
    const err = await change(() => setNodeEnv(cfg, target, k, value));
    if (!err) { setActionMsg(`已保存 ${k}`); setEditor(null); void load(); }
    return err;
  };

  const onDelete = async (k: string) => {
    setConfirmKey(null);
    setActionMsg(`正在删除 ${k}…`);
    const err = await change(() => unsetNodeEnv(cfg, target, k));
    setActionMsg(err ? `删除 ${k} 失败：${err}` : `已删除 ${k}`);
    if (!err) void load();
  };

  const doRestart = async () => {
    if (!hubNode?.node_id) return;
    setRestartState({ phase: 'busy', message: '正在提交重启…' });
    const r = await runNodeLifecycleAction(cfg, 'restart_node', { node_id: hubNode.node_id, alias: hubNode.alias });
    if (cancelled.current) return;
    if (!r.ok) { setRestartState({ phase: 'error', message: `重启失败：${r.error}` }); return; }
    setRestartState({ phase: 'done', message: '重启请求已提交；节点重新上线后点「刷新」确认已生效' });
    setChanged(null);
  };

  const busy = phase === 'loading';
  const canWrite = !readOnly && !blocked;
  const count = phase === 'ready' && listing ? `${listing.keys.length} 个` : '';
  const plan = changed ? restartPlan({ restart: changed, node: hubNode ?? null, alias }) : null;

  return (
    <Card testID="node-env">
      <Toolbar
        title={<Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>环境变量</Text>}
        right={(
          <>
            {busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
            {count ? <Text style={{ color: colors.textMuted, fontSize: 12 }}>{count}</Text> : null}
            <InfoTip label="环境变量说明" text={INFO} />
            <SmallBtn label="刷新" disabled={busy} onPress={() => { setActionMsg(''); void load(); }} />
            {!readOnly ? <SmallBtn label="添加" primary disabled={!canWrite || busy} onPress={() => setEditor({ mode: 'add', key: '' })} testID="node-env-add" /> : null}
          </>
        )}
      />
      {blocked && !readOnly ? (
        <Notice icon="lock-closed-outline" tone="blocked" testID="node-env-insecure">{insecureMessage(blocked.leg)}</Notice>
      ) : null}
      {plan ? (
        <View testID="node-env-restart" style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.blocked, backgroundColor: colors.subtleFill }}>
          <Ionicons name="refresh-circle-outline" size={16} color={colors.blocked} />
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{RESTART_NEEDED}</Text>
          {plan.kind === 'manual' ? <Text style={{ color: colors.textSecondary, fontSize: 12, flexBasis: '100%' }}>{plan.text}</Text> : null}
          <View style={{ flex: 1 }} />
          {plan.kind === 'button' ? <SmallBtn label={restartState.phase === 'busy' ? '提交中…' : '保存并重启'} primary disabled={restartState.phase === 'busy'} onPress={() => void doRestart()} testID="node-env-restart-btn" /> : null}
          <SmallBtn label="稍后" onPress={() => setChanged(null)} />
        </View>
      ) : null}
      {restartState.message ? <Text style={{ color: restartState.phase === 'error' ? colors.failed : colors.running, fontSize: 12 }}>{restartState.message}</Text> : null}
      {actionMsg ? <Text style={{ color: /失败/.test(actionMsg) ? colors.failed : colors.textMuted, fontSize: 12 }}>{actionMsg}</Text> : null}
      {phase === 'loading' && !listing ? (
        <Text style={{ color: colors.textMuted, fontSize: type.small }}>{msg}</Text>
      ) : phase === 'error' ? (
        <Text style={{ color: colors.failed, fontSize: type.small, lineHeight: 18 }}>{msg}</Text>
      ) : listing ? (
        <KeyList listing={listing} dim={busy} canWrite={canWrite} readOnly={readOnly}
          onEdit={(k) => setEditor({ mode: 'edit', key: k })} onDelete={(k) => setConfirmKey(k)} />
      ) : null}
      <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 17 }} testID="node-env-write-only">{WRITE_ONLY_NOTE}</Text>

      <EnvEditorModal editor={editor} onClose={() => setEditor(null)} onSave={onSave} existing={listing?.keys.map(k => k.key) ?? []} />
      <ConfirmModal
        visible={!!confirmKey}
        title={`删除 ${confirmKey ?? ''}？`}
        body="从节点的 config.json 里删掉这个变量。节点重启后它就不在进程环境里了。原值不会保留，之后要用得重新填写。"
        confirmLabel="删除"
        onCancel={() => setConfirmKey(null)}
        onConfirm={() => confirmKey && void onDelete(confirmKey)}
      />
    </Card>
  );
}

function KeyList({ listing, dim, canWrite, readOnly, onEdit, onDelete }: {
  listing: NodeEnvListing; dim: boolean; canWrite: boolean; readOnly: boolean; onEdit: (k: string) => void; onDelete: (k: string) => void;
}) {
  if (listing.keys.length === 0) {
    return <Text style={{ color: colors.textMuted, fontSize: type.small, paddingVertical: spacing.sm }} testID="node-env-empty">还没有环境变量。点「添加」写入第一个（比如模型服务的 API 密钥）。</Text>;
  }
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colors.border, opacity: dim ? 0.5 : 1 }} testID="node-env-list">
      {listing.keys.map(k => <KeyRow key={k.key} k={k} canWrite={canWrite} readOnly={readOnly} onEdit={onEdit} onDelete={onDelete} />)}
    </View>
  );
}

function KeyRow({ k, canWrite, readOnly, onEdit, onDelete }: { k: NodeEnvKey; canWrite: boolean; readOnly: boolean; onEdit: (k: string) => void; onDelete: (k: string) => void }) {
  const editable = keyEditable(k);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 38, paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }} testID={`node-env-row-${k.key}`}>
      <Ionicons name="key-outline" size={14} color={colors.textMuted} />
      <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.text, fontSize: 13, fontFamily: MONO }}>{k.key}</Text>
      {keyTags(k).map(t => (
        <View key={t} style={{ backgroundColor: t === '待重启生效' ? 'transparent' : colors.subtleFill, borderWidth: t === '待重启生效' ? 1 : 0, borderColor: colors.blocked, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1 }}>
          <Text style={{ color: t === '待重启生效' ? colors.blocked : colors.textSecondary, fontSize: 11 }}>{t}</Text>
        </View>
      ))}
      <View style={{ flex: 1 }} />
      <Text style={{ color: colors.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] }}>{lengthLabel(k)}</Text>
      {!readOnly && editable ? (
        <>
          <SmallBtn label="修改" disabled={!canWrite} onPress={() => onEdit(k.key)} />
          <SmallBtn label="删除" danger onPress={() => onDelete(k.key)} />
        </>
      ) : null}
    </View>
  );
}

function EnvEditorModal({ editor, onClose, onSave, existing }: { editor: Editor; onClose: () => void; onSave: (k: string, v: string) => Promise<string | null>; existing: string[] }) {
  const [k, setK] = useState('');
  const [v, setV] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setK(editor?.key ?? ''); setV(''); setErr(''); setSaving(false); }, [editor]);
  if (!editor) return null;
  const keyErr = editor.mode === 'add' ? keyInputProblem(k) : null;
  const valErr = valueInputProblem(v);
  const overwriting = editor.mode === 'add' && existing.includes(k);
  const close = () => { setV(''); onClose(); };
  const save = async () => {
    if (keyErr || valErr || saving) return;
    setSaving(true); setErr('');
    const e = await onSave(k, v);
    setSaving(false);
    // 🔴 值不在状态里多留:成功时弹窗关掉(上面 effect 清空),失败也清掉,重填。
    setV('');
    if (e) setErr(e);
  };
  const input = { color: colors.text, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: spacing.md, paddingVertical: 9, fontSize: 13 } as const;
  return (
    <Modal transparent visible onRequestClose={close} animationType="fade">
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
        <View style={{ width: '100%', maxWidth: 460, borderRadius: 14, backgroundColor: colors.card, padding: spacing.xl, gap: spacing.md }} testID="node-env-editor">
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>{editor.mode === 'add' ? '添加环境变量' : `修改 ${editor.key}`}</Text>
          <View style={{ gap: 6 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>变量名</Text>
            <TextInput value={k} editable={editor.mode === 'add'} onChangeText={t => setK(normalizeKeyInput(t))} autoCapitalize="characters" autoCorrect={false}
              placeholder="例如 API_KEY" placeholderTextColor={colors.textMuted} maxLength={128}
              style={[input, { fontFamily: MONO }, editor.mode === 'edit' ? { opacity: 0.7 } : null]} testID="node-env-key-input" />
            {k && keyErr ? <Text style={{ color: colors.failed, fontSize: 12 }}>{keyErr}</Text> : null}
            {overwriting ? <Text style={{ color: colors.blocked, fontSize: 12 }}>已有同名变量，保存会覆盖它</Text> : null}
          </View>
          <View style={{ gap: 6 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{editor.mode === 'edit' ? '新值（原值看不到，只能整个覆盖）' : '值'}</Text>
            <TextInput value={v} onChangeText={setV} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none"
              placeholder="输入后不会再显示" placeholderTextColor={colors.textMuted} style={[input, { fontFamily: MONO }]} testID="node-env-value-input"
              onSubmitEditing={() => void save()} />
            {v && valErr ? <Text style={{ color: colors.failed, fontSize: 12 }}>{valErr}</Text> : null}
          </View>
          <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 17 }}>保存到节点的 config.json（0600），节点重启后生效。{WRITE_ONLY_NOTE}。</Text>
          {err ? <Text style={{ color: colors.failed, fontSize: 12, lineHeight: 17 }} testID="node-env-editor-error">{err}</Text> : null}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm }}>
            <SmallBtn label="取消" onPress={close} />
            <SmallBtn label={saving ? '保存中…' : '保存'} primary disabled={!!keyErr || !!valErr || saving} onPress={() => void save()} testID="node-env-save" />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ConfirmModal({ visible, title, body, confirmLabel, onCancel, onConfirm }: { visible: boolean; title: string; body: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal transparent visible={visible} onRequestClose={onCancel} animationType="fade">
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
        <View style={{ width: '100%', maxWidth: 420, borderRadius: 14, backgroundColor: colors.card, padding: spacing.xl, gap: spacing.md }} testID="node-env-confirm">
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>{title}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19 }}>{body}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm }}>
            <SmallBtn label="返回" onPress={onCancel} />
            <SmallBtn label={confirmLabel} danger onPress={onConfirm} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Notice({ children, icon, tone, testID }: { children: ReactNode; icon: string; tone: 'blocked'; testID?: string }) {
  const c = tone === 'blocked' ? colors.blocked : colors.textMuted;
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: c, backgroundColor: colors.subtleFill }}>
      <Ionicons name={icon as any} size={15} color={c} style={{ marginTop: 1 }} />
      <Text style={{ flex: 1, color: colors.text, fontSize: 13, lineHeight: 19 }}>{children}</Text>
    </View>
  );
}

function Card({ children, testID }: { children: ReactNode; testID?: string }) {
  return <View testID={testID} style={{ backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm }}>{children}</View>;
}

// 与规则 / 技能 / 项目文件夹同一种紧凑工具条(app#355):一行,左标题,右计数 + ⓘ + 小按钮。
function Toolbar({ title, right }: { title: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, zIndex: 10, minHeight: 30 }}>
      <Ionicons name="key-outline" size={16} color={colors.textMuted} />
      <View style={{ flex: 1, minWidth: 0 }}>{title}</View>
      {right}
    </View>
  );
}

function SmallBtn({ label, onPress, disabled, primary, danger, testID }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean; danger?: boolean; testID?: string }) {
  const border = primary ? colors.accent : colors.border;
  const fg = primary ? colors.accent : danger ? colors.failed : colors.textSecondary;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled} testID={testID}
      style={(st: any) => [{ height: 30, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: 6, borderWidth: 1, borderColor: border, opacity: disabled ? 0.4 : 1 },
        st.hovered && !disabled ? { backgroundColor: colors.rowHover } : null,
        st.focused ? ({ outlineStyle: 'solid', outlineWidth: 2, outlineColor: colors.accent, outlineOffset: 1 } as any) : null]}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: primary ? '600' : '400' }}>{label}</Text>
    </Pressable>
  );
}

export default NodeEnvSection;
