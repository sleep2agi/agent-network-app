import { View } from 'react-native';
import { Text } from './ui-text';
import { registerTranslations, t } from './i18n';
import { useTranslation } from './i18n-react';
import type { HubTask } from './api';
import { taskExecutionState, type TaskDiagnostic } from './task-execution';
import { colors, spacing } from './theme';

registerTranslations({
  'execution.title': ['执行状态', 'Execution status'],
  'execution.finished': ['已结束', 'Finished'],
  'execution.failed': ['任务失败或已超时', 'Task failed or timed out'],
  'execution.ended': ['任务已取消', 'Task cancelled'],
  'execution.consumed': ['运行时已开始 · 等待回复', 'Runtime started · awaiting reply'],
  'execution.submitted': ['已提交运行时 · 开始状态未确认', 'Submitted to runtime · start unconfirmed'],
  'execution.received': ['Hub 已收到 · 开始状态未确认', 'Received by Hub · start unconfirmed'],
  'execution.unconfirmed': ['执行状态未确认', 'Execution unconfirmed'],
  'execution.missing': ['Hub 未找到目标节点登记', 'Hub could not find the target registration'],
  'execution.offline': ['Hub 记录目标节点离线', 'Hub reports the target offline'],
  'execution.disconnected': ['Hub 未检测到目标接收连接', 'Hub sees no target receiving connection'],
  'execution.evidenceAbsent': ['目标尚未上报运行时证据', 'Target has not reported runtime evidence'],
  'execution.waitHint': ['可能仍在等待节点空闲；已送达不代表模型已经开始，当前没有精确排队名次。', 'It may be waiting for the node. Delivery does not confirm a model start; an exact queue position is unavailable.'],
  'execution.evidenceHint': ['当前无法判断是否已开始；请由节点维护者检查运行时证据上报。', 'Start cannot be confirmed. Ask the node maintainer to check runtime evidence reporting.'],
  'execution.connectionHint': ['请由节点维护者检查登记或接收连接。', 'Ask the node maintainer to check registration or the receiving connection.'],
  'execution.stale': ['状态读取失败；下面显示上次结果。', 'Status refresh failed; showing the previous result.'],
});

/** Pure receipt view: chat/list reuse their existing poll, only detail reads diagnostic. */
export default function TaskExecutionNotice({ task, diagnostic, detail = false }: {
  task: HubTask; diagnostic?: TaskDiagnostic | null; detail?: boolean;
}) {
  useTranslation();
  const state = taskExecutionState(task, diagnostic);
  const hint = state === 'received' || state === 'submitted' ? 'waitHint'
    : state === 'evidenceAbsent' || state === 'unconfirmed' ? 'evidenceHint'
    : ['missing', 'offline', 'disconnected'].includes(state) ? 'connectionHint' : null;
  return <View testID={`task-execution-${state}`} style={{ gap: spacing.xs }}>
    <Text style={{ color: state === 'failed' ? colors.failed : colors.textMuted, fontSize: detail ? 14 : 11 }}>
      {t(`execution.${state}`)}
    </Text>
    {detail && hint ? <Text style={{ color: colors.textMuted, fontSize: 13 }}>{t(`execution.${hint}`)}</Text> : null}
  </View>;
}
