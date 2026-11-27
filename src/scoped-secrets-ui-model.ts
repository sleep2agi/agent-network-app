// #5675 PR-2 —— 节点「密钥」页表单与名称列表读取解耦纯逻辑。
//
// 原则：读取「已有名称列表」不能锁住输入框和保存按钮；超过 8 秒没结果就停止转圈并
// 明确告知「节点正在忙，名称列表暂时读不到；仍可直接保存新密钥」。
// 仅在真正提交写入（writing）或 Hub/节点明确返回能力不支持/无权限（hardBlock）时禁用保存。

export const SECRET_LIST_SOFT_TIMEOUT_MS = 8000;

export type SecretListState = 'idle' | 'loading' | 'ready' | 'timed_out' | 'error';
export type SecretHardBlock = null | 'unsupported' | 'forbidden';

export function secretFormEditable(state: { writing: boolean; hardBlock: SecretHardBlock }): boolean {
  return !state.writing && state.hardBlock === null;
}

export function secretSaveDisabled(state: { writing: boolean; hardBlock: SecretHardBlock }): boolean {
  return state.writing || state.hardBlock !== null;
}

export function secretListStatusText(listState: SecretListState): string {
  switch (listState) {
    case 'loading':
      return '读取中…';
    case 'timed_out':
      return '节点正在忙，名称列表暂时读不到；仍可直接保存新密钥';
    default:
      return '';
  }
}
