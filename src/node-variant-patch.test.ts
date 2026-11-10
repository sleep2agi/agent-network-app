// ck-style：#4099 modelVariant 契约（序列化 omitted/null/string、能力门、切模型档位适配）
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { lastUpdateApplied } from './node-model-change';
import {
  buildConfigPatch,
  describeVariantOutcome,
  variantAfterModelSwitch,
  variantChoices,
  variantPhaseBusy,
  variantPhaseText,
  variantValueError,
  variantWritable,
  VARIANT_MAX_POLLS,
  VARIANT_POLL_MS,
  VARIANT_TIMEOUT_MS,
} from './node-variant-patch';

let n = 0;
const ck = (name: string, cond: boolean) => { n += 1; assert.ok(cond, name); console.log(`PASS: ${name}`); };

// 1) 序列化：省略 modelVariant → 不带该键（= 不修改档位）
const omitted = buildConfigPatch({ model: 'openai/m2' });
ck('omitted: no modelVariant key', !('modelVariant' in omitted));
ck('omitted: model serialized', omitted.model === 'openai/m2');

// 2) 显式 null → 必须带 null（清除档位）
const cleared = buildConfigPatch({ model: 'openai/m2', modelVariant: null });
ck('null: key present and null', 'modelVariant' in cleared && cleared.modelVariant === null);

// 3) string → 选中档位
const picked = buildConfigPatch({ modelVariant: 'high' });
ck('string: serialized', picked.modelVariant === 'high');
ck('string: no model key when absent', !('model' in picked));

// 4) 同 model 只改档位也能提交（不带 model）
const variantOnly = buildConfigPatch({ modelVariant: 'low' });
ck('same-model variant change: only modelVariant', Object.keys(variantOnly).length === 1 && variantOnly.modelVariant === 'low');

// 5) 校验：空白/控制字符拒绝；省略/null 合法
ck('reject whitespace', variantValueError('hi gh') !== null);
ck('reject control char', variantValueError('a\u0007b') !== null);
ck('accept plain', variantValueError('high') === null);
ck('accept null', variantValueError(null) === null);
ck('accept undefined', variantValueError(undefined) === null);

// 6) 能力门：必须显式声明 + opencode runtime
ck('capable+opencode → ok', variantWritable({ variantCapable: true, runtime: 'opencode-cli' }).ok);
ck('missing capability → blocked', !variantWritable({ variantCapable: false, runtime: 'opencode-cli' }).ok);
ck('unknown capability → blocked', !variantWritable({ runtime: 'opencode' }).ok);
ck('other runtime → blocked', !variantWritable({ variantCapable: true, runtime: 'codex-tui' }).ok);

// 7) 目录档位三态
ck('undefined → unknown', variantChoices(undefined).kind === 'unknown');
ck('[] → none', variantChoices([]).kind === 'none');
const list = variantChoices(['high', 'high', 'low', 42]);
ck('list deduped/filtered', list.kind === 'list' && JSON.stringify(list.options) === JSON.stringify(['high', 'low']));

// 8) 切模型时档位适配
ck('same model keeps', variantAfterModelSwitch({ previousModel: 'a', nextModel: 'a', currentVariant: 'high' }).action === 'keep');
ck('next list includes → keep', variantAfterModelSwitch({ previousModel: 'a', nextModel: 'b', currentVariant: 'high', nextModelVariants: ['high'] }).action === 'keep');
ck('next none → must-reselect (no auto clear)', variantAfterModelSwitch({ previousModel: 'a', nextModel: 'b', currentVariant: 'high', nextModelVariants: [] }).action === 'must-reselect');
ck('next unknown → must-reselect', variantAfterModelSwitch({ previousModel: 'a', nextModel: 'b', currentVariant: 'high', nextModelVariants: undefined }).action === 'must-reselect');
ck('no variant → keep', variantAfterModelSwitch({ previousModel: 'a', nextModel: 'b', currentVariant: null }).action === 'keep');

// ── #4099 last_update 真实形状（server/src/node-config-last-update.ts）联测 ──


// 真实 applied 形状
ck('last_update applied + update_id 对齐 → applied',
  lastUpdateApplied({ update_id: 'u1', status: 'applied', terminal: true, requested_model: 'openai/m2', error: null }, 'u1', 'openai/m2').applied);
