// 看板 #614 —— 新建节点向导:没有可选项的步骤不出现,永远不画一张空页。
// Vincent 10-06 截图:「Codex（TUI 共存）」第 3 步「模型」整页只有一行灰字。
// 这里守:(1) 每个 runtime 显示的每一步都真有东西可选;(2) 编号连续、上一步/下一步只在显示的步里走;
// (3) 共存 runtime 走 名字 → Runtime → 确认,模型/参数的信息在确认页一行;(4) 向导确实用这张表渲染。
import { readFileSync } from 'node:fs';
import { wizardParamsFor } from './create-node-request';
import {
  ALL_WIZARD_STEPS, skippedStepsLine, stepAfter, stepBefore, stepState, visibleStep, wizardSteps, type WizardStepKey,
} from './create-node-steps';

let passed = 0, total = 0;
const check = (name: string, ok: boolean, extra = '') => { total++; if (ok) { passed++; console.log('✅', name); } else { console.error('❌', name, extra); } };

// 向导的 runtime 表(CreateNodeWizardScreen.tsx import react-native,只能读源码)
const wiz = readFileSync(new URL('./CreateNodeWizardScreen.tsx', import.meta.url), 'utf8');
const table = wiz.slice(wiz.indexOf('const RUNTIMES'), wiz.indexOf('const PERMISSION_MODES'));
const runtimes = table.split('\n')
  .map(l => /id: '([^']+)'.*models: \[([^\]]*)\]/.exec(l))
  .filter((m): m is RegExpExecArray => !!m)
  .map(m => ({ id: m[1], models: [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1]) }));
check('read the wizard runtime table (≥ 7 runtimes)', runtimes.length >= 7, String(runtimes.length));

// ── (1) 显示的每一步都有东西可选 ──
for (const r of runtimes) {
  const steps = wizardSteps(r.id, r.models);
  const empty = steps.filter(k =>
    (k === 'model' && r.models.length < 2) ||
    (k === 'params' && wizardParamsFor(r.id).length === 0));
  check(`🔴 ${r.id}: no shown step has nothing to choose (${steps.join(' → ')})`, empty.length === 0, empty.join(','));
  check(`${r.id}: 名字 / Runtime / 确认 always shown, in order`,
    steps[0] === 'name' && steps[1] === 'runtime' && steps[steps.length - 1] === 'confirm');
  // ── (2) 前进 / 后退只走显示的步 ──
  const fwd: WizardStepKey[] = ['name'];
  for (let k = stepAfter(steps, 'name'); k; k = stepAfter(steps, k)) fwd.push(k);
  const back: WizardStepKey[] = ['confirm'];
  for (let k = stepBefore(steps, 'confirm'); k; k = stepBefore(steps, k)) back.unshift(k);
  check(`${r.id}: 下一步 walks exactly the shown steps`, JSON.stringify(fwd) === JSON.stringify(steps), fwd.join(','));
  check(`${r.id}: 上一步 walks exactly the shown steps back`, JSON.stringify(back) === JSON.stringify(steps), back.join(','));
  // 一个被跳过的步骤,无论如何都落不到它的页上
  for (const k of ALL_WIZARD_STEPS) check(`${r.id}: visibleStep(${k}) is a shown step`, steps.includes(visibleStep(steps, k)));
  // 跳过了什么,确认页就要有一行说;没跳过就不出这一行
  const skipped = ALL_WIZARD_STEPS.filter(k => !steps.includes(k));
  const line = skippedStepsLine(r.id, r.models);
  check(`${r.id}: confirm-page line names every skipped step`,
    skipped.length === 0 ? line === null : skipped.every(k => (line ?? '').includes(k === 'model' ? '模型：' : '参数：')), String(line));
}

// ── (3) 共存 runtime ──
const codexCo = runtimes.find(r => r.id === 'codex-app-server');
check('🔴 Codex（TUI 共存） has no models in the table (follows the host TUI login)', !!codexCo && codexCo.models.length === 0);
const coSteps = wizardSteps('codex-app-server', codexCo?.models ?? []);
check('🔴 Codex（TUI 共存） walks 名字 → Runtime → 确认 (no empty 模型 / 参数 page)', JSON.stringify(coSteps) === '["name","runtime","confirm"]', coSteps.join(','));
check('🔴 Codex（TUI 共存） from Runtime, 下一步 goes straight to 确认', stepAfter(coSteps, 'runtime') === 'confirm');
check('Codex（TUI 共存） from 确认, 上一步 goes back to Runtime', stepBefore(coSteps, 'confirm') === 'runtime');
const coLine = skippedStepsLine('codex-app-server', []) ?? '';
check('🔴 Codex（TUI 共存） confirm line says the model follows the host TUI login and there are no params',
  coLine.includes('跟随宿主 TUI 的会员登录态') && coLine.includes('没有额外参数'), coLine);
check('claude-agent-sdk (4 models + 3 params) keeps all five steps',
  JSON.stringify(wizardSteps('claude-agent-sdk', ['a', 'b', 'c', 'd'])) === JSON.stringify(ALL_WIZARD_STEPS));
check('a single model is nothing to choose either', !wizardSteps('codex-sdk', ['only-one']).includes('model') && (skippedStepsLine('codex-sdk', ['only-one']) ?? '').includes('only-one'));
check('stepper states: done / current / upcoming', ['name', 'runtime', 'confirm'].map(k => stepState(coSteps, 'runtime', k as WizardStepKey)).join() === 'done,current,upcoming');

// ── (4) 向导真的用这张表渲染 ──
check('🔴 wizard renders the page of `cur = visibleStep(steps, step)`', wiz.includes('const cur = visibleStep(steps, step);'));
check('🔴 every step page is keyed on `cur`, none on the raw step index', ALL_WIZARD_STEPS.every(k => wiz.includes(`{cur === '${k}' && (`)) && !/\{step === \d/.test(wiz));
check('🔴 下一步 / 上一步 come from stepAfter / stepBefore', wiz.includes('const nextStep = stepAfter(steps, cur);') && wiz.includes('const prevStep = stepBefore(steps, cur);') && !/setStep\(step [+-] 1\)/.test(wiz));
check('🔴 the stepper numbers the shown steps, not the full list', wiz.includes('{steps.map((k, i) => {') && !wiz.includes('ALL_WIZARD_STEPS'));
const confirm = wiz.slice(wiz.indexOf("{cur === 'confirm' && ("));
check('🔴 confirm page renders the skipped-steps line', confirm.includes('{skippedLine ? (') && confirm.includes('testID="create-skipped-note"'));
check('no hard-coded hex colours in the wizard', !/['"]#[0-9a-fA-F]{3,8}['"]/.test(wiz));

console.log(`create node steps: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
