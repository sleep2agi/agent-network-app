// 本仓测试是**普通脚本 + ck()**（不是 bun:test），照既有约定写（见 markdown-model.test.ts）。
// 硬上限：把「永不 settle 的 promise」变成明确失败，好让调用方走既有退避。
import { withHardDeadline, LOAD_HARD_DEADLINE_MS } from './hard-deadline';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

const main = async () => {
  ck('正常 promise 原样返回', (await withHardDeadline(Promise.resolve('ok'), 'tasks')) === 'ok');
  let rejected = false;
  try { await withHardDeadline(Promise.reject(new Error('boom')), 'tasks'); } catch (e: any) { rejected = e?.message === 'boom'; }
  ck('失败的 promise 原样抛（不改语义）', rejected);
  const never = new Promise<string>(() => {});
  let msg = '';
  try { await withHardDeadline(never, 'chat-user', 20); } catch (e: any) { msg = String(e?.message ?? ''); }
  ck('永不 settle ⇒ 按上限拒绝', msg.includes('chat-user exceeded'));
  ck('默认上限略高于读路径 12s、不超过 20s',
    LOAD_HARD_DEADLINE_MS > 12_000 && LOAD_HARD_DEADLINE_MS <= 20_000);

  console.log(`\n${p}/${t} passed`);
  if (p !== t) process.exit(1);
};
void main();