// update_id 不一致
ck('update_id 不一致 → 不算 applied',
  !lastUpdateApplied({ update_id: 'u_other', status: 'applied', terminal: true, requested_model: 'openai/m2' }, 'u1', 'openai/m2').applied);
// requested_model 不一致
ck('requested_model 不一致 → 不算 applied',
  !lastUpdateApplied({ update_id: 'u1', status: 'applied', terminal: true, requested_model: 'openai/other' }, 'u1', 'openai/m2').applied);
// 非终态 / unknown
ck('status=pending → 不算 applied',
  !lastUpdateApplied({ update_id: 'u1', status: 'pending', terminal: false }, 'u1', 'openai/m2').applied);
ck('status=unknown → 不算 applied',
  !lastUpdateApplied({ update_id: 'u1', status: 'unknown', terminal: false }, 'u1', 'openai/m2').applied);
ck('status=rejected → 不算 applied',
  !lastUpdateApplied({ update_id: 'u1', status: 'rejected', terminal: true, error: 'OpenCode V2 session is not running' }, 'u1', 'openai/m2').applied);
ck('last_update=null → 不算 applied', !lastUpdateApplied(null, 'u1', 'openai/m2').applied);
ck('last_update 缺失 → 不算 applied', !lastUpdateApplied(undefined, 'u1', 'openai/m2').applied);
// applied 但仍要读回 model_effective 匹配（这里只验 last 判定；组合条件在组件 fixture）
ck('applied 但期望模型为空 → 仅按 last 判定', lastUpdateApplied({ update_id: 'u1', status: 'applied', terminal: true }, 'u1', null).applied);

// ── #4099 档位写入的观测窗口（2026-11-10 真节点实测）────────────────────────
// 实测：写档位 Hub 很快回 applied、OpenCode 会话 ~20s 内翻转，但 Hub 快照的
// 顶层 modelVariant 要等下一次心跳（几十秒）。提交后立刻读一次必然「未确认」，
// 于是**成功**的切换被报成红色失败。现在给 60s 窗口 + 双条件确认。
ck('观测窗口 60s / 每 3s 一读（跨过 Hub 那一两次心跳）',
  // 2026-11-10 第二次真机实测：快照上报延迟 ~60s（null）与 ~150s（low）。60 秒窗口覆盖不到长尾，
  // 会在写入已成功时先报「快照未跟上」——那是误报。150 秒 = 实测上界。
  VARIANT_POLL_MS === 3000 && VARIANT_TIMEOUT_MS === 150000 && VARIANT_MAX_POLLS * VARIANT_POLL_MS === VARIANT_TIMEOUT_MS);

// 1) applied + 顶层 modelVariant 一致 → 成功
const okOutcome = describeVariantOutcome({ applied: true, variantMatches: true, target: 'high' });
ck('applied + 顶层 modelVariant 一致 → 成功',
  okOutcome.kind === 'applied' && okOutcome.tone === 'success' && okOutcome.text.includes('high'));
ck('清除档位也算成功（目标是 null，读到 null 才算）',
  describeVariantOutcome({ applied: true, variantMatches: true, target: null }).kind === 'applied');

// 2) 超时仍 variant_busy → 非失败
const busyOutcome = describeVariantOutcome({ applied: false, variantMatches: false, target: 'high', lastStatus: 'variant_busy', lastError: 'variant_busy' });
ck('超时仍 variant_busy → 忙碌分类（不是失败），文案含「跑完再切」',
  busyOutcome.kind === 'busy' && busyOutcome.tone === 'neutral' && busyOutcome.text.includes('跑完再切'));
ck('variant_busy 的文案不带「失败」字头', !busyOutcome.text.startsWith('失败'));

// 3) applied 但快照还没跟上 → 单独一类，措辞不同（修法不同）
const laggingOutcome = describeVariantOutcome({ applied: true, variantMatches: false, target: 'high', lastStatus: 'applied' });
ck('写入已确认但快照未跟上 → 单独一类（不是失败）',
  laggingOutcome.kind === 'lagging' && laggingOutcome.tone === 'neutral'
  && laggingOutcome.text.includes('写入已确认，但快照未跟上') && laggingOutcome.text.includes('心跳'));
