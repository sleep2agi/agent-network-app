// 定时任务详情页「任务内容」的 ⤢ 全屏:看、改、语音输入,和任务描述同一套(TaskDescriptionEditor fullscreenOnly)。
//   桌面:盖住整窗的 阅读 / 编辑 / 左右 + 🎤 + 录音条;手机:推入的一整页,编辑时底部「按住 说话」。
//   详情页没有外层的保存按钮,保存放在全屏的工具条 / 顶栏里;只发 revision + task(schedule-content-edit.ts)。
//   草稿在 ScheduledTasksScreen 手里:没保存就退出,草稿留着,卡片上提示「继续编辑 / 放弃修改」。
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './ui-text';
import { colors, radius, spacing } from './theme';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-schedules';
import { fetchScheduledTasks, updateScheduledTaskContent, type HubConfig, type HubScheduledTask } from './api';
import TaskDescriptionEditor from './TaskDescriptionEditor';
import { canSaveContent, contentDirty, saveScheduleContent, SCHEDULE_CONTENT_MAX } from './schedule-content-edit';

export type ScheduleContentDraft = { base: HubScheduledTask; text: string };

type Problem = { kind: 'message'; text: string } | { kind: 'conflict'; latest: HubScheduledTask };

export default function ScheduleContentFullscreen({ cfg, draft, pointer, onDraft, onClose, onSaved }: {
  cfg: HubConfig;
  draft: ScheduleContentDraft;
  pointer: boolean;
  onDraft: (next: ScheduleContentDraft) => void;
  /** 退出全屏(草稿由调用方决定留不留)。 */
  onClose: () => void;
  onSaved: (schedule: HubScheduledTask | null) => void;
}) {
  useTranslation();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const dirty = contentDirty(draft.base, draft.text);

  const save = async (base: HubScheduledTask) => {
    setBusy(true); setProblem(null);
    try {
      const r = await saveScheduleContent({
        patch: (row, task) => updateScheduledTaskContent(cfg, row, task),
        refetch: async id => (await fetchScheduledTasks(cfg)).schedules?.find(x => x.schedule_id === id),
      }, base, draft.text);
      if (r.kind === 'saved') { onSaved(r.schedule); return; }
      if (r.kind === 'conflict') { setProblem({ kind: 'conflict', latest: r.latest }); return; }
      if (r.kind === 'retryAgain') { onDraft({ base: r.latest, text: draft.text }); setProblem({ kind: 'message', text: t('schedules.content.retryAgain') }); return; }
      setProblem({ kind: 'message', text: r.kind === 'gone' ? t('schedules.content.gone') : t('schedules.content.saveFailed', { message: r.message }) });
    } finally { setBusy(false); }
  };
  const useMine = (latest: HubScheduledTask) => { onDraft({ base: latest, text: draft.text }); void save(latest); };
  const useTheirs = (latest: HubScheduledTask) => { setProblem(null); onDraft({ base: latest, text: latest.task_content }); };

  const below = problem ? (
    <View testID="schedule-content-problem" style={{ gap: spacing.sm, padding: spacing.md, borderRadius: radius.control, borderWidth: 1, borderColor: colors.failed + '55', backgroundColor: colors.failed + '10' }}>
      <Text style={{ color: colors.failed, fontSize: 13 }} testID="schedule-content-problem-text">{problem.kind === 'conflict' ? t('schedules.content.conflict') : problem.text}</Text>
      {problem.kind === 'conflict' ? (
        <>
          <Text style={{ color: colors.text, fontSize: 13 }} numberOfLines={4} selectable testID="schedule-content-conflict-theirs">{problem.latest.task_content}</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {[
              { id: 'mine', label: t('schedules.conflict.useMine'), onPress: () => useMine(problem.latest) },
              { id: 'theirs', label: t('schedules.conflict.useTheirs'), onPress: () => useTheirs(problem.latest) },
            ].map(b => (
              <Pressable key={b.id} disabled={busy} accessibilityRole="button" onPress={b.onPress} testID={`schedule-content-conflict-${b.id}`}
                style={{ height: 32, paddingHorizontal: spacing.md, borderRadius: radius.item, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', backgroundColor: colors.bg }}>
                <Text style={{ color: colors.text, fontSize: 13 }}>{b.label}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </View>
  ) : null;

  return (
    <TaskDescriptionEditor
      fullscreenOnly
      cfg={cfg}
      value={draft.text}
      onChange={text => onDraft({ base: draft.base, text })}
      pointer={pointer}
      title={draft.base.name}
      dirty={dirty}
      label={t('schedules.field.task')}
      placeholder={t('schedules.content.placeholder')}
      maxLength={SCHEDULE_CONTENT_MAX}
      images={false}
      richText={false}
      fullscreenA11y={t('schedules.content.fullscreenA11y')}
      chrome={{
        title: t('schedules.field.task'),
        unsavedText: t('schedules.content.unsaved'),
        save: { label: busy ? t('schedules.content.saving') : t('schedules.content.save'), disabled: !canSaveContent(draft.base, draft.text, busy) || problem?.kind === 'conflict', onPress: () => { void save(draft.base); } },
        below,
      }}
      onFullscreenClose={onClose}
    />
  );
}
