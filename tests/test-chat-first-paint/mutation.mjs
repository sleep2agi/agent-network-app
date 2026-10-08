import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
if (!existsSync('/.dockerenv')) throw Error('container only');
const path = 'src/chat-source-load.ts';
const source = readFileSync(path, 'utf8');
const anchor = 'return Promise.all([run(options.tasks, options.onTasks), run(options.proactive, options.onProactive)]);';
if (source.split(anchor).length !== 2) throw Error('mutation anchor must occur once');
try {
  writeFileSync(path, source.replace(anchor, `const tasks = options.tasks(), proactive = options.proactive();
  await Promise.allSettled([tasks, proactive]);
  return Promise.all([run(() => tasks, options.onTasks), run(() => proactive, options.onProactive)]);`));
  const r = spawnSync('bun', ['src/chat-source-load.test.ts'], { encoding: 'utf8', timeout: 10000 });
  const log = `${r.stdout || ''}${r.stderr || ''}`;
  if (r.status !== 1 || !log.includes('FAIL tasks paints without waiting for its peer') || !log.includes('FAIL proactive paints without waiting for its peer')) throw Error(`not assertion-red\n${log}`);
  console.log('WITNESSED_RED joint-wait rc=1: both first-paint assertions failed');
} finally { writeFileSync(path, source); }
