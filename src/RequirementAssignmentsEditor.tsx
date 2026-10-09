import { personDisplay } from './i18n-task-presentation';
import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import { taskText } from './i18n-tasks';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './ui-text';
import type { HubConfig } from './api';
import type { Requirement } from './requirements-model';
import { listRequirementPeople, saveRequirementAssignments, type RequirementAssignments } from './requirement-people-api';
import { hasRoles } from './task-board-model';
import { mergeParticipants, personKey, type RequirementPerson, type RequirementPersonRef } from './requirement-people';
import PeoplePicker, { measureAnchor } from './RequirementPeoplePicker';
import type { SelectAnchor } from './task-select-model';
import { colors, spacing } from './theme';

import { PersonChips, useTaskStyles } from './TaskBoardParts';

export default function RequirementAssignmentsEditor({ cfg, item, onSaved, fields = 'both', pointer = false, directory }: {
  cfg: HubConfig; item: Requirement; onSaved: (assignments: RequirementAssignments) => void;
  /** 任务详情里负责人和标题 / 期限一起在草稿里改(「保存修改」),这里只管参与人。 */
  fields?: 'both' | 'participants';
  /** 桌面:选择器锚在「编辑参与人」下面的下拉,不居中盖住详情面板。 */
  pointer?: boolean;
  /** Detail owner/participants share one directory and one error/retry UI. */
  directory?: { people: readonly RequirementPerson[]; loading: boolean; reload: () => Promise<boolean> };
}) {
  useTranslation();
  const supported = item.owner !== undefined && item.participants !== undefined;
  const taskStyles = useTaskStyles();
  const [localPeople, setPeople] = useState<RequirementPerson[]>([]);
  const [localLoading, setLoading] = useState(false);
  const people = directory?.people ?? localPeople;
  const loading = directory?.loading ?? localLoading;
  const sharedDirectory = !!directory;
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [mode, setMode] = useState<'owner' | 'participants' | null>(null);
  // 打开选择器时的参与人(人类 + Agent):保存时只把这次的增减套到最新列表上(mergeParticipants)。
  const opened = useRef<RequirementPersonRef[]>([]);
  // 保存时读的「最新列表」:看板经 SSE 刷新 item,选择器开着时别人改的也在这里。
  const latest = useRef(item);
  latest.current = item;
  const [anchor, setAnchor] = useState<SelectAnchor | null>(null);
  const actionsRef = useRef<any>(null);
  const openPicker = async (value: 'owner' | 'participants') => {
    if (directory) {
      if (people.length) void directory.reload();
      else if (!(await directory.reload())) return;
    }
    if (!alive.current) return;
    opened.current = [...(latest.current.participants ?? [])];
    if (!pointer) { setAnchor(null); setMode(value); return; }
    measureAnchor(actionsRef.current, a => { if (alive.current) { setAnchor(a); setMode(value); } });
  };
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!supported || sharedDirectory) return;
    let dead = false;
    setLoading(true);
    setError('');
    listRequirementPeople(cfg).then(rows => { if (!dead) setPeople(rows); }).catch(e => {
      if (!dead) setError(e instanceof Error ? e.message : tr('tasks.copy.0'));
    }).finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [cfg.serverUrl, cfg.token, cfg.networkId, supported, reload, sharedDirectory]);

  // 找不到的成员显示「未知成员（末 6 位）」,永远不把裸 id 当名字(owner 0.2.141 截图)。
  const label = (ref: RequirementPersonRef) => {
    const person = people.find(row => personKey(row) === personKey(ref));
    // 分两个角色的 Hub 上负责人 / 参与人只会是人类,不再标「（人类）」;旧 Hub 人和 Agent 混着,照旧标种类。
    const kind = hasRoles(item) && ref.kind === 'user' ? '' : ref.kind === 'user' ? tr('tasks.copy.1') : 'Agent';
    const suffix = `${kind}${person?.unavailable ? tr('tasks.copy.2') : ''}`;
    return suffix ? `${personDisplay(ref, people).name}（${suffix}）` : personDisplay(ref, people).name;
  };
  const confirm = async (selected: RequirementPersonRef[]) => {
    if (!mode || pending.current || !supported) return;
    pending.current = true;
    setSaving(true);
    setError('');
    setMode(null);
    try {
      const saved = await saveRequirementAssignments(cfg, item.id, mode === 'owner'
        ? { owner: selected[0] ?? null }
        // Hub 的 participants 是整表替换:读-改-写,人类和 Agent({kind:'node',id})一起存。
        : { participants: mergeParticipants(latest.current.participants ?? [], opened.current, selected) });
      // The board owns saved data and can outlive this detail editor.
      onSaved(saved);
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : tr('tasks.copy.3')); }
    finally { pending.current = false; if (alive.current) setSaving(false); }
  };
  if (!supported) return <Text testID="assignments-unsupported" style={{ color: colors.textMuted }}>{tr('tasks.copy.4')}</Text>;
  return <View style={{ gap: spacing.sm }}>
    {fields === 'both' ? <Text style={{ color: colors.text }}>{tr('tasks.copy.5')}{item.owner ? label(item.owner) : tr('tasks.copy.6')}</Text> : null}
    {fields === 'both'
      ? <Text style={{ color: colors.text }}>{tr('tasks.copy.7')}{item.participants!.length ? item.participants!.map(label).join('、') : tr('tasks.copy.8')}</Text>
      // 详情:头像 + 名字的胶囊;成员表还在读时胶囊后面跟一行小字,不再单独飘一个转圈(截图里转圈悬在参与人下面)。
      : <PersonChips refs={item.participants!} people={people} s={taskStyles} testID="participants-chips" />}
    {!sharedDirectory && loading && !people.length ? <Text style={{ color: colors.textMuted, fontSize: 12 }} testID="participants-loading">{tr('tasks.copy.9')}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: colors.failed }}>{error}</Text> : null}
    {error ? <Pressable accessibilityRole="button" disabled={saving} onPress={() => setReload(n => n + 1)}><Text style={{ color: colors.accent }}>{tr('tasks.copy.10')}</Text></Pressable> : null}
    <View ref={actionsRef} collapsable={false} style={{ flexDirection: 'row', gap: spacing.md }}>
      {(fields === 'both' ? ['owner', 'participants'] as const : ['participants'] as const).map(value => <Pressable key={value} testID={`edit-${value}`} accessibilityRole="button" disabled={saving || (!people.length && (loading || !!error))} onPress={() => { void openPicker(value); }} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.accent }}>{value === 'owner' ? tr('tasks.copy.11') : tr('tasks.copy.12')}</Text></Pressable>)}
    </View>
    {saving ? <Text accessibilityLiveRegion="polite" style={{ color: colors.textMuted }}>{tr('tasks.copy.13')}</Text> : null}
    {mode ? <PeoplePicker networkId={cfg.networkId || ''} mode={mode} people={people} selected={mode === 'owner' ? item.owner ? [item.owner] : [] : item.participants!} anchor={anchor} onClose={() => setMode(null)} onConfirm={selected => { void confirm(selected); }} /> : null}
  </View>;
}
