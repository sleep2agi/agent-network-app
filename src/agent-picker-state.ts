// Agent 选择器的状态(成员授权与分组编辑共用):搜索、页签(全部 / 按机器 / 按类型 / 分组)、批量勾选。
// 纯判断在 user-admin.ts / member-editor.ts;这里只把它们接到 React state 上。
import { useMemo, useState } from 'react';
import { filterPickable, groupAgents, selectAgents, toggleAgents, type AgentGroup, type MemberRole, type PickableAgent } from './user-admin';
import type { PickerTab } from './member-editor';

export function useAgentPicker(agents: PickableAgent[] | null, role: MemberRole | undefined) {
  const [selection, setSelection] = useState<Map<string, boolean>>(new Map());
  const [query, setQuery] = useState('');
  const [groupBy, setGroupBy] = useState<PickerTab>('none');
  const visible = useMemo(() => filterPickable(agents ?? [], query), [agents, query]);
  const groups = useMemo<AgentGroup[] | null>(() => (groupBy === 'host' || groupBy === 'runtime' ? groupAgents(visible, groupBy) : null), [visible, groupBy]);
  return {
    agents, visible, groups, selection, setSelection, query, setQuery, groupBy, setGroupBy,
    toggleGroup: (list: readonly PickableAgent[]) => setSelection(s => toggleAgents(s, list, role)),
    selectVisible: () => setSelection(s => selectAgents(s, visible, role)),
    clearAll: () => setSelection(new Map()),
  };
}
export type AgentPickerState = ReturnType<typeof useAgentPicker>;
