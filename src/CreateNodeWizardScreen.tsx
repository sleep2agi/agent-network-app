import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { createNode, CreateNodeRequest, fetchStatus, HostSupervisorDaemon, HubConfig, Session, fetchCreateRequestStatus } from './api';
import { createRequestVerdict, timeoutMessage, type CreateRequestVerdict } from './create-request-status';
import { colors, onThemeChange, spacing, radius } from './theme';
import { advancedExpanded, advancedRuntimesOf, primaryRuntimes, runtimeDisplayLabel, showsAdvancedToggle, type WizardRuntime } from './wizard-runtime-groups';
import { PANE_BACK_TEST_ID, paneShowsBack } from './pane-header';
import { buildCreateNodeSpec, describeCopresenceError, NO_PARAMS_LINE, wizardParamsFor } from './create-node-request';
import { defaultWorkdir, describeWorkdirError, randomHex6, workdirError, workdirForRequest, workdirRootOf, workdirSlug } from './create-node-workdir';
import { buttonStyle, buttonTextStyle } from './elevation';

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

const RUNTIMES: WizardRuntime[] = [
  { id: 'claude-agent-sdk', label: 'Claude Agent SDK', models: ['deepseek-v4-pro', 'MiniMax-M3', 'claude-sonnet-4-6', 'claude-opus-4-x'] },
  { id: 'codex-sdk', label: 'Codex SDK', models: ['gpt-5.5'] },
  // Grok 只显示一行,建出来是 headless ACP(owner 2026-09-25 定为默认/推荐)。
  { id: 'grok-build-acp', label: 'Grok', models: ['grok-build'] },
  // 共存 runtime：复用宿主 TUI 的会员登录态，不选模型、不输 key。
  // models 为空数组 ⇒ 第 3 步显示「跟随宿主登录」，提交时省略 model
  // 字段（hub 侧自 da84f34d 起 model optional/nullable）。
  { id: 'claude-code-cli', label: 'Claude Code（TUI 共存）', models: [] },
  { id: 'codex-app-server', label: 'Codex（TUI 共存）', models: [] },
  // grok TUI 共存降为「实验性」(owner 2026-09-25):不进主列表,收在 Grok 行的「高级」折叠里,
  // 展开即显示限制。id 不变 ⇒ 已有的 grok-build-cli 节点不受影响。
  { id: 'grok-build-cli', label: '共存模式（实验性）', models: [], advancedOf: 'grok-build-acp', note: '实验性：人在 TUI 输入框打字时网络任务会排队直到超时；grok 须钉在已验证版本（新版会拒绝启动）；macOS 需特殊处理；不加载 .agents/skills 技能。要稳定接活用上面的 Grok（ACP，默认）。' },
  // #199 —— hub / daemon / CLI 三处的 runtime 全集都是 7 个,只有这里是 6 个。
  // `opencode-cli` 出现在 agent-network/src/codex-copresence-profile.ts:223 的共存
  // profile 里。(目录名叫 opencode-**acp**,但 runtime id 只有 opencode-**cli** ——
  //  normalize-runtime.ts:108 把两者归一。)
  // 🔴 与上面三个不同:OpenCode 共存 runtime **要求显式 provider/model**
  //  (agent-node opencode-copresence/runtime.ts requireOpenCodeCopresenceModel),
  //  models 留空 ⇒ 提交省略 model ⇒ daemon 起子节点时「OpenCode copresence requires an explicit
  //  provider/model」(2026-09-07 Mac mini 真跑抓到)。这里给 OpenCode 自带的免费模型(不需要任何 key,
  //  DEV 上 opencode-指挥狗 / opencode测试1号 就用它们);要用别的 provider 走 anet opencode auth-login。
  { id: 'opencode-cli', label: 'OpenCode（TUI 共存）', models: ['opencode/mimo-v2.6-flash-free', 'opencode/north-mini-code-free'] },
];
const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];
const STEPS = ['名字', 'Runtime', '模型', '参数', '确认'];

