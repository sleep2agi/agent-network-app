// 节点详情页「模型」行的纯状态机(RFC-024 update_node_config 路径)。
//
// 不经过任何 LLM:app → hub update_node_config{model} → 节点收 SSE config_update
// → 写配置、exit 75 → 启动器原地拉起。改模型属于 apply_mode=restart,所以
// 提交后要**轮询** GET /api/nodes/:id/config,等 config_revision 抬高且 model
// 等于我们要的那个,才算 applied;hub 表里的 applied 是内容匹配快照定的,
// 不等价于「节点活着」,所以这里只信读回来的 config。
//
// 纯模块:没有 fetch、没有 React,方便 ck 测试逐个状态转移断言。

export interface NodeConfigView {
  config_revision: number;
  model: string | null;
  flags?: Record<string, unknown>;
  config_update_capable: boolean;
}

export type ModelChangePhase =
  | { kind: 'idle' }
  | { kind: 'submitting'; requested: string }
  | { kind: 'restarting'; requested: string; baseRevision: number; polls: number; previous?: string | null; hot?: boolean }
  | { kind: 'applied'; model: string; previous?: string | null }
  | { kind: 'timeout'; requested: string; previous?: string | null; hot?: boolean }
  | { kind: 'conflict' }
  | { kind: 'error'; message: string };

/** 3 s × 30 = 90 s:共存节点重启(serve + attach + 注册)实测 5–45 s。 */
export const RESTART_POLL_MS = 3000;
export const RESTART_MAX_POLLS = 30;
export const RESTART_TIMEOUT_MS = RESTART_POLL_MS * RESTART_MAX_POLLS;

/** 和向导同一条校验(非空、无空白);opencode 是 provider/model 形态,不再限字符集。 */
export function validateModelId(raw: string): { ok: true; model: string } | { ok: false; reason: string } {
  // 从文档/聊天里粘过来的常带空格：「deepseek / chat」「deepseek/ chat」。
  // 只把斜杠两侧的空白吃掉再判,别的空白仍然拒绝(那是真的填错了)。
  const model = (raw ?? '').trim().replace(/\s*\/\s*/g, '/');
  if (!model) return { ok: false, reason: '模型 id 不能为空' };
  if (/\s/.test(model)) return { ok: false, reason: '模型 id 不能含空白字符' };
  if (model.length > 200) return { ok: false, reason: '模型 id 过长(≤200)' };
  return { ok: true, model };
}

/** 三态:null = hub 没有这个接口(旧 hub);false = 节点不是在能重启它的启动器下跑的;true = 可改。 */
/**
 * 切模型能不能点 —— **与「能不能改重启级配置」是两个独立的开关**(通信欧 2026-10-31 实测):
 *   config_update_capable=false 只表示「这个进程不在会响应 sentinel-75 的 supervisor 下」,
 *   ⇒ 重启级变更不能下发;但纯 model 在 OpenCode V2 共存节点上是 hot 变更,不重启。
 *   用一个开关管两件事,会把本来能切模型的节点也灰掉。
 */
export function modelControlAvailability(
  view: NodeConfigView | null | undefined,
  opts: { hotModel?: boolean } = {},
): { enabled: boolean; hint: string } {
  if (!view) return { enabled: false, hint: '当前 Hub 未提供节点配置接口(需升级 commhub-server)' };
  if (opts.hotModel) return { enabled: true, hint: '' };
  if (!view.config_update_capable) {
    return { enabled: false, hint: '此节点不是由 anet 启动器托管的,无法远程改模型。请在它所在机器上执行 anet node edit <name> --model <id> 后重启。' };
  }
  return { enabled: true, hint: '' };
}

export type SubmitOutcome =
  | { ok: true }
  | { ok: false; conflict: true; error: string }
  | { ok: false; conflict?: false; error: string };

export function afterSubmit(
  requested: string,
  baseRevision: number,
  outcome: SubmitOutcome,
  previous?: string | null,
  opts: { hot?: boolean } = {},
): ModelChangePhase {
  if (outcome.ok) return { kind: 'restarting', requested, baseRevision, polls: 0, previous: previous ?? null, hot: opts.hot };
  if (outcome.conflict) return { kind: 'conflict' };
  return { kind: 'error', message: outcome.error };
}

