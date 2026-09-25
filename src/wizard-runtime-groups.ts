// 新建节点向导 runtime 列表的分组规则(纯函数,供 CreateNodeWizardScreen 与测试共用)。
//
// owner 2026-09-25 定:Grok 默认 = headless ACP(grok-build-acp);Grok 共存(grok-build-cli)
// 降为「实验性」,收进 Grok 行下面的「高级」折叠里。原因是舰队实测:ACP 13 台在线且稳,
// 共存 3 台在线、12 台离线。
//
// 一条 runtime 带 `advancedOf: '<父 id>'` ⇒ 它不出现在主列表,只在父行的「高级」折叠里。
// 🔴 这只是**新建**时的呈现。grok-build-cli 的 id 不变,已存在的共存节点不受影响。

export interface WizardRuntime {
  id: string;
  label: string;
  models: string[];
  note?: string;
  /** 归入哪一行的「高级」折叠;不设 = 主列表里的一行。 */
  advancedOf?: string;
}

/** 主列表:不属于任何「高级」折叠的 runtime,保持原顺序。 */
export function primaryRuntimes<T extends WizardRuntime>(list: readonly T[]): T[] {
  return list.filter(r => !r.advancedOf);
}

/** 某一行「高级」折叠里的 runtime。 */
export function advancedRuntimesOf<T extends WizardRuntime>(list: readonly T[], parentId: string): T[] {
  return list.filter(r => r.advancedOf === parentId);
}

/** 该行下面要不要显示「高级」开关:它有折叠项,且当前选中的是它自己或它的折叠项。 */
export function showsAdvancedToggle(list: readonly WizardRuntime[], parentId: string, selectedId: string): boolean {
  const kids = advancedRuntimesOf(list, parentId);
  if (kids.length === 0) return false;
  return selectedId === parentId || kids.some(k => k.id === selectedId);
}

/** 折叠是否展开:用户点开了,或者当前选中项本来就在折叠里(不能把选中项藏起来)。 */
export function advancedExpanded(list: readonly WizardRuntime[], parentId: string, selectedId: string, userOpened: boolean): boolean {
  if (!showsAdvancedToggle(list, parentId, selectedId)) return false;
  return userOpened || advancedRuntimesOf(list, parentId).some(k => k.id === selectedId);
}

/** 折叠项离开折叠显示时(第 3 步标题、确认页)带上父行名字:「Grok · 共存模式（实验性）」。 */
export function runtimeDisplayLabel(list: readonly WizardRuntime[], r: WizardRuntime): string {
  if (!r.advancedOf) return r.label;
  const parent = list.find(x => x.id === r.advancedOf);
  return parent ? `${parent.label} · ${r.label}` : r.label;
}