ck('快照滞后的文案劝人继续等/再检查，而不是重下发',
  laggingOutcome.text.includes('再检查一次') && laggingOutcome.text.includes('不用重下发'));

// 4) 其它错误 → 原样给出错误码/消息
const rawOutcome = describeVariantOutcome({ applied: false, variantMatches: false, target: 'high', lastError: 'variant_unsupported' });
ck('其它错误原样保留错误码',
  rawOutcome.kind === 'failed' && rawOutcome.tone === 'error'
  && rawOutcome.text.includes('variant_unsupported') && rawOutcome.code === 'variant_unsupported');
ck('只有 status 时也原样给出',
  describeVariantOutcome({ applied: false, variantMatches: false, target: 'high', lastStatus: 'rejected' }).text.includes('rejected'));
ck('什么都没有就给 unknown，不编原因',
  describeVariantOutcome({ applied: false, variantMatches: false, target: 'high' }).code === 'unknown');

// 5) 窗口内的中性态 + 忙碌判定
const verifyingPhase = { kind: 'verifying' as const, target: 'high', polls: 4 };
ck('观测窗口内的文案说「等 Hub 快照确认」，不是失败',
  variantPhaseText(verifyingPhase).includes('等 Hub 快照确认') && !variantPhaseText(verifyingPhase).includes('失败'));
ck('观测窗口内算忙（按钮禁用、不会二次下发）',
  variantPhaseBusy(verifyingPhase) && variantPhaseBusy({ kind: 'submitting', target: 'high' })
  && !variantPhaseBusy({ kind: 'result', target: 'high', outcome: okOutcome }));
ck('窗口文案有已等/最长秒数',
  variantPhaseText(verifyingPhase).includes(`已等 ${4 * VARIANT_POLL_MS / 1000}s`)
  && variantPhaseText(verifyingPhase).includes(`最长 ${VARIANT_TIMEOUT_MS / 1000}s`));

// 6) 组件源码契约：确认用**顶层** modelVariant，提交后进窗口、不单次读回即判死
const sectionSrc = readFileSync(new URL('./NodeModelSection.tsx', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
ck('section 按顶层 modelVariant 确认档位（双条件判定走同一个 helper）',
  sectionSrc.includes('variantMatches: !!v && v.modelVariant !== undefined && v.modelVariant === write.target')
  && (sectionSrc.match(/variantOutcomeOf\(/g) ?? []).length >= 3);
ck('section 不用 config_snapshot 兼容投影 model_variant 当判据', !sectionSrc.includes('model_variant'));
ck('section 提交后进 60s 观测窗口（不再单次 reload 即判失败）',
  sectionSrc.includes('VARIANT_TIMEOUT_MS') && sectionSrc.includes('VARIANT_MAX_POLLS')
  && sectionSrc.includes('describeVariantOutcome(') && !sectionSrc.includes('已接受，但当前档位未确认'));
ck('section 的写失败也走同一分类（variant_busy 不当异常）', sectionSrc.includes('lastError: res.error'));
const recheckStart = sectionSrc.indexOf('testID="node-variant-recheck"');
const recheckBlock = recheckStart < 0 ? '' : sectionSrc.slice(recheckStart, sectionSrc.indexOf('<Text', recheckStart));
ck('「再检查一次」只读配置，不重发档位', recheckBlock.length > 0 && !recheckBlock.includes('updateNodeConfig'));

console.log(`${n}/${n} passed`);
// Hub reports agent-node OpenCode nodes as opencode-sdk: must not be refused by runtime name.
{
  const { variantWritable: vw } = await import('./node-variant-patch');
  if (!vw({ variantCapable: true, runtime: 'opencode-sdk' }).ok) throw Error('opencode-sdk refused');
  if (vw({ variantCapable: false, runtime: 'opencode-sdk' }).ok) throw Error('capability bypassed');
  if (vw({ variantCapable: true, runtime: 'claude-code' }).ok) throw Error('non-opencode accepted');
  console.log('PASS variant: opencode-sdk writable when capable; capability still required');
}
process.exit(0);
