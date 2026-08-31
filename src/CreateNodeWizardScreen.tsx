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
// child alias shows up in the session list. A `ok:true` from the RPC
// means "hub accepted the call", not "the child is running" — we
// don't flip to "✓ 已上线" until fetchStatus confirms the alias
// actually registered.
//
// React rules of hooks compliance: ALL useState/useEffect/useRef
// declared BEFORE any conditional early return — guards against the
// v0.1.29 launch-crash class (Vincent tg 1098). Conditionally
// declaring hooks after an early-return branches the hook order and
// crashes the JS engine when React tries to match hook indices
// across renders.
//
// Runtime step filters by daemon.runtimes_supported when published;
// permissive fallback when absent. Mirrors PR4-A dashboard behavior.

// Hub-side validator enums (server/src/create-node-validate.ts:20,57).
// MUST match exactly — a stale id here ships invalid combos to the hub
// and surfaces only at submit failure. Caught via local curl probe
// during wizard build, not as a regression.
// Hub-side name validator (server/src/create-node-validate.ts:34).
// Wizard MUST surface the regex at step 0 instead of only validating
// length > 0 — otherwise uppercase / spaces / Chinese / digit-prefix
// names pass the wizard, walk all 5 steps, then fail with
// node_name_invalid only after submit (通信龙 #3 B2 catch).
const NAME_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const NAME_RULE_HINT = '小写字母开头，仅允许 a-z 0-9 _ -，最多 64 字符';