/**
 * 一次轮询读回配置后的转移。view=null(读失败)算一次轮询但不改判。
 *
 * `hot`:OpenCode V2 共存节点上的纯 model 是**热变更**(节点在 198ms 内就换好,
 * 不重启、不一定抬高 config_revision)。2026-11-05 通信欧2号实测:Hub 表已 applied,
 * 客户端却因为「revision 没变」一直等到 90s 超时 —— 假超时。热变更下只要读回来的
 * model 已经是目标值就算生效,不再要求 revision 抬高。
 */
export function afterPoll(
  phase: Extract<ModelChangePhase, { kind: 'restarting' }>,
  view: NodeConfigView | null,
  maxPolls: number = RESTART_MAX_POLLS,
  opts: { hot?: boolean } = {},
): ModelChangePhase {
  // 只认 server GET 顶层 model_effective（生效模型）；缺省 = unknown，不拿配置 model 冒充会话读回。
  const effective = (view as { model_effective?: string } | null)?.model_effective;
  if (view && effective !== undefined && effective === phase.requested) {
    const bumped = view.config_revision > phase.baseRevision;
    // 重启级变更仍然要 revision 抬高(否则可能读到的是旧值);热变更不要求。
    if (bumped || opts.hot) {
      return { kind: 'applied', model: phase.requested, previous: phase.previous ?? null };
    }
  }
  const polls = phase.polls + 1;
  if (polls >= maxPolls) return { kind: 'timeout', requested: phase.requested, previous: phase.previous, hot: phase.hot };
  return { ...phase, polls };
}

export function phaseText(phase: ModelChangePhase): string {
  switch (phase.kind) {
    case 'idle': return '';
    case 'submitting': return `正在提交模型 ${phase.requested}…`;
    // 「已检查 N 次」是内部轮询计数,用户读不出意义;换成人等着的那件事:已经等了几秒、最长等几秒。
    case 'restarting': {
      const waited = Math.round(phase.polls * RESTART_POLL_MS / 1000);
      const limit = Math.round(RESTART_MAX_POLLS * RESTART_POLL_MS / 1000);
      // 热变更(OpenCode V2 纯 model)不重启,说「重启」会误导人去等节点掉线。
      if (phase.hot) return `已下发,等节点确认新模型…已等 ${waited}s / 最长 ${limit}s`;
      return `已下发,节点正在以新模型重启…已等 ${waited}s / 最长 ${limit}s`;
    }
    case 'applied': return `已切换到 ${phase.model}`;
    case 'timeout': return `已下发 ${phase.requested},但 ${RESTART_MAX_POLLS * RESTART_POLL_MS / 1000}s 内节点没有以新模型回来。请到它所在机器看日志(anet node logs)。`;
    case 'conflict': return '配置在别处被改过了,已重新加载,请再选一次。';
    case 'error': return `失败:${phase.message}`;
  }
}

/** Chips to render: the catalog's suggestions, plus the node's current model
 * prepended when the catalog does not list it. The catalog is a built-in
 * snapshot that lags the provider (mimo-v2.5-free was withdrawn while still
 * listed), so a node on an unlisted model must still see itself selected
 * rather than have its model silently disappear. Order and duplicates of
 * the catalog are preserved; `current` is never duplicated. */
export function modelChips(suggestions: readonly string[], current: string | null | undefined): string[] {
  const cur = (current ?? '').trim();
  if (!cur || suggestions.includes(cur)) return [...suggestions];
  return [cur, ...suggestions];
}

/**
 * 「当前模型不在这台机器上报的列表里」的提醒。
 *
 * 看板 #1941 / admin 2026-10-21:agent 节点拒跑最常见的原因就是配置里的模型
 * 这台机器根本没有(TMAI狗 配 grok-4.7,ACP 只有 4.6/4.5)。列表来自机器本身,
 * 所以「不在列表里」是一句可靠的提醒;但它**不是判据**——列表可能先于
 * 服务器更新,不拦提交,只把话说清楚。
 * 目录为空(读不到/没上报)或没配模型 ⇒ null,不凭空报警。
 */
export function modelNotOnMachineNote(current: string | null | undefined, catalog: readonly string[]): string | null {
  const cur = (current ?? '').trim();
  if (!cur || catalog.length === 0) return null;
  if (catalog.includes(cur)) return null;
  return `当前模型 ${cur} 不在这台机器上报的模型列表里;节点可能拒绝运行。点一个它上报的模型再保存。`;
}

/** One-line caveat under the chips for runtimes whose catalog is known to lag
 * the provider; null for runtimes with no such caveat. */
