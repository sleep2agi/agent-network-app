import type { HubScheduledTask } from './api';

export type ScheduledTaskAction = 'edit' | 'copy' | 'toggle' | 'run' | 'history' | 'cancel';

export function scheduledTaskActions(status: HubScheduledTask['status']): ScheduledTaskAction[] {
  if (status === 'active' || status === 'paused') {
    return ['edit', 'copy', 'toggle', 'run', 'history', 'cancel'];
  }
  // 已结束的计划也能复制:复制一条跑完的单次计划正是最常见的用法。
  return ['copy', 'history'];
}
