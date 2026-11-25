// ACP runtime（grok-build-acp / antigravity-acp / antigravity-sdk）的模型设置。
//
// grok-build-acp 没有实时目录，走「手输模型 id + 写节点配置」。
// antigravity-acp / antigravity-sdk（agy）已有真实模型列表（节点自报 `agy_models`
// 或内置兜底），走和 OpenCode 同款的「搜索 + 分组列表 + 一键切换」，并保留折叠的
// 「自定义模型 ID」入口兜底，避免把搜索词误存成模型名（2026-11-25 线上 `carbon` 事故）。

import { suggestedModels } from './runtime-catalog';

export const ACP_MODEL_RUNTIMES = ['grok-build-acp', 'antigravity-acp', 'antigravity-sdk'] as const;

export function isAcpModelRuntime(runtime: string | null | undefined): boolean {
  const id = String(runtime ?? '').trim();
  return (ACP_MODEL_RUNTIMES as readonly string[]).includes(id);
}

export function isAgyRuntime(runtime: string | null | undefined): boolean {
  const id = String(runtime ?? '').trim();
  return id === 'antigravity-acp' || id === 'antigravity-sdk';
}

export type AcpModelChoiceResult = {
  source: 'reported' | 'fallback';
  models: string[];
};

/** #5321 —— agy 节点优先展示节点自报的 `agy_models`（来自真机 `agy models`）；
 *  尚未上报时退回内置 agy 候选（27 个实测 slug）；grok-build-acp 保持原快捷建议。 */
export function acpModelChoices(input: {
  runtime?: string | null;
  agyModels?: readonly string[] | null;
}): AcpModelChoiceResult {
  if (isAgyRuntime(input.runtime)) {
    const reported: string[] = [];
    const seen = new Set<string>();
    if (Array.isArray(input.agyModels)) {
      for (const raw of input.agyModels) {
        const clean = typeof raw === 'string' ? raw.trim() : '';
        if (!clean || clean.length > 120 || /[\s\u0000-\u001f\u007f]/.test(clean) || seen.has(clean)) continue;
        seen.add(clean);
        reported.push(clean);
      }
    }
    if (reported.length > 0) return { source: 'reported', models: reported };
    return { source: 'fallback', models: suggestedModels('antigravity-acp') };
  }
  return { source: 'fallback', models: ACP_MODEL_SUGGESTIONS.flatMap(g => [...g.ids]) };
}

/** agy 常见模型 id 的候选（只做提示，允许任意输入；不声称是完整清单）。
 *  来源：负责人在 ANet反重力 上的真机验证（`anet node edit --model` 实际跑通的 id），
 *  以及 runtime 侧 `applyConfiguredModel()` 能透传的同一批 vendor。 */
export const ACP_MODEL_SUGGESTIONS: ReadonlyArray<{ vendor: string; ids: ReadonlyArray<string> }> = [
  { vendor: 'Claude', ids: ['claude-opus-5-5-high', 'claude-sonnet-5-5-high'] },
  { vendor: 'Gemini', ids: ['gemini-3.8-flash-high', 'gemini-pro-orchestrator'] },
  { vendor: 'OpenAI', ids: ['gpt-oss-120b'] },
];

export type AcpModelDraft = { ok: true; value: string } | { ok: false; error: 'invalid_model_id' };

/** 模型 id 的本地校验：trim 后非空、无空白/控制字符、长度上限 120。 */
export function normalizeAcpModelId(input: string): AcpModelDraft {
  const value = String(input ?? '').trim();
  if (!value || value.length > 120 || /[\s\u0000-\u001f\u007f]/.test(value)) return { ok: false, error: 'invalid_model_id' };
  return { ok: true, value };
}

export function acpModelErrorText(code: string): string {
  if (code === 'invalid_model_id') return '模型 id 不能为空、不能带空格或控制字符，最长 120。';
  return code;
}

export interface AgyModelItem {
  id: string;
  label: string;
  group: string;
  level: string | null;
}

export interface AgyModelRow extends AgyModelItem {
  current: boolean;
}

export interface AgyModelGroup {
  group: string;
  count: number;
  rows: AgyModelRow[];
}