export function catalogHint(runtime: string | null | undefined): string | null {
  if (runtime === 'opencode-cli') return '候选来自内置列表,可能滞后于 OpenCode Zen 实际可用模型;选错会在重启后回件报错。';
  return null;
}

/**
 * 模型 chip 的筛选（admin 2026-10-31:OpenCodeV2 目录可能几十个模型,按 Provider 分组后
 * 一屏放不下,得能直接敲几个字找）。大小写不敏感的子串匹配,空白查询返回全部;
 * provider 名和模型名都能命中,因为整条 id 就是 `provider/model`。
 */
export function filterModels(models: readonly string[], query: string | null | undefined): string[] {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return [...models];
  return models.filter((m) => (m ?? '').toLowerCase().includes(q));
}

export function phaseIsBusy(phase: ModelChangePhase): boolean {
  return phase.kind === 'submitting' || phase.kind === 'restarting';
}

/** 把 `provider/model` 清单按 provider 分组(admin 2026-10-30:要像 OpenCode 那样按 Provider / 模型两级切换)。
 *  没有 `/` 的 id 归到「其他」;组内保持原顺序(上游已排过),组间按 provider 名排序,order 稳定才好点。 */
export function groupModelsByProvider(models: readonly string[]): { provider: string; models: string[] }[] {
  const map = new Map<string, string[]>();
  for (const id of models) {
    const raw = (id ?? '').trim();
    if (!raw) continue;
    const slash = raw.indexOf('/');
    const provider = slash > 0 ? raw.slice(0, slash) : '其他';
    const bucket = map.get(provider);
    if (bucket) bucket.push(raw);
    else map.set(provider, [raw]);
  }
  return [...map.entries()]
    .map(([provider, list]) => ({ provider, models: list }))
    .sort((a, b) => (a.provider === '其他' ? 1 : b.provider === '其他' ? -1 : a.provider.localeCompare(b.provider)));
}

/**
 * 把「当前模型所在 Provider」的分组提到最前（2026-11-03）。
 * 切模型时绝大多数动作是「在同一个 Provider 里换一个」,但分组按字母排,
 * deepseek 的用户要先滑过 anthropic/google/openai 才看到自己那一组。
 * 只移动组、不改组内顺序;当前模型没有 provider 前缀时原样返回。
 */
export function orderGroupsByCurrent<T extends { provider: string }>(
  groups: readonly T[],
  currentModel: string | null | undefined,
): T[] {
  const cur = (currentModel ?? '').trim();
  const slash = cur.indexOf('/');
  if (slash <= 0) return [...groups];
  const provider = cur.slice(0, slash);
  const idx = groups.findIndex(g => g.provider === provider);
  if (idx <= 0) return [...groups];
  return [groups[idx], ...groups.slice(0, idx), ...groups.slice(idx + 1)];
}

/**
 * 分组标题的计数后缀与一行总览（admin 2026-10-31:按 Provider 分组后,
 * 「这个 provider 到底给了几个模型」和「一共多少」光看 chip 数不出来,尤其开了筛选之后)。
 * 分组标题用 `provider · N`;总览 `共 N 个模型 · M 个 Provider`,空列表不出总览。
 */
export function groupCountLabel(group: { provider: string; models: readonly string[] }): string {
  return `${group.provider} · ${group.models.length}`;
}

/**
 * 分组标题的「当前」后缀（2026-11-03）：置顶把当前 Provider 放到最前，
 * 但置顶是视觉顺序，用户未必知道哪一组是自己正在用的。标题上标一句就行。
 */
export function groupCountLabelFor(
  group: { provider: string; models: readonly string[] },
  currentModel: string | null | undefined,
): string {
  const base = groupCountLabel(group);
  const cur = (currentModel ?? '').trim();
  const slash = cur.indexOf('/');
  if (slash <= 0) return base;
  return cur.slice(0, slash) === group.provider ? `${base} · 当前` : base;
}

export function providerGroupSummary(groups: readonly { provider: string; models: readonly string[] }[]): string | null {
  if (groups.length === 0) return null;
  const models = groups.reduce((n, g) => n + g.models.length, 0);
  return `共 ${models} 个模型 · ${groups.length} 个 Provider`;
}

/** 重启级变更(flags 等)单独一个开关:必须有能在 sentinel-75 之后把它拉起来的 supervisor。 */
export const canEditRestartTier = (view: NodeConfigView | null | undefined): boolean => !!view?.config_update_capable;

