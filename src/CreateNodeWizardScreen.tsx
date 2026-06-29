import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  createNode,
  CreateNodeRequest,
  fetchStatus,
  HostSupervisorDaemon,
  HubConfig,
  Session,
} from './api';
import { colors, onThemeChange, spacing } from './theme';

// #338 RFC-026 §3.1 — mobile create-node wizard rest (Plan B).
// 5 post-picker steps: ① name ② runtime ③ model ④ flags ⑤ confirm.
// On submit POST /mcp create_node, then poll fetchStatus until the
// child alias shows up in the session list. claim=reality discipline
// (per [[feedback_doc_capability_claim_verify_code_path]]) — we don't
// flip to "✓ 已上线" until the child actually registered.
//
// React rules of hooks compliance: ALL useState/useEffect/useRef
// declared BEFORE any conditional early return — guards against the
// v0.1.29 launch-crash class (Vincent tg 1098, [[feedback_anet_node_behavior_stale_install]]
// related discipline).
//
// Runtime step filters by daemon.runtimes_supported when published;
// permissive fallback when absent. Mirrors PR4-A dashboard behavior.

// Hub-side validator enums (server/src/create-node-validate.ts:20,57).
// MUST match exactly — a stale id here ships invalid combos to the hub
// and surfaces only at submit failure. Caught via local curl probe
// during wizard build, not as a regression.
const RUNTIMES: { id: string; label: string; models: string[] }[] = [
  { id: 'claude-agent-sdk', label: 'Claude Agent SDK', models: ['deepseek-v4-pro', 'MiniMax-M3', 'claude-sonnet-4-6', 'claude-opus-4-x'] },
  { id: 'codex-sdk', label: 'Codex SDK', models: ['gpt-5.5'] },
  { id: 'grok-build-acp', label: 'Grok (build-acp)', models: ['grok-build'] },
];
const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];
const STEPS = ['名字', 'Runtime', '模型', '参数', '确认'];

type Phase = 'form' | 'creating' | 'awaiting_register' | 'done' | 'error';

export interface CreateNodeWizardScreenProps {
  cfg: HubConfig;
  daemon: HostSupervisorDaemon;
  onBack: () => void;       // back to picker
  onExit: () => void;       // close wizard entirely (after done or cancel)
}