const LEVEL_LABELS: Record<string, string> = {
  xhigh: 'XHigh',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const capitalize = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** 把 `agy` 的模型 slug 解析为可读名称、分组与档位，方便在命令面板里分组展示和搜索。 */
export function describeAgyModel(rawId: string): AgyModelItem {
  const id = rawId.trim();
  const lower = id.toLowerCase();

  // gemini-4-neon-xhigh / gemini-4-carbon-high / ...
  const g4 = lower.match(/^gemini-4-([a-z0-9]+)-(xhigh|high|medium|low)$/);
  if (g4) {
    return { id, group: 'Gemini 4', label: `Gemini 4 ${capitalize(g4[1])}`, level: LEVEL_LABELS[g4[2]] };
  }
  const g4Bare = lower.match(/^gemini-4-([a-z0-9]+)$/);
  if (g4Bare) {
    return { id, group: 'Gemini 4', label: `Gemini 4 ${capitalize(g4Bare[1])}`, level: null };
  }

  // gemini-pro-orchestrator / gemini-pro-orchestrator-neon / -argon
  if (lower === 'gemini-pro-orchestrator') {
    return { id, group: 'Orchestrator', label: 'Orchestrator (Carbon)', level: null };
  }
  const orch = lower.match(/^gemini-pro-orchestrator-([a-z0-9]+)$/);
  if (orch) {
    return { id, group: 'Orchestrator', label: `Orchestrator (${capitalize(orch[1])})`, level: null };
  }

  // gemini-3.8-flash-high
  const g38 = lower.match(/^gemini-([0-9.]+)-([a-z0-9]+)-(xhigh|high|medium|low)$/);
  if (g38) {
    return { id, group: `Gemini ${g38[1]}`, label: `Gemini ${g38[1]} ${capitalize(g38[2])}`, level: LEVEL_LABELS[g38[3]] };
  }

  // claude-opus-5-5-high / claude-sonnet-5-5-medium
  const claude = lower.match(/^claude-([a-z]+)-([0-9]+)-([0-9]+)(?:-(xhigh|high|medium|low))?$/);
  if (claude) {
    return {
      id,
      group: 'Claude',
      label: `Claude ${capitalize(claude[1])} ${claude[2]}.${claude[3]}`,
      level: claude[4] ? LEVEL_LABELS[claude[4]] : null,
    };
  }

  // gpt-oss-120b-medium
  const gptOss = lower.match(/^gpt-oss-([0-9]+[a-z]?)(?:-(xhigh|high|medium|low))?$/);
  if (gptOss) {
    return {
      id,
      group: 'OpenAI',
      label: `GPT-OSS ${gptOss[1].toUpperCase()}`,
      level: gptOss[2] ? LEVEL_LABELS[gptOss[2]] : null,
    };
  }

  const tailLevel = lower.match(/^(.*)-(xhigh|high|medium|low)$/);
  const level = tailLevel ? LEVEL_LABELS[tailLevel[2]] : null;
  const group = lower.startsWith('gemini') ? 'Gemini'
    : lower.startsWith('claude') ? 'Claude'
    : lower.startsWith('gpt') || lower.startsWith('o1') || lower.startsWith('o3') ? 'OpenAI'
    : '其他';
  return { id, group, label: id, level };
}

/** 对 agy 模型清单做实时搜索过滤与分组（当前模型所在组置顶，组内保序）。 */
export function filterAndGroupAgyModels(input: {
  models: readonly string[];
  query?: string | null;
  currentModel?: string | null;
}): { groups: AgyModelGroup[]; total: number; catalogTotal: number } {
  const cur = (input.currentModel ?? '').trim();
  const items = input.models.map(describeAgyModel);
  const q = (input.query ?? '').trim().toLowerCase();
  const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
  const matched = tokens.length === 0
    ? items
    : items.filter(item => {
        const hay = `${item.id} ${item.label} ${item.group} ${item.level ?? ''}`.toLowerCase();
        return tokens.every(tok => hay.includes(tok));
      });

  const buckets = new Map<string, AgyModelRow[]>();
  for (const item of matched) {
    const row: AgyModelRow = { ...item, current: cur !== '' && item.id === cur };
    const list = buckets.get(item.group);
    if (list) list.push(row);
    else buckets.set(item.group, [row]);
  }
  const groups: AgyModelGroup[] = [...buckets.entries()].map(([group, rows]) => ({
    group,
    count: rows.length,
    rows,
  }));
  const curIdx = cur ? groups.findIndex(g => g.rows.some(r => r.current)) : -1;
  const ordered = curIdx > 0
    ? [groups[curIdx], ...groups.slice(0, curIdx), ...groups.slice(curIdx + 1)]
    : groups;
  return { groups: ordered, total: matched.length, catalogTotal: items.length };
}

export type AcpSaveOutcome =
  | { kind: 'applied'; hot: boolean }
  | { kind: 'restarting' }
  | { kind: 'failed'; reason: string };

/** 判定 ACP `updateNodeConfig` 下发后的真实状态。
 *
 *  2026-11-25 线上 Bug 修复：此前 `saveAcpModel` 下发完立刻读一次 `fetchNodeConfig`，
 *  只要 `after.model !== checked.value` 就报红字「配置回读与写入不一致，请重试」——
 *  而对 `mode=restart` 节点，Hub 的 `config_snapshot.model` 要等节点重启上报才变，
 *  立刻读必然是旧值，等于次次假报错，且早退还不更新 `config_revision` 引发后续死循环冲突。
 */
export function classifyAcpSaveOutcome(input: {
  applyMode?: string | null;
  after: {
    model?: string | null;
    config_revision?: number;
    last_update?: {
      update_id?: string | null;
      status?: string | null;
      requested_model?: string | null;
      error?: string | null;
    } | null;
  } | null;
  updateId?: string;
  requested: string;
  baseRevision?: number;
}): AcpSaveOutcome {
  const after = input.after;
  const last = after?.last_update;
  const sameUpdate = !!input.updateId && !!last?.update_id && last.update_id === input.updateId;

  if (sameUpdate) {
    if (last?.status === 'rejected' || last?.status === 'failed' || last?.status === 'timeout') {
      return { kind: 'failed', reason: last.error?.trim() || last.status };
    }
    if (last?.status === 'applied') {
      return { kind: 'applied', hot: input.applyMode === 'hot' };
    }
    if (last?.status === 'pending' || last?.status === 'restarting') {
      return { kind: 'restarting' };
    }
  }

  const modelMatches = typeof after?.model === 'string' && after.model.trim() === input.requested;
  const revBumped = typeof input.baseRevision === 'number'
    && typeof after?.config_revision === 'number'
    && after.config_revision > input.baseRevision;
  if (modelMatches && (revBumped || input.applyMode === 'hot' || !input.updateId)) {
    return { kind: 'applied', hot: input.applyMode === 'hot' };
  }

  // Hub 已受理下发（res.ok === true）但节点尚未完成重启/回报快照：如实告知正在生效，不误报不一致。
  return { kind: 'restarting' };
}
