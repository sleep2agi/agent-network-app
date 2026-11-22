// 本仓测试是**普通脚本 + ck()**（不是 bun:test），照既有约定写。
// usePoll 看门狗：single-flight 闩超时强制复位（防止整页轮询永久停摆）。
// 用源码断言而不是 import——usePoll 依赖 react-native，普通 node 跑不起来。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(import.meta.dir, 'usePoll.ts'), 'utf8');
let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

ck('倍数是 4（2 会误伤 12s 读超时，10 会让停摆多藏 30s）', /WATCHDOG_FACTORS = 4;/.test(src));
ck('卡死判定 + warn 在 tick 里', /intervalMs \* WATCHDOG_FACTORS/.test(src) && src.includes('[usePoll] single-flight stuck'));
ck('复位 running', src.includes('running = false;'));
ck('gen 守卫：被复位那一代 settle 后不再改状态', src.includes('myGen !== gen'));

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
