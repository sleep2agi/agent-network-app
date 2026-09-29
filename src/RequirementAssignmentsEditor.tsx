import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './ui-text';
import type { HubConfig } from './api';
import type { Requirement } from './requirements-model';
import { listRequirementPeople, saveRequirementAssignments, type RequirementAssignments } from './requirement-people-api';
import { personKey, type RequirementPerson, type RequirementPersonRef } from './requirement-people';
import PeoplePicker from './RequirementPeoplePicker';
import { colors, spacing } from './theme';
import { personDisplay } from './task-board-model';
import { PersonChips, useTaskStyles } from './TaskBoardParts';

export default function RequirementAssignmentsEditor({ cfg, item, onSaved, fields = 'both' }: {
  cfg: HubConfig; item: Requirement; onSaved: (assignments: RequirementAssignments) => void;
  /** 任务详情里负责人和标题 / 期限一起在草稿里改(「保存修改」),这里只管参与人。 */
  fields?: 'both' | 'participants';
}) {
  const supported = item.owner !== undefined && item.participants !== undefined;
  const taskStyles = useTaskStyles();
  const [people, setPeople] = useState<RequirementPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [mode, setMode] = useState<'owner' | 'participants' | null>(null);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!supported) return;
    let dead = false;
    setLoading(true);
    setError('');
    listRequirementPeople(cfg).then(rows => { if (!dead) setPeople(rows); }).catch(e => {
      if (!dead) setError(e instanceof Error ? e.message : '成员列表读取失败');
    }).finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [cfg.serverUrl, cfg.token, cfg.networkId, supported, reload]);

  // 找不到的成员显示「未知成员（末 6 位）」,永远不把裸 id 当名字(owner 0.2.141 截图)。
  const label = (ref: RequirementPersonRef) => {
    const person = people.find(row => personKey(row) === personKey(ref));
    return `${personDisplay(ref, people).name}（${ref.kind === 'user' ? '人类' : 'Agent'}${person?.unavailable ? '，已失效' : ''}）`;
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
        : { participants: selected });
      // The board owns saved data and can outlive this detail editor.
      onSaved(saved);
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '人员绑定未保存'); }
    finally { pending.current = false; if (alive.current) setSaving(false); }
  };
  if (!supported) return <Text testID="assignments-unsupported" style={{ color: colors.textMuted }}>升级 Hub 后可绑定人类或 Agent 负责人及参与人</Text>;
  return <View style={{ gap: spacing.sm }}>
    {fields === 'both' ? <Text style={{ color: colors.text }}>负责人 · {item.owner ? label(item.owner) : '未分配'}</Text> : null}
    {fields === 'both'
      ? <Text style={{ color: colors.text }}>参与人 · {item.participants!.length ? item.participants!.map(label).join('、') : '暂无'}</Text>
      // 详情:头像 + 名字的胶囊;成员表还在读时胶囊后面跟一行小字,不再单独飘一个转圈(截图里转圈悬在参与人下面)。
      : <PersonChips refs={item.participants!} people={people} s={taskStyles} testID="participants-chips" />}
    {loading ? <Text style={{ color: colors.textMuted, fontSize: 12 }} testID="participants-loading">正在读取成员…</Text> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: colors.failed }}>{error}</Text> : null}
    {error ? <Pressable accessibilityRole="button" disabled={saving} onPress={() => setReload(n => n + 1)}><Text style={{ color: colors.accent }}>重新读取成员</Text></Pressable> : null}
    <View style={{ flexDirection: 'row', gap: spacing.md }}>
      {(fields === 'both' ? ['owner', 'participants'] as const : ['participants'] as const).map(value => <Pressable key={value} testID={`edit-${value}`} accessibilityRole="button" disabled={loading || saving || !!error} onPress={() => setMode(value)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.accent }}>{value === 'owner' ? '更换负责人' : '编辑参与人'}</Text></Pressable>)}
    </View>
    {saving ? <Text accessibilityLiveRegion="polite" style={{ color: colors.textMuted }}>正在保存人员绑定…</Text> : null}
    {mode ? <PeoplePicker networkId={cfg.networkId || ''} mode={mode} people={people} selected={mode === 'owner' ? item.owner ? [item.owner] : [] : item.participants!} onClose={() => setMode(null)} onConfirm={selected => { void confirm(selected); }} /> : null}
  </View>;
}
