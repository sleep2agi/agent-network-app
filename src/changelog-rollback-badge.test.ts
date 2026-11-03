// 更新日志里的「建议回滚」标记(2026-11-04)。
// 关于页已经在出问题时告诉用户该装回哪一版;用户真正翻历史是在更新日志里,
// 那一版不标出来,他还是得记住版本号再回来找。这里钉住三件事:
//   1) 目标从同一份内置日志算出(不另立一份版本表);
//   2) 桌面和手机两套画法都标(只标一边,换设备就找不到);
//   3) 文案有中英两版。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { rollbackTarget } from './changelog-model';
import { t as translate } from './i18n';
import './i18n-changelog';

let pass = 0;
const fails: string[] = [];
function ck(name: string, ok: boolean) {
  if (ok) { pass++; return; }
  fails.push(name);
  console.log(`FAIL: ${name}`);
}

const screen = readFileSync(path.join(import.meta.dir, 'ChangelogScreen.tsx'), 'utf8');
const copy = readFileSync(path.join(import.meta.dir, 'i18n-changelog.ts'), 'utf8');

ck('目标由 rollbackTarget 从内置日志算出（不另立版本表）',
  screen.includes("rollbackTarget(entries.map(e => e.version), APP_VERSION)"));

ck('算不出来就返回 null（不猜）', (() => {
  const fn = /function useRollbackTarget[\s\S]*?\n}/.exec(screen)?.[0] ?? '';
  return fn.includes('catch { return null; }') && fn.includes('return rollbackTarget(');
})());

ck('桌面与手机两套画法都标「建议回滚」',
  (screen.match(/rollbackTo && e\.version === rollbackTo/g) ?? []).length === 2
  && (screen.match(/tr\('changelog\.rollback'\)/g) ?? []).length === 2);

ck('「当前版本」标记没被顺手改掉',
  (screen.match(/e\.version === APP_VERSION/g) ?? []).length === 2
  && screen.includes("tr('changelog.current')"));

// 测试进程默认语言是英文(和 changelog.current 一样),这里只要求「两种语言都登记了 + 能查到」。
ck('文案有中英两版', copy.includes("'changelog.rollback': ['建议回滚', 'Rollback']")
  && ['建议回滚', 'Rollback'].includes(translate('changelog.rollback')));

ck('rollbackTarget 仍是纯函数语义（新→旧取下一条；不在列表返回 null）',
  rollbackTarget(['0.2.438', '0.2.437'], '0.2.438') === '0.2.437'
  && rollbackTarget(['0.2.438'], '0.2.438') === null
  && rollbackTarget(['0.2.438'], '0.2.999') === null);

if (fails.length) { console.log(`changelog rollback badge: ${fails.length} failed`); process.exit(1); }
console.log(`changelog rollback badge: ${pass}/${pass} checks passed`);