type Phase = 'form' | 'creating' | 'awaiting_register' | 'done' | 'error';

export interface CreateNodeWizardScreenProps {
  cfg: HubConfig;
  daemon: HostSupervisorDaemon;
  onBack: () => void;       // back to picker
  onExit: () => void;       // close wizard entirely (after done or cancel)
  /** Tauri desktop workspace: the server sidebar selects this page — no phone back in the header
   *  (pane-header.ts). The footer's 「返回服务器」 step button stays: it is part of the flow. */
  desktop?: boolean;
}

export default function CreateNodeWizardScreen({ cfg, daemon, onBack, onExit, desktop = false }: CreateNodeWizardScreenProps) {
  // ── All hooks FIRST (no conditional-hook regressions) ──────────────
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [runtimeId, setRuntimeId] = useState(() => {
    // Initial runtime: first supported by daemon if it published; else default.
    const supported = daemon.runtimes_supported;
    if (Array.isArray(supported) && supported.length > 0) {
      // 先在主列表里找,找不到才落到「高级」折叠项(不把实验性 runtime 当默认)。
      const match = primaryRuntimes(RUNTIMES).find(r => supported.includes(r.id))
        ?? RUNTIMES.find(r => supported.includes(r.id));
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
        ? primaryRuntimes(RUNTIMES).find(r => supported.includes(r.id)) || RUNTIMES.find(r => supported.includes(r.id)) || RUNTIMES[0]
        : RUNTIMES[0];
    return initRuntime.models[0] || '';
  });
  // 「高级」折叠(目前只有 Grok 行有:共存模式·实验性)。默认收起。
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [permissionMode, setPermissionMode] = useState('default');
  const [maxTurns, setMaxTurns] = useState('');
  const [budget, setBudget] = useState('');
  // 工作目录:null = 没改过,跟着名字走(<root>/<name>);改过之后固定为用户填的值。
  const [workdirEdited, setWorkdirEdited] = useState<string | null>(null);
  const [workdirOpen, setWorkdirOpen] = useState(false);
  // 名字转不出 ASCII 时的兜底目录名;整个向导里固定一个,不随重渲染变。
  const [workdirFallback] = useState(() => `node-${randomHex6()}`);
  const [phase, setPhase] = useState<Phase>('form');
  const [msg, setMsg] = useState('');

  // childUp = the child alias has appeared in fetchStatus → success
  // confirmed (claim=reality). We poll up to ~24s before giving up
  // and showing an "unconfirmed" message — matches dashboard wizard.
  const [childUp, setChildUp] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
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
    let lastVerdict: CreateRequestVerdict = { kind: 'unknown' };
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
      // 同一轮顺带问 hub:daemon 对这次 create 说了什么。它明确说失败就别再等了,把原因摆出来
      // (Vincent 2026-09-07:Mac 上 opencode 共存起不来,向导只会说「24s 没注册」)。老 hub 404 → unknown。
      if (requestId) {
        try {
          lastVerdict = createRequestVerdict(await fetchCreateRequestStatus(cfg, requestId));
          if (pollAlive.current && lastVerdict.kind === 'failed') {
            setPhase('error');
            setMsg(`创建失败:${lastVerdict.text}`);
            return;
          }
          if (pollAlive.current && lastVerdict.kind === 'waiting') setMsg(lastVerdict.text);
        } catch { /* 读不到就按原来的方式等 */ }
      }
      if (pollAlive.current && tries < 16) {
        setTimeout(tick, 1500);
      } else if (pollAlive.current) {
        // Timeout — don't flip to error (hub may have accepted the dispatch
        // but the child is slow to bootstrap). Honest message.
        setPhase('done');
        setMsg(timeoutMessage(lastVerdict));
      }
    };
    const t = setTimeout(tick, 1200);
    return () => { clearTimeout(t); };
  }, [phase, childUp, cfg, name, requestId]);

  // Derived: runtime details + nav gates
  const runtime = RUNTIMES.find(r => r.id === runtimeId) || RUNTIMES[0];
  // #591 —— 第 4 步「参数」只摆这个 runtime 真会读的设置。
  const params = wizardParamsFor(runtimeId);
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
  // 老 daemon/hub 不带 default_workdir_root → null → 整行隐藏、请求不带 workdir。
  const workdirRoot = workdirRootOf(daemon);
  const workdir = workdirEdited ?? (workdirRoot ? defaultWorkdir(workdirRoot, workdirSlug(name, workdirFallback)) : '');
  const workdirErr = workdirRoot ? workdirError(workdir, workdirRoot) : null;
  const canSubmit = !workdirErr;

  // ── handlers (no hooks below this line) ────────────────────────────
  // One runtime choice row. `nested` = it lives inside a 「高级」 disclosure:
  // indented, and its note (the experimental warning) shows as soon as the
  // disclosure is open — the cost is visible BEFORE it is picked.
  const renderRuntimeRow = (r: WizardRuntime, nested: boolean) => {
    const allowed = isRuntimeAllowed(r.id);
    const selected = runtimeId === r.id;
    const showNote = !!r.note && allowed && (selected || nested);
    return (
      <Fragment key={r.id}>
        <Pressable
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
            nested && styles.choiceRowNested,
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
        {showNote ? (
          <Text style={[styles.hint, nested && styles.hintNested]}>{r.note}</Text>
        ) : null}
      </Fragment>
    );
  };
  const handleSubmit = async () => {
    setPhase('creating');
    setMsg('');
    // flags.copresence:true 只给「Codex（TUI 共存）」(codex-app-server),见 create-node-request.ts。
    const node_spec: CreateNodeRequest['node_spec'] = buildCreateNodeSpec({
      name, runtimeId, model, runtimeModels: runtime.models,
      permissionMode, maxTurns, budget,
      workdirField: workdirForRequest(workdirRoot, workdir),
    });
    const res = await createNode(cfg, {
      daemon_node_id: daemon.daemon_node_id,
      node_spec,
    });
    if (res.ok) {
      // Hub accepted dispatch. Now POLL to confirm child registered.
      setRequestId(res.request_id ?? null);
      setPhase('awaiting_register');
      setMsg('创建请求已下发，正在监测子节点注册…');
    } else if (res.unconfirmed) {
      setPhase('error');
      setMsg(`服务器未就绪：${res.error}`);
    } else {
      setPhase('error');
      setMsg(`创建失败：${describeCopresenceError({ error: res.error, field: res.field, runtime: runtimeId }) ?? describeWorkdirError(res.error) ?? res.error}`);
    }
  };

  // ── render ─────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      {paneShowsBack(desktop) ? (
        <View style={styles.header} testID="screen-header">
          <Pressable
            testID={PANE_BACK_TEST_ID}
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
      ) : (
        <View style={[styles.header, styles.headerWide]} testID="screen-header">
          <Text style={[styles.headerTitle, styles.headerTitleWide]}>新建节点</Text>
        </View>
      )}

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
                {primaryRuntimes(RUNTIMES).map(r => {
                  // 「高级」折叠:只挂在有折叠项的行下面(目前是 Grok → 共存模式·实验性),
                  // 且只在该行(或其折叠项)被选中时出现,不给其他 runtime 添噪音。
                  const kids = advancedRuntimesOf(RUNTIMES, r.id);
                  const toggle = showsAdvancedToggle(RUNTIMES, r.id, runtimeId);
                  const open = advancedExpanded(RUNTIMES, r.id, runtimeId, advancedOpen);
                  return (
                    <Fragment key={r.id}>
                      {renderRuntimeRow(r, false)}
                      {toggle ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="高级"
                          accessibilityState={{ expanded: open }}
                          onPress={() => setAdvancedOpen(!open)}
                          hitSlop={6}
                          style={({ pressed }) => [styles.advancedToggle, pressed && { opacity: 0.6 }]}
                        >
                          <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={13} color={colors.textMuted} />
                          <Text style={styles.advancedToggleText}>高级</Text>
                        </Pressable>
                      ) : null}
                      {open ? kids.map(k => renderRuntimeRow(k, true)) : null}
                    </Fragment>
                  );
                })}
              </View>
            )}

            {step === 2 && (
              <View style={styles.section}>
                <Text style={styles.label}>模型（{runtimeDisplayLabel(RUNTIMES, runtime)}）</Text>
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
              <View style={styles.section} testID="create-params-step">
                {/* #591 —— 只显示这个 runtime 真会读的设置(矩阵与依据见 create-node-request.ts)。 */}
                {params.length === 0 ? (
                  <Text style={styles.noParams} testID="create-params-none">{NO_PARAMS_LINE}</Text>
                ) : null}
                {params.includes('permissionMode') ? (
                  <>
                    <Text style={styles.label}>permissionMode</Text>
                    <View style={styles.choiceList} testID="create-param-permissionMode">
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
                  </>
                ) : null}

                {params.includes('maxTurns') || params.includes('budget') ? (
                  <>
                    <Text style={[styles.label, params.includes('permissionMode') && { marginTop: spacing.lg }]}>限制（可空）</Text>
                    <View style={styles.row3}>
                      {params.includes('maxTurns') ? (
                        <View style={styles.row3Cell} testID="create-param-maxTurns">
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
                      ) : null}
                      {params.includes('budget') ? (
                        <View style={styles.row3Cell} testID="create-param-budget">
                          <Text style={styles.subLabel}>budget（美元）</Text>
                          <TextInput
                            value={budget}
                            onChangeText={setBudget}
                            placeholder="—"
                            placeholderTextColor={colors.textMuted}
                            style={styles.input}
                            keyboardType="numeric"
                          />
                        </View>
                      ) : null}
                    </View>
                  </>
                ) : null}
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
                  <SummaryRow k="Runtime" v={runtimeDisplayLabel(RUNTIMES, runtime)} />
                  <Divider />
                  <SummaryRow k="模型" v={model || runtime.models[0] || '跟随宿主登录'} />
                  {params.includes('permissionMode') ? (
                    <>
                      <Divider />
                      <SummaryRow k="permissionMode" v={permissionMode} />
                    </>
                  ) : null}
                  {params.includes('maxTurns') || params.includes('budget') ? (
                    <>
                      <Divider />
                      <SummaryRow k="maxTurns / budget" v={`${maxTurns || '—'} / ${budget || '—'}`} />
                    </>
                  ) : null}
                  {workdirRoot ? (
                    <>
                      <Divider />
                      <View style={styles.summaryRow} testID="create-workdir-row">
                        <Text style={styles.summaryKey}>工作目录</Text>
                        <View style={styles.summaryValWithAction}>
                        <Text style={styles.summaryVal} numberOfLines={2} testID="create-workdir-value">{workdir}</Text>
                        <Pressable
                          testID="create-workdir-edit"
                          onPress={() => setWorkdirOpen(o => !o)}
                          hitSlop={8}
                          accessibilityLabel={workdirOpen ? '收起工作目录编辑' : '修改工作目录'}
                          style={({ pressed }) => [styles.summaryEdit, pressed && { opacity: 0.6 }]}
                        >
                          <Text style={styles.summaryEditText}>{workdirOpen ? '收起' : '改'}</Text>
                        </Pressable>
                        </View>
                      </View>
                      {workdirOpen ? (
                        <View style={styles.summaryEditor}>
                          <TextInput
                            testID="create-workdir-input"
                            autoFocus
                            value={workdir}
                            onChangeText={setWorkdirEdited}
                            placeholder={defaultWorkdir(workdirRoot, workdirSlug(name, 'my-agent-1'))}
                            placeholderTextColor={colors.textMuted}
                            style={styles.input}
                            autoCapitalize="none"
                            autoCorrect={false}
                          />
                          <Text style={[styles.hint, !!workdirErr && styles.hintErr]}>
                            {workdirErr ?? '每个节点一个独立目录；不存在会自动创建。'}
                          </Text>
                        </View>
                      ) : workdirErr ? (
                        <Text style={[styles.hint, styles.hintErr, styles.summaryEditor]}>{workdirErr}</Text>
                      ) : null}
                    </>
                  ) : null}
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
                testID="create-node-submit"
                disabled={!canSubmit}
                onPress={handleSubmit}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  !canSubmit && styles.primaryBtnDisabled,
                  pressed && canSubmit && { opacity: 0.8 },
                ]}
              >
                <Text style={[styles.primaryBtnText, !canSubmit && styles.primaryBtnTextDisabled]}>创建节点</Text>
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
  // Desktop: title on the content's left edge, same header height as the phone one (40 + 2×8 + 1).
  headerWide: { paddingHorizontal: spacing.lg, minHeight: 57 },
  headerTitleWide: { textAlign: 'left' },

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
  stepBar: { height: 3, width: '100%', borderRadius: radius.pill, backgroundColor: colors.border },
  stepBarActive: { backgroundColor: colors.accent },
  stepLabel: { color: colors.textMuted, fontSize: 10 },
  stepLabelActive: { color: colors.accent },

  bodyScroll: { flex: 1 },
  bodyContent: { padding: spacing.lg },

  section: { gap: spacing.sm },
  label: { color: colors.textMuted, fontSize: 12 },
  subLabel: { color: colors.textMuted, fontSize: 11 },
  hint: { color: colors.textMuted, fontSize: 11 },
  noParams: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  hintErr: { color: colors.failed },

  input: {
    backgroundColor: colors.inputBg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.control,
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
    borderRadius: radius.control,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  choiceRowSelected: { borderColor: colors.accent, backgroundColor: colors.card },
  choiceRowDisabled: { opacity: 0.55, backgroundColor: colors.bg },
  choiceText: { color: colors.text, fontSize: 14 },
  choiceTextSelected: { color: colors.accent, fontWeight: '600' },
  choiceTextDisabled: { color: colors.textMuted },
  choiceUnsupported: { color: colors.textMuted, fontSize: 11 },
  // 「高级」折叠开关 + 折叠里的行:紧凑,缩进一级,不抢主列表的视觉权重。
  advancedToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 2, paddingHorizontal: spacing.xs },
  advancedToggleText: { color: colors.textMuted, fontSize: 12 },
  choiceRowNested: { marginLeft: spacing.lg },
  hintNested: { marginLeft: spacing.lg, color: colors.blocked },

  row3: { flexDirection: 'row', gap: spacing.sm },
  row3Cell: { flex: 1, gap: spacing.xs },

  summaryCard: {
    backgroundColor: colors.card,
    borderRadius: radius.surface,
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
  // 「改」:值列右侧一个紧凑的文字按钮;行的左右内边距与其他确认行一致(同一个 summaryRow)。
  // 值 +「改」共一条中线(「改」是 CJK 字形,行盒比 ASCII 路径高,顶对齐会差 1–2px)。
  summaryValWithAction: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  summaryEdit: { flexShrink: 0 },
  summaryEditText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  summaryEditor: { gap: spacing.xs, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
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
  primaryBtn: { ...buttonStyle('primary'), flex: 1 },
  primaryBtnDisabled: { backgroundColor: colors.border },
  primaryBtnText: { ...buttonTextStyle('primary') },
  primaryBtnTextDisabled: { color: colors.textMuted },
  secondaryBtn: { ...buttonStyle('secondary'), flex: 1 },
  secondaryBtnText: { ...buttonTextStyle('secondary') },

  // (#3 nit ②) Empty-state warning card for App-doesn't-know-these-runtimes case.
  warnCard: {
    backgroundColor: colors.card,
    borderColor: colors.blocked,
    borderWidth: 1,
    borderRadius: radius.surface,
    padding: spacing.lg,
  },
  warnTitle: { color: colors.blocked, fontSize: 15, fontWeight: '600', marginBottom: spacing.sm },
  warnBody: { color: colors.text, fontSize: 13, lineHeight: 20, marginBottom: spacing.md },
  warnHint: { color: colors.textMuted, fontSize: 12 },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