const RUNTIMES: { id: string; label: string; models: string[] }[] = [
  { id: 'claude-agent-sdk', label: 'Claude Agent SDK', models: ['deepseek-v4-pro', 'MiniMax-M3', 'claude-sonnet-4-6', 'claude-opus-4-x'] },
  { id: 'codex-sdk', label: 'Codex SDK', models: ['gpt-5.5'] },
  { id: 'grok-build-acp', label: 'Grok (build-acp)', models: ['grok-build'] },
  // 共存 runtime：复用宿主 TUI 的会员登录态，不选模型、不输 key。
  // models 为空数组 ⇒ 第 3 步显示「跟随宿主登录」，提交时省略 model
  // 字段（hub 侧自 da84f34d 起 model optional/nullable）。
  { id: 'claude-code-cli', label: 'Claude Code（TUI 共存）', models: [] },
  { id: 'codex-app-server', label: 'Codex（TUI 共存）', models: [] },
  { id: 'grok-build-cli', label: 'Grok（TUI 共存）', models: [] },
  // #199 —— hub / daemon / CLI 三处的 runtime 全集都是 7 个,只有这里是 6 个。
  // `opencode-cli` 出现在 agent-network/src/codex-copresence-profile.ts:223 的共存
  // profile 里 ⇒ 与上面三个同族,models 同样留空。(目录名叫 opencode-**acp**,
  //  但 runtime id 只有 opencode-**cli** —— normalize-runtime.ts:108 把两者归一。)
  { id: 'opencode-cli', label: 'OpenCode（TUI 共存）', models: [] },
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
  // Initialize model to the runtime's first model (NEVER ''). Hub
  // schema requires model.min(1) (tools.ts:1977); a 默认/empty pick
  // makes the create_node call zod-reject which then surfaces as a
  // misleading "需升级 hub" message — caught by 通信龙 #3 CHANGE_REQ.
  // No "默认" option in step 2 anymore; we pick first explicitly.
  const [model, setModel] = useState(() => {
    const supported = daemon.runtimes_supported;
    const initRuntime =
      Array.isArray(supported) && supported.length > 0
        ? RUNTIMES.find(r => supported.includes(r.id)) || RUNTIMES[0]
        : RUNTIMES[0];
    return initRuntime.models[0] || '';
  });
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
  // Mirror hub regex — the UX must surface exactly what the hub will
  // accept, not a looser local rule. A looser client-side check would
  // let the user submit names that the server then rejects, turning
  // "validation" into a delayed failure the user has to guess at.
  const nameValid = NAME_RE.test(name.trim());
  const isRuntimeAllowed = useCallback((id: string) => {
    const supported = daemon.runtimes_supported;
    if (!Array.isArray(supported) || supported.length === 0) return true;
    return supported.includes(id);
  }, [daemon.runtimes_supported]);
  // (#3 nit ②) If the daemon's declared runtimes all sit outside our
  // known RUNTIMES list (e.g. App is older than the daemon, or the
  // daemon advertises a future-only runtime), the wizard would init
  // runtimeId to RUNTIMES[0] which is then disabled by isRuntimeAllowed
  // — canNext gates at step 1 forever, user trapped. Detect and surface
  // an empty-state instead of pretending to be functional.
  const hasUsableRuntime =
    !Array.isArray(daemon.runtimes_supported) ||
    daemon.runtimes_supported.length === 0 ||
    RUNTIMES.some(r => daemon.runtimes_supported!.includes(r.id));
  const canNext =
    hasUsableRuntime &&
    (
      (step === 0 && nameValid) ||
      (step === 1 && isRuntimeAllowed(runtimeId)) ||
      (step >= 2 && step < STEPS.length)
    );
  const busy = phase === 'creating' || phase === 'awaiting_register';

  // ── handlers (no hooks below this line) ────────────────────────────
  const handleSubmit = async () => {
    setPhase('creating');
    setMsg('');
    const numOrUndef = (v: string) => (v.trim() === '' ? undefined : Number(v));
    const node_spec: CreateNodeRequest['node_spec'] = {
      name: name.trim(),
      runtime: runtimeId,
      // model 可空（hub 自 da84f34d 起 optional/nullable）：共存 runtime
      // 的 models 为空数组，跟随宿主 TUI 登录态 —— 此时必须**省略**字段，
      // 传空串仍会被 min(1) 拒。
      ...((model || runtime.models[0]) ? { model: model || runtime.models[0] } : {}),
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
        {!hasUsableRuntime ? (
          // (#3 nit ②) Daemon advertises only runtimes this App build doesn't
          // know about — refuse to ship a wizard that can't complete.
          <View style={styles.warnCard}>
            <Text style={styles.warnTitle}>⚠  App 太旧</Text>
            <Text style={styles.warnBody}>
              {daemon.alias} 声明支持 {daemon.runtimes_supported?.join(', ') || '—'}，App 当前认识的 runtime（{RUNTIMES.map(r => r.id).join(', ')}）都不在其中。
            </Text>
            <Text style={styles.warnHint}>
              升级 App 到带这些 runtime 的版本后再来；或选另一台 host_supervisor。
            </Text>
          </View>
        ) : phase !== 'form' ? (
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
                <Text style={[styles.hint, name.trim() !== '' && !nameValid && styles.hintErr]}>
                  {NAME_RULE_HINT}
                </Text>
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
                          // Reset model to the FIRST of the new runtime
                          // (never ''). Same reasoning as initial state
                          // — hub schema requires non-empty model.
                          setModel(r.models[0] || '');
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
                {runtime.models.length === 0 ? (
                  <Text style={styles.hint}>
                    跟随宿主 TUI 的会员登录态，无需选择模型、无需输入 key。
                  </Text>
                ) : null}
                <View style={styles.choiceList}>
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
                  <SummaryRow k="模型" v={model || runtime.models[0] || '跟随宿主登录'} />
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
              <Text style={styles.secondaryBtnText}>{step === 0 ? '返回服务器' : '上一步'}</Text>
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
              {busy
                ? '请稍候…'
                : phase === 'error'
                  ? '返回修改'
                  : phase === 'done' && childUp
                    ? '完成'
                    : phase === 'done'
                      ? '去 Agents 查看'
                      : '完成'}
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
  hintErr: { color: colors.failed },

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
  primaryBtnText: { color: colors.onAccent, fontSize: 15, fontWeight: '600' },
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

  // (#3 nit ②) Empty-state warning card for App-doesn't-know-these-runtimes case.
  warnCard: {
    backgroundColor: colors.card,
    borderColor: colors.blocked,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.lg,
  },
  warnTitle: { color: colors.blocked, fontSize: 15, fontWeight: '600', marginBottom: spacing.sm },
  warnBody: { color: colors.text, fontSize: 13, lineHeight: 20, marginBottom: spacing.md },
  warnHint: { color: colors.textMuted, fontSize: 12 },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
