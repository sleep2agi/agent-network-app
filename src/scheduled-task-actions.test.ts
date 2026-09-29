import { scheduledTaskActions } from './scheduled-task-actions';

function equal(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${name}: expected ${e}, got ${a}`);
}

const mutable = ['edit', 'copy', 'toggle', 'run', 'history', 'cancel'];
equal('active tasks expose mutable actions', scheduledTaskActions('active'), mutable);
equal('paused tasks expose mutable actions', scheduledTaskActions('paused'), mutable);
equal('completed tasks expose copy + history', scheduledTaskActions('completed'), ['copy', 'history']);
equal('cancelled tasks expose copy + history', scheduledTaskActions('cancelled'), ['copy', 'history']);

console.log('scheduled task actions tests passed');
