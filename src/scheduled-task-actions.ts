import type { HubScheduledTask } from './api';

export type ScheduledTaskAction = 'edit' | 'toggle' | 'run' | 'history' | 'cancel';

export function scheduledTaskActions(status: HubScheduledTask['status']): ScheduledTaskAction[] {
  if (status === 'active' || status === 'paused') {
    return ['edit', 'toggle', 'run', 'history', 'cancel'];
  }
  return ['history'];
}
