// admin 2026-11-10「fork 到新目录」：交接消息的口径（旧 → 新、有上限、空对话也说清楚）+ 中文进度。
//   run: bun src/fork-new-folder.test.ts
import { buildForkHandoff, forkNewFolderStepLabel } from './fork-new-folder';

let passed = 0;
let total = 0;
const ck = (name: string, condition: boolean) => {
  total++;
  if (condition) passed++;
  else console.log('❌', name);
};
const task = (at: string, content: string, result = '') => ({ task_id: at, from_name: 'admin', to_name: '源', content, result, created_at: at });

{
  const text = buildForkHandoff({ sourceAlias: 'TMA客户端欧2号', tasks: [
    task('2026-11-10T12:00:00Z', '第二件事', '做完了二'),
    task('2026-11-10T11:00:00Z', '第一件事', '做完了一'),
  ] });
  ck('handoff names the source', text.includes('从「TMA客户端欧2号」fork 出来'));
  ck('handoff is oldest first', text.indexOf('第一件事') < text.indexOf('第二件事'));
  ck('handoff shows the asker', text.includes('【admin】第一件事'));
  ck('handoff shows the source answer', text.includes('【TMA客户端欧2号】做完了一'));
  ck('handoff says not to redo finished work', text.includes('已经做完的不要重做'));
}
{
  const tasks = Array.from({ length: 30 }, (_, i) => task(`2026-11-10T${String(i).padStart(2, '0')}:00:00Z`, `问题${i} ${'x'.repeat(500)}`, `答${i}`));
  const text = buildForkHandoff({ sourceAlias: 'S', tasks, maxChars: 3000 });
  ck('handoff stays under the cap', text.length <= 3040);
  ck('handoff keeps the newest turn', text.includes('问题29'));
  ck('handoff drops the oldest turn', !text.includes('问题0 '));
  ck('handoff says how many were dropped', /更早的 \d+ 轮已省略/.test(text));
}
ck('empty conversation is stated', buildForkHandoff({ sourceAlias: 'S', tasks: [task('t', '  ', '')] }).includes('源节点最近没有可交接的对话'));
ck('long single turn is clipped, not dropped', buildForkHandoff({ sourceAlias: 'S', tasks: [task('t', 'y'.repeat(5000))], perItem: 100 }).includes('（已截断）'));
ck('waiting label names the new node', forkNewFolderStepLabel({ kind: 'waiting_online', alias: '欧7号' }) === '等「欧7号」上线…');
ck('handoff label is Chinese', forkNewFolderStepLabel({ kind: 'handoff_sent', alias: '欧7号' }).includes('已把源节点最近的对话交接过去'));

console.log(`fork-new-folder: ${passed}/${total}`);
process.exit(passed === total ? 0 : 1);
