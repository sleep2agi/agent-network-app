// 纯逻辑+杀进程重开实测(bun 可跑)。run: bun src/outbox.test.ts
// 判据C(通信龙):持久化的判据是「杀掉 app 再开,它还在」——不是「内存里有个标记」。
// 本文件的 K 组用**真进程死亡+全新进程**+真文件系统复现这件事本身(沙箱内最接近
// 杀 app 的形态;真机 app 级杀留真机轮)。
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  __resetOutboxForTest,
  initOutbox,
  outboxAdd,
  outboxForAlias,
  outboxMarkFailed,
  outboxMarkPending,
  outboxRemove,
  type OutboxEntry,
} from './outbox';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

// ── L 组:生命周期逻辑(内存注入 persist 间谍) ─────────────────────────────────
let disk: OutboxEntry[] = [];
const spy = (all: OutboxEntry[]) => { disk = all; };
const E = (id: string, alias = '通信龙', state: 'pending' | 'failed' = 'pending'): OutboxEntry =>
  ({ id, alias, content: `msg-${id}`, createdAt: Number(id.replace(/\D/g, '')) || 1, state });

__resetOutboxForTest(); initOutbox([], spy);
outboxAdd(E('a1'));
ck('L1 提交即落盘:add 后 persist 里就有(网络尝试之前)', disk.length === 1 && disk[0].id === 'a1' && disk[0].state === 'pending');
outboxMarkFailed('a1');
ck('L2 失败落盘为 failed', disk[0].state === 'failed');
outboxMarkPending('a1');
ck('L3 重试标回 pending(仍在盘上·重试中被杀照样恢复)', disk[0].state === 'pending' && disk.length === 1);
outboxRemove('a1');
ck('L4 确认成功=唯一删除路径:remove 后盘空', disk.length === 0);

__resetOutboxForTest(); initOutbox([E('x1', 'A', 'pending'), E('x2', 'B', 'failed')], spy);
ck('🔴 L5 重开恢复:pending 一律恢复为 failed(死在发送中=命运未知=按未送达)', outboxForAlias('A')[0].state === 'failed');
ck('L6 恢复不误删:两条都在·按会话过滤', outboxForAlias('A').length === 1 && outboxForAlias('B').length === 1);

__resetOutboxForTest(); initOutbox([E('t2'), E('t1')].map((e, i) => ({ ...e, createdAt: 2 - i })), spy);
ck('L7 outboxForAlias 按 createdAt 升序', outboxForAlias('通信龙').map(e => e.createdAt).join(',') === '1,2');

// ── K 组:🔴 真·杀进程再开(两个独立进程+真文件) ────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'outbox-kill-'));
const file = join(dir, 'outbox.json');
const mod = join(process.cwd(), 'src', 'outbox.ts');
// 进程 A:登记一条 pending → 直接 process.exit(0)(kill:无任何优雅收尾)
const scriptA = join(dir, 'a.ts');
writeFileSync(scriptA, `
import { initOutbox, outboxAdd } from ${JSON.stringify(mod)};
import { writeFileSync } from 'node:fs';
initOutbox([], (all) => writeFileSync(${JSON.stringify(file)}, JSON.stringify(all)));
outboxAdd({ id: 'k1', alias: '通信龙', content: '杀我之前发的', createdAt: 111, state: 'pending' });
process.exit(0); // 被杀:落盘发生在 add 当下,不靠退出钩子
`);
const ra = spawnSync('bun', [scriptA], { encoding: 'utf-8' });
ck('K1 进程A 已死(exit 0·无收尾钩子)', ra.status === 0);
// 进程 B:全新进程,从真文件恢复 → 断言条目仍在且为 failed,然后走 remove
const scriptB = join(dir, 'b.ts');
writeFileSync(scriptB, `
import { initOutbox, outboxForAlias, outboxRemove } from ${JSON.stringify(mod)};
import { readFileSync, writeFileSync } from 'node:fs';
const saved = JSON.parse(readFileSync(${JSON.stringify(file)}, 'utf-8'));
initOutbox(saved, (all) => writeFileSync(${JSON.stringify(file)}, JSON.stringify(all)));
const got = outboxForAlias('通信龙');
if (got.length !== 1 || got[0].id !== 'k1' || got[0].state !== 'failed' || got[0].content !== '杀我之前发的') process.exit(1);
outboxRemove('k1'); // 模拟重试成功后的确认删除
process.exit(0);
`);
const rb = spawnSync('bun', [scriptB], { encoding: 'utf-8' });
ck('🔴 K2 杀掉再开:全新进程从真文件里看到它·内容一致·pending→failed', rb.status === 0);
const after = JSON.parse(readFileSync(file, 'utf-8'));
ck('K3 进程B remove 后:真文件为空(送达确认才删·且删干净)', Array.isArray(after) && after.length === 0);
rmSync(dir, { recursive: true, force: true });

console.log(`\n${p}/${t} passed`);
if (p !== t) { if (typeof process !== 'undefined') process.exit(1); }
