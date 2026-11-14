// #4099 客户端 modelVariant 契约（对齐 server/agent-node f2ad9629 的准确语义）
//
// 契约（读自共享树 /tmp/opencode/anet-4099-node-variant）：
// · patch.modelVariant: **省略 = 沿旧 model 语义不修改档**；**null = 显式清除**；**string = 选中档位**；
// · string 约束：1..200 字符，且**不得含空白/控制字符**（server 侧 invalid_patch）；
// · 能力门：节点 config_snapshot 里必须 `opencode_variant_config_capable === true`（server 侧 variant_unsupported）；
// · modelVariant 与 flags/channels 不可同时出现；
// · apply_mode：带 modelVariant 即 hot（f2ad9629 server/src/tools.ts:3923）。
// 纯逻辑，不 import react-native。

export interface NodePatchInput {
  model?: string;
  modelVariant?: string | null;
  flags?: Record<string, unknown>;
}

/** 序列化 patch：**只有显式给出 modelVariant 才写**（null 也照写 → 清除档位）。 */
export function buildConfigPatch(input: NodePatchInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (typeof input.model === 'string' && input.model.length > 0) patch.model = input.model;
  if (Object.prototype.hasOwnProperty.call(input, 'modelVariant')) patch.modelVariant = input.modelVariant;
  if (input.flags && typeof input.flags === 'object' && Object.keys(input.flags).length) patch.flags = input.flags;
  return patch;
}

const VARIANT_RE = /^[^\s\x00-\x1f\x7f]{1,200}$/;

/** 客户端侧预检（与 server 同口径，避免明知会 invalid_patch 还发出去）。 */
export function variantValueError(value: unknown): string | null {
  if (value === undefined || value === null) return null;   // 省略/清除都合法
  if (typeof value !== 'string') return '档位必须是字符串';
  if (!VARIANT_RE.test(value)) return '档位不能含空白或控制字符（1–200 字符）';
  return null;
}

/** 档位可写性：必须节点显式声明能力；runtime 必须是 opencode 系。 */
export function variantWritable(input: { variantCapable?: boolean | null; runtime?: string | null }): { ok: boolean; reason: string } {
  const rt = (input.runtime ?? '').trim();
  // The Hub reports agent-node OpenCode nodes as `opencode-sdk` (and hand-started ones as
  // `opencode-cli`); both are OpenCode. Pinning `opencode-cli` greyed the 档位 picker out
  // ("未知") on every opencode-sdk node. Capability is still required below.
  const opencodeRt = rt === 'opencode' || rt.startsWith('opencode-');
  if (!opencodeRt) return { ok: false, reason: `当前 runtime（${rt || '未上报'}）不支持档位写入` };
  if (input.variantCapable !== true) return { ok: false, reason: '该节点未声明 opencode_variant_config_capable，不能写档位' };
  return { ok: true, reason: '可写：带 modelVariant 的 patch 会以 hot 方式应用' };
}

export type VariantChoices =
  | { kind: 'unknown'; options: [] }
  | { kind: 'none'; options: [] }
  | { kind: 'list'; options: string[] };

/** 目录里的档位：undefined = 未知；[] = 明确没有；非空 = 可选（去重保序）。 */
export function variantChoices(variants: unknown): VariantChoices {
  if (!Array.isArray(variants)) return { kind: 'unknown', options: [] };
  const list = [...new Set(variants.filter((v): v is string => typeof v === 'string' && v.length > 0))];
  return list.length ? { kind: 'list', options: list } : { kind: 'none', options: [] };
}

// ── #4099 档位写入的观测窗口 ────────────────────────────────────────────────
// 2026-11-10 真节点实测：写档位 Hub 很快回 applied，OpenCode 会话 ~20s 内翻转，
// 而 Hub 快照的**顶层 modelVariant** 要等下一次心跳（几十秒）才跟上。
// 所以「提交后立刻读一次、读不到就报错」必然把**成功**的切换报成红色失败。
// 与改模型同构：提交 → 观测窗口（60s，每 3s 读一次）→ 双条件确认后才算成功。

export const VARIANT_POLL_MS = 3000;
export const VARIANT_MAX_POLLS = 50;
/** 3 s × 20 = 60 s：足够跨过 Hub 那一两次心跳，又不至于让人以为卡死。 */
export const VARIANT_TIMEOUT_MS = 150_000;

/**
 * 一次档位写入的判定结果（纯数据，界面只负责上色）。
 * 四种结局的**措辞**是刻意的：它们的修法不同，不能都糊成一句「失败了」。
 */
export type VariantOutcome =
  | { kind: 'applied'; tone: 'success'; text: string }
  | { kind: 'lagging'; tone: 'neutral'; text: string }
  | { kind: 'busy'; tone: 'neutral'; text: string }
  | { kind: 'failed'; tone: 'error'; text: string; code: string };

const VARIANT_BUSY_RE = /variant_busy/i;

/** `variant_busy` 不是失败：节点自己的 writer 已经等过一整轮，档位会在下一轮生效。 */
function isVariantBusy(raw: string): boolean {
  if (!raw) return false;
  return VARIANT_BUSY_RE.test(raw) || raw.trim().toLowerCase() === 'busy';
}

