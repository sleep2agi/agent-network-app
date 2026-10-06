// 新建节点向导的步骤表(纯函数,不 import react-native;CreateNodeWizardScreen 与测试共用)。
//
// 看板 #614(Vincent 10-06「这个界面感觉也有点丑」):「Codex（TUI 共存）」走到第 3 步「模型」时整页只有一行灰字 ——
// 那一步根本没有可选的东西。规则:**没有可选项的步骤不出现**,它的信息挪到「确认」页的一行里。
//   模型:runtime 的建议模型 ≤ 1 个 ⇒ 没得选(0 个 = 跟随宿主 TUI 登录;1 个 = 就是它)
//   参数:wizardParamsFor(runtime) 为空 ⇒ 没得选(#591/#717 的按 runtime 显示矩阵,见 create-node-request.ts)
// 名字 / Runtime / 确认 永远在。编号按**实际显示**的步骤排(1..n),上一步/下一步也只在这张表里走,
// 所以跳过一步不会留下断号,也不会「下一步」走进一张空页。
import { wizardParamsFor } from './create-node-request';

export type WizardStepKey = 'name' | 'runtime' | 'model' | 'params' | 'confirm';
export const ALL_WIZARD_STEPS: readonly WizardStepKey[] = ['name', 'runtime', 'model', 'params', 'confirm'];

export const STEP_TITLES: Readonly<Record<WizardStepKey, string>> = {
  name: '名字',
  runtime: 'Runtime',
  model: '模型',
  params: '参数',
  confirm: '确认',
};

/** 每一步标题下的一行说明。 */
export const STEP_DESCRIPTIONS: Readonly<Record<WizardStepKey, string>> = {
  name: '节点的名字，也是它在网络里的别名。',
  runtime: '节点用哪种 Agent 运行时；灰掉的是这台服务器不支持的。',
  model: '这个 runtime 使用的模型。',
  params: '只列出这个 runtime 真会读取的设置。',
  confirm: '核对一下，确认无误后创建。',
};

/** 模型这一步有没有东西可选。 */
export function modelStepHasChoice(models: readonly string[]): boolean {
  return models.length > 1;
}

/** 参数这一步有没有东西可选。 */
export function paramsStepHasChoice(runtimeId: string): boolean {
  return wizardParamsFor(runtimeId).length > 0;
}

/** 这个 runtime 实际显示的步骤(按顺序)。 */
export function wizardSteps(runtimeId: string, models: readonly string[]): WizardStepKey[] {
  return ALL_WIZARD_STEPS.filter(k =>
    (k !== 'model' || modelStepHasChoice(models)) &&
    (k !== 'params' || paramsStepHasChoice(runtimeId)));
}

/** 下一步;已在最后一步 ⇒ null。当前步不在表里(切 runtime 后被跳过)⇒ 表里排在它后面的第一步。 */
export function stepAfter(steps: readonly WizardStepKey[], cur: WizardStepKey): WizardStepKey | null {
  const order = ALL_WIZARD_STEPS.indexOf(cur);
  return steps.find(k => ALL_WIZARD_STEPS.indexOf(k) > order) ?? null;
}

/** 上一步;已在第一步 ⇒ null。 */
export function stepBefore(steps: readonly WizardStepKey[], cur: WizardStepKey): WizardStepKey | null {
  const order = ALL_WIZARD_STEPS.indexOf(cur);
  const before = steps.filter(k => ALL_WIZARD_STEPS.indexOf(k) < order);
  return before.length ? before[before.length - 1] : null;
}

/** 当前步若不在表里(不应发生),落到表里不早于它的第一步,再不行落到最后一步 —— 永远不渲染一张表外的页。 */
export function visibleStep(steps: readonly WizardStepKey[], cur: WizardStepKey): WizardStepKey {
  if (steps.includes(cur)) return cur;
  return stepAfter(steps, cur) ?? steps[steps.length - 1];
}

export type StepState = 'done' | 'current' | 'upcoming';
export function stepState(steps: readonly WizardStepKey[], cur: WizardStepKey, k: WizardStepKey): StepState {
  const i = steps.indexOf(k), c = steps.indexOf(cur);
  return i < c ? 'done' : i === c ? 'current' : 'upcoming';
}

/** 模型步被跳过时,确认页那一行里怎么说模型。 */
export function skippedModelText(models: readonly string[]): string {
  return models.length === 0
    ? '跟随宿主 TUI 的会员登录态，无需选择模型、无需输入 key'
    : `${models[0]}（唯一可选）`;
}

/** 参数步被跳过时,确认页那一行里怎么说参数。 */
export const SKIPPED_PARAMS_TEXT = '这个 runtime 没有额外参数';

/**
 * 确认页上「被跳过的步骤」那一行;没跳过任何步 ⇒ null。
 * 例:「模型：跟随宿主 TUI 的会员登录态，无需选择模型、无需输入 key · 参数：这个 runtime 没有额外参数」
 */
export function skippedStepsLine(runtimeId: string, models: readonly string[]): string | null {
  const parts: string[] = [];
  if (!modelStepHasChoice(models)) parts.push(`模型：${skippedModelText(models)}`);
  if (!paramsStepHasChoice(runtimeId)) parts.push(`参数：${SKIPPED_PARAMS_TEXT}`);
  return parts.length ? parts.join(' · ') : null;
}