/**
 * 超时后的「再检查一次」(2026-11-05,0.2.474)。
 *
 * 90s 超时有两种真相：① 真的没切过去；② 切过去了但客户端当时没读到（热变更早期就是这样）。
 * 超时后把选择权交回用户时，只给「重新选一次」会让人以为要重下发一遍 —— 其实读一次配置就能定论。
 *   · 读回来已经是目标模型 ⇒ applied
 *   · 还不是 ⇒ 重新进入轮询（计数清零，再给一个完整窗口）
 *   · 读失败(view=null) ⇒ 保持 timeout，不假报成功
 */
export function recheckAfterTimeout(
  phase: Extract<ModelChangePhase, { kind: 'timeout' }>,
  view: NodeConfigView | null,
): ModelChangePhase {
  if (!view) return phase;
  if (view.model === phase.requested) return { kind: 'applied', model: phase.requested, previous: phase.previous ?? null };
  return { kind: 'restarting', requested: phase.requested, baseRevision: view.config_revision, polls: 0, previous: phase.previous ?? null, hot: phase.hot };
}

/**
 * 模型切换失败/超时/冲突时的一行诊断(0.486)。
 *
 * 为什么要有:用户贴回来的「切不过去」经常只有一句「失败了」,运维得反复问 node_id / runtime /
 * 从哪个模型到哪个模型 / 是超时还是报错。把这些**一次给全**,并且只给这些(不拼 token、不拼整份配置)。
 * 格式固定成 `k=v` 空格分隔,和侧栏的 `catalog=`/`gen=` 诊断行同一种读法,可以直接 grep。
 */
export type ModelChangeDiagContext = {
  nodeId?: string | null;
  runtime?: string | null;
  current?: string | null;
  target?: string | null;
};

export function modelChangeDiag(
  phase: ModelChangePhase,
  ctx: ModelChangeDiagContext,
): string | null {
  // 只有「用户需要找人帮忙」的三种状态才给诊断行;成功/进行中不用打扰。
  if (phase.kind !== 'timeout' && phase.kind !== 'error' && phase.kind !== 'conflict') return null;
  const parts = [
    'model-change',
    phase.kind === 'timeout' ? 'timeout' : phase.kind === 'error' ? 'error' : 'conflict',
    `node_id=${(ctx.nodeId ?? '').trim() || '?'}`,
    `runtime=${(ctx.runtime ?? '').trim() || '?'}`,
    `from=${(ctx.current ?? '').trim() || '?'}`,
    `target=${(ctx.target ?? '').trim() || '?'}`,
  ];
  if (phase.kind === 'timeout') {
    // 「官方口径」的超时窗口,让人知道等满过多久 —— 不是「卡了不知道多久」。
    parts.push(`waited=${Math.round(RESTART_MAX_POLLS * RESTART_POLL_MS / 1000)}s`);
    if (phase.hot) parts.push('mode=hot');
  }
  if (phase.kind === 'error') {
    // 错误消息去掉换行,保证这行能被整行复制;长度截断到 120 字符,避免把整段堆栈糊进来。
    const msg = phase.message.replace(/\s+/g, ' ').trim().slice(0, 120);
    parts.push(`error=${msg || '?'}`);
  }
  return parts.join(' ');
}

/** #4099：last_update 是否真的「已应用」——按 server/src/node-config-last-update.ts 的真实形状判定。
 *  status 必须 applied；update_id 必须存在且与本次提交对齐；requested_model 与期望模型一致。
 *  terminal=false 或 status='unknown' 一律不算 applied（「不知道结没结束」≠「结束了」）。 */
export function lastUpdateApplied(
  last: { update_id?: string | null; status?: string | null; terminal?: boolean; requested_model?: string | null } | null | undefined,
  updateId: string | undefined,
  expectedModel: string | null | undefined,
): { applied: boolean; reason: string } {
  if (!last) return { applied: false, reason: 'last_update 缺失（节点从未下发过配置或不可读）' };
  if (!updateId || last.update_id !== updateId) return { applied: false, reason: 'last_update.update_id 缺失或与本次提交不一致' };
  if (last.terminal !== true) return { applied: false, reason: 'last_update 尚未明确终局' };
  if (last.status !== 'applied') return { applied: false, reason: `last_update.status=${last.status ?? 'unknown'}` };
  if (expectedModel && last.requested_model && last.requested_model !== expectedModel) {
    return { applied: false, reason: `last_update.requested_model=${last.requested_model} 与期望不一致` };
  }
  return { applied: true, reason: 'last_update=applied 且与本次提交对齐' };
}