/**
 * 把「窗口内读到的最后一帧」分类成四种结局之一。
 *
 * · applied + 顶层 modelVariant 一致 → 成功（清除档位时目标是 null，读到 null 才算）；
 * · applied 但 modelVariant 还没跟上 → 快照滞后（写入是好的，**别重发**，等心跳）；
 * · `variant_busy` → 这一轮还在跑（非失败，跑完再切）；
 * · 其它 → 原样给出错误码/消息，不做二次解释。
 *
 * 顶层 modelVariant 才是 server 的真相；config_snapshot 里的兼容投影滞后更多，
 * 不参与这里的判定（见 api.ts 的 NodeConfigRead）。
 */
export function describeVariantOutcome(input: {
  applied: boolean;
  variantMatches: boolean;
  target?: string | null;
  lastStatus?: string | null;
  lastError?: string | null;
}): VariantOutcome {
  const target = typeof input.target === 'string' && input.target.length > 0 ? input.target : null;
  if (input.applied && input.variantMatches) {
    return {
      kind: 'applied',
      tone: 'success',
      text: target ? `已切换到档位 ${target}` : '已清除档位（当前没有档位）',
    };
  }
  if (input.applied) {
    return {
      kind: 'lagging',
      tone: 'neutral',
      text: '写入已确认，但快照未跟上：Hub 的 modelVariant 要等下一次心跳才对齐（通常几十秒），继续等一会或点「再检查一次」，不用重下发。',
    };
  }
  const raw = String(input.lastError ?? '').trim() || String(input.lastStatus ?? '').trim();
  if (isVariantBusy(raw)) {
    return {
      kind: 'busy',
      tone: 'neutral',
      text: '这一轮还在跑，档位会对下一轮生效 —— 跑完再切。不是失败，不用重发。',
    };
  }
  const code = raw || 'unknown';
  return { kind: 'failed', tone: 'error', text: `失败：${code}`, code };
}

/**
 * 档位写入自己的状态机（与 ModelChangePhase 并列，不混用）：
 * 档位改动**不改 model**，所以 model 那条按 `model_effective === requested` 确认的窗口
 * 会在第一次读回就假成功 —— 确认条件必须是 last_update + 顶层 modelVariant。
 */
export type VariantChangePhase =
  | { kind: 'idle' }
  | { kind: 'submitting'; target: string | null }
  | { kind: 'verifying'; target: string | null; polls: number }
  | {
    kind: 'result';
    target: string | null;
    /** 再检查一次要复用的提交回执（只读重判，不重发）。 */
    effectiveModel?: string | null;
    updateId?: string;
    outcome: VariantOutcome;
  };

export function variantPhaseBusy(phase: VariantChangePhase): boolean {
  return phase.kind === 'submitting' || phase.kind === 'verifying';
}

export function variantPhaseText(phase: VariantChangePhase): string {
  switch (phase.kind) {
    case 'idle': return '';
    case 'submitting': return phase.target ? `正在提交档位 ${phase.target}…` : '正在提交「清除档位」…';
    case 'verifying': {
      const waited = Math.round(phase.polls * VARIANT_POLL_MS / 1000);
      const limit = Math.round(VARIANT_TIMEOUT_MS / 1000);
      const what = phase.target ? `档位 ${phase.target}` : '「清除档位」';
      // 中性文案：这是「在等确认」，不是失败。
      return `已下发${what}，等 Hub 快照确认…已等 ${waited}s / 最长 ${limit}s`;
    }
    case 'result': return phase.outcome.text;
  }
}

/** 切模型时原档位是否仍然适配：模型变了且目录里该新模型没有同档位 → 需要按合同清除或要求重选。 */
export function variantAfterModelSwitch(input: {
  previousModel?: string | null;
  nextModel?: string | null;
  currentVariant?: string | null;
  nextModelVariants?: unknown;
}): { action: 'keep' | 'clear' | 'must-reselect'; reason: string; code: 'model-unchanged' | 'no-variant' | 'not-in-list' | 'unknown' } {
  const prev = (input.previousModel ?? '').trim();
  const next = (input.nextModel ?? '').trim();
  const cur = typeof input.currentVariant === 'string' ? input.currentVariant.trim() : '';
  if (!cur) return { action: 'keep', reason: '当前没有档位', code: 'model-unchanged' };
  if (prev && next && prev === next) return { action: 'keep', reason: '模型未变，档位保持', code: 'model-unchanged' };
  const choices = variantChoices(input.nextModelVariants);
  if (choices.kind === 'list' && choices.options.includes(cur)) return { action: 'keep', reason: '新模型支持同一档位', code: 'model-unchanged' };
  // 我们**不会**自动发 modelVariant:null —— 省略就是「不改档」。所以这里只提示需要用户决定。
  if (choices.kind === 'none') return { action: 'must-reselect', reason: '新模型没有可选档位：不会自动清除，请手动选择或清除档位', code: 'no-variant' };
  if (choices.kind === 'unknown') return { action: 'must-reselect', reason: '新模型的档位未知 → 要求重新选择，不拼后缀、不硬编码', code: 'unknown' };
  return { action: 'must-reselect', reason: '新模型的档位不含原档位 → 要求重新选择，不拼后缀、不硬编码', code: 'not-in-list' };
}