export default function CreateNodeWizardScreen({ cfg, daemon, onBack, onExit }: CreateNodeWizardScreenProps) {
  // ── All hooks FIRST (no conditional-hook regressions) ──────────────
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [runtimeId, setRuntimeId] = useState(() => {
    // Initial runtime: first supported by daemon if it published; else default.
    const supported = daemon.runtimes_supported;
    if (Array.isArray(supported) && supported.length > 0) {
      const match = RUNTIMES.find(r => supported.includes(r.id));
      return match?.id ?? RUNTIMES[0].id;
    }
    return RUNTIMES[0].id;
  });
  const [model, setModel] = useState('');
  const [permissionMode, setPermissionMode] = useState('default');
  const [maxTurns, setMaxTurns] = useState('');
  const [budget, setBudget] = useState('');
  const [timeoutMs, setTimeoutMs] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [msg, setMsg] = useState('');

  // childUp = the child alias has appeared in fetchStatus → success
  // confirmed (claim=reality). We poll up to ~24s before giving up
  // and showing an "unconfirmed" message — matches dashboard wizard.
  const [childUp, setChildUp] = useState(false);
  const pollAlive = useRef(true);

  // Stop polling on unmount + on screen exit
  useEffect(() => {
    pollAlive.current = true;
    return () => { pollAlive.current = false; };
  }, []);

  // Post-dispatch poll: every 1.5s look at fetchStatus.sessions for the
  // child's alias. Stop after 16 tries (~24s) or when found.
  useEffect(() => {
    if (phase !== 'awaiting_register' || childUp) return;
    let tries = 0;
    const want = name.trim();
    const tick = async () => {
      if (!pollAlive.current) return;
      tries += 1;
      try {
        const data = await fetchStatus(cfg);
        const list: Session[] = Array.isArray(data?.sessions) ? data.sessions : [];
        if (pollAlive.current && list.some(s => s?.alias === want)) {
          setChildUp(true);
          setPhase('done');
          return;
        }
      } catch { /* transient — keep polling */ }
      if (pollAlive.current && tries < 16) {
        setTimeout(tick, 1500);
      } else if (pollAlive.current) {
        // Timeout — don't flip to error (hub may have accepted the dispatch
        // but the child is slow to bootstrap). Honest message.
        setPhase('done');
        setMsg('已下发，但 24s 内未看到子节点注册。可能仍在拉起中——稍后到 Agents 列表查看。');
      }
    };
    const t = setTimeout(tick, 1200);
    return () => { clearTimeout(t); };
  }, [phase, childUp, cfg, name]);

  // Derived: runtime details + nav gates
  const runtime = RUNTIMES.find(r => r.id === runtimeId) || RUNTIMES[0];
  const nameValid = name.trim().length > 0;
  const isRuntimeAllowed = useCallback((id: string) => {
    const supported = daemon.runtimes_supported;
    if (!Array.isArray(supported) || supported.length === 0) return true;
    return supported.includes(id);
  }, [daemon.runtimes_supported]);
  const canNext =
    (step === 0 && nameValid) ||
    (step === 1 && isRuntimeAllowed(runtimeId)) ||
    (step >= 2 && step < STEPS.length);
  const busy = phase === 'creating' || phase === 'awaiting_register';

  // ── handlers (no hooks below this line) ────────────────────────────
  const handleSubmit = async () => {
    setPhase('creating');
    setMsg('');
    const numOrUndef = (v: string) => (v.trim() === '' ? undefined : Number(v));
    const node_spec: CreateNodeRequest['node_spec'] = {
      name: name.trim(),
      runtime: runtimeId,
      ...(model ? { model } : {}),
      flags: {
        permissionMode,
        ...(numOrUndef(maxTurns) !== undefined ? { maxTurns: numOrUndef(maxTurns) } : {}),
        ...(numOrUndef(budget) !== undefined ? { budget: numOrUndef(budget) } : {}),
        ...(numOrUndef(timeoutMs) !== undefined ? { timeout: numOrUndef(timeoutMs) } : {}),
      },
    };
    const res = await createNode(cfg, {
      daemon_node_id: daemon.daemon_node_id,
      node_spec,
    });
    if (res.ok) {
      // Hub accepted dispatch. Now POLL to confirm child registered.
      setPhase('awaiting_register');
      setMsg('创建请求已下发，正在监测子节点注册…');
    } else if (res.unconfirmed) {
      setPhase('error');
      setMsg(`服务器未就绪：${res.error}`);
    } else {
      setPhase('error');
      setMsg(`创建失败：${res.error}`);
    }
  };

  // ── render ─────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
          onPress={busy ? () => { /* ignore back mid-create */ } : onBack}
          hitSlop={8}
          accessibilityLabel="返回服务器选择"
        >
          <Ionicons name="chevron-back" size={26} color={busy ? colors.textMuted : colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>新建节点</Text>
        <View style={styles.headerBtn} />
      </View>

      {/* Daemon summary line — reminds user where this child lands */}
      <View style={styles.daemonStrip}>
        <Ionicons name="server-outline" size={14} color={colors.textMuted} />
        <Text style={styles.daemonStripText} numberOfLines={1}>
          将创建在 {daemon.alias}
          {daemon.hostname ? ` (${daemon.hostname})` : ''}
        </Text>
      </View>

      {/* Step indicator */}
      <View style={styles.stepRow}>
        {STEPS.map((label, i) => (
          <View key={label} style={styles.stepCell}>
            <View style={[styles.stepBar, i <= step && styles.stepBarActive]} />
            <Text style={[styles.stepLabel, i === step && styles.stepLabelActive]}>{label}</Text>
          </View>
        ))}
      </View>

      {/* Body */}
      <ScrollView
        style={styles.bodyScroll}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
      >
        {phase !== 'form' ? (
          <View style={styles.statusBlock}>
            {busy ? <ActivityIndicator color={colors.accent} /> : null}
            <Text style={[
              styles.statusText,
              phase === 'done' && childUp && styles.statusOk,
              phase === 'error' && styles.statusErr,
            ]}>
              {phase === 'creating'
                ? '正在下发创建请求…'
                : phase === 'awaiting_register'
                  ? `正在监测 ${name.trim()} 注册…（最长 24s）`
                  : phase === 'done' && childUp
                    ? `✓ ${name.trim()} 已上线`
                    : msg}
            </Text>
          </View>
        ) : (
          <>
            {step === 0 && (
              <View style={styles.section}>
                <Text style={styles.label}>节点名字</Text>
                <TextInput
                  autoFocus
                  value={name}
                  onChangeText={setName}
                  placeholder="例如 my-agent-1"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {!nameValid && (
                  <Text style={styles.hint}>名字不能为空</Text>
                )}
              </View>
            )}

            {step === 1 && (
              <View style={styles.section}>
                <Text style={styles.label}>
                  Runtime（{daemon.alias} 支持）
                </Text>
                {RUNTIMES.map(r => {
                  const allowed = isRuntimeAllowed(r.id);
                  const selected = runtimeId === r.id;
                  return (
                    <Pressable
                      key={r.id}
                      disabled={!allowed}
                      onPress={() => {
                        if (allowed) {
                          setRuntimeId(r.id);
                          setModel('');
                        }
                      }}
                      style={({ pressed }) => [
                        styles.choiceRow,
                        selected && allowed && styles.choiceRowSelected,
                        !allowed && styles.choiceRowDisabled,
                        pressed && allowed && { opacity: 0.85 },
                      ]}
                    >
                      <Text style={[
                        styles.choiceText,
                        selected && allowed && styles.choiceTextSelected,
                        !allowed && styles.choiceTextDisabled,
                      ]}>
                        {r.label}
                        {!allowed && (
                          <Text style={styles.choiceUnsupported}>  · 该 daemon 不支持</Text>
                        )}
                      </Text>
                      {selected && allowed ? (
                        <Ionicons name="checkmark" size={18} color={colors.accent} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            )}

            {step === 2 && (
              <View style={styles.section}>
                <Text style={styles.label}>模型（{runtime.label}）</Text>
                <View style={styles.choiceList}>
                  <Pressable
                    onPress={() => setModel('')}
                    style={({ pressed }) => [
                      styles.choiceRow,
                      model === '' && styles.choiceRowSelected,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <Text style={[styles.choiceText, model === '' && styles.choiceTextSelected]}>
                      默认
                    </Text>
                    {model === '' ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
                  </Pressable>
                  {runtime.models.map(m => (
                    <Pressable
                      key={m}
                      onPress={() => setModel(m)}
                      style={({ pressed }) => [
                        styles.choiceRow,
                        model === m && styles.choiceRowSelected,
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Text style={[styles.choiceText, model === m && styles.choiceTextSelected]}>
                        {m}
                      </Text>
                      {model === m ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {step === 3 && (
              <View style={styles.section}>
                <Text style={styles.label}>permissionMode</Text>
                <View style={styles.choiceList}>
                  {PERMISSION_MODES.map(m => (
                    <Pressable
                      key={m}
                      onPress={() => setPermissionMode(m)}
                      style={({ pressed }) => [
                        styles.choiceRow,
                        permissionMode === m && styles.choiceRowSelected,
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Text style={[styles.choiceText, permissionMode === m && styles.choiceTextSelected]}>
                        {m}
                      </Text>
                      {permissionMode === m ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
                    </Pressable>
                  ))}
                </View>

                <Text style={[styles.label, { marginTop: spacing.lg }]}>限制（可空）</Text>
                <View style={styles.row3}>
                  <View style={styles.row3Cell}>
                    <Text style={styles.subLabel}>maxTurns</Text>
                    <TextInput
                      value={maxTurns}
                      onChangeText={setMaxTurns}
                      placeholder="—"
                      placeholderTextColor={colors.textMuted}
                      style={styles.input}
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={styles.row3Cell}>
                    <Text style={styles.subLabel}>budget</Text>
                    <TextInput
                      value={budget}
                      onChangeText={setBudget}
                      placeholder="—"
                      placeholderTextColor={colors.textMuted}
                      style={styles.input}
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={styles.row3Cell}>
                    <Text style={styles.subLabel}>timeout</Text>
                    <TextInput
                      value={timeoutMs}
                      onChangeText={setTimeoutMs}
                      placeholder="—"
                      placeholderTextColor={colors.textMuted}
                      style={styles.input}
                      keyboardType="numeric"
                    />
                  </View>
                </View>
              </View>
            )}

            {step === 4 && (
              <View style={styles.section}>
                <Text style={styles.label}>确认</Text>
                <View style={styles.summaryCard}>
                  <SummaryRow k="服务器" v={`${daemon.alias} (${daemon.hostname || '—'})`} />
                  <Divider />
                  <SummaryRow k="名字" v={name.trim() || '—'} />
                  <Divider />
                  <SummaryRow k="Runtime" v={runtime.label} />
                  <Divider />
                  <SummaryRow k="模型" v={model || '默认'} />
                  <Divider />
                  <SummaryRow k="permissionMode" v={permissionMode} />
                  <Divider />
                  <SummaryRow
                    k="maxTurns / budget / timeout"
                    v={`${maxTurns || '—'} / ${budget || '—'} / ${timeoutMs || '—'}`}
                  />
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Footer nav */}
      <View style={styles.footer}>
        {phase === 'form' ? (
          <>
            <Pressable
              onPress={step === 0 ? onBack : () => setStep(step - 1)}
              style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.secondaryBtnText}>{step === 0 ? '上一步' : '上一步'}</Text>
            </Pressable>
            {step < STEPS.length - 1 ? (
              <Pressable
                disabled={!canNext}
                onPress={() => setStep(step + 1)}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  !canNext && styles.primaryBtnDisabled,
                  pressed && canNext && { opacity: 0.8 },
                ]}
              >
                <Text style={[styles.primaryBtnText, !canNext && styles.primaryBtnTextDisabled]}>
                  下一步
                </Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={handleSubmit}
                style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.8 }]}
              >
                <Text style={styles.primaryBtnText}>创建节点</Text>
              </Pressable>
            )}
          </>
        ) : (
          <Pressable
            onPress={phase === 'error' ? () => setPhase('form') : onExit}
            disabled={busy}
            style={({ pressed }) => [
              styles.primaryBtn,
              busy && styles.primaryBtnDisabled,
              pressed && !busy && { opacity: 0.8 },
            ]}
          >
            <Text style={[styles.primaryBtnText, busy && styles.primaryBtnTextDisabled]}>
              {busy ? '请稍候…' : phase === 'error' ? '返回修改' : '完成'}
            </Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

// ── small bits ───────────────────────────────────────────────────────

function SummaryRow({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryKey}>{k}</Text>
      <Text style={styles.summaryVal} numberOfLines={2}>{v}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

// ── styles ───────────────────────────────────────────────────────────

const makeStyles = () => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.text, fontSize: 17, fontWeight: '600', flex: 1, textAlign: 'center' },

  daemonStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  daemonStripText: { color: colors.textMuted, fontSize: 12, flex: 1 },

  stepRow: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  stepCell: { flex: 1, alignItems: 'center', gap: 4 },
  stepBar: { height: 3, width: '100%', borderRadius: 2, backgroundColor: colors.border },
  stepBarActive: { backgroundColor: colors.accent },
  stepLabel: { color: colors.textMuted, fontSize: 10 },
  stepLabelActive: { color: colors.accent },

  bodyScroll: { flex: 1 },
  bodyContent: { padding: spacing.lg },

  section: { gap: spacing.sm },
  label: { color: colors.textMuted, fontSize: 12 },
  subLabel: { color: colors.textMuted, fontSize: 11 },
  hint: { color: colors.textMuted, fontSize: 11 },

  input: {
    backgroundColor: colors.inputBg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.text,
    fontSize: 14,
  },

  choiceList: { gap: spacing.sm },
  choiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.inputBg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  choiceRowSelected: { borderColor: colors.accent, backgroundColor: colors.card },
  choiceRowDisabled: { opacity: 0.55, backgroundColor: colors.bg },
  choiceText: { color: colors.text, fontSize: 14 },
  choiceTextSelected: { color: colors.accent, fontWeight: '600' },
  choiceTextDisabled: { color: colors.textMuted },
  choiceUnsupported: { color: colors.textMuted, fontSize: 11 },

  row3: { flexDirection: 'row', gap: spacing.sm },
  row3Cell: { flex: 1, gap: spacing.xs },

  summaryCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  summaryKey: { color: colors.textMuted, fontSize: 12, flexShrink: 0 },
  summaryVal: { color: colors.text, fontSize: 13, textAlign: 'right', flex: 1 },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: spacing.lg },

  statusBlock: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  statusText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center' },
  statusOk: { color: colors.running, fontWeight: '600' },
  statusErr: { color: colors.failed },

  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryBtnDisabled: { backgroundColor: colors.border },
  primaryBtnText: { color: '#0b0b0d', fontSize: 15, fontWeight: '600' },
  primaryBtnTextDisabled: { color: colors.textMuted },
  secondaryBtn: {
    flex: 1,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    paddingVertical: spacing.md,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondaryBtnText: { color: colors.text, fontSize: 15, fontWeight: '500' },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
