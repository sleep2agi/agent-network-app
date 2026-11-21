// Hub #3711 —— 机器别名（按 hostname 维度）。客户端这边只做三件事：
//   1) 校验与 Hub 同口径（1–64 字、trim、禁控制字符），本地先拦一次；
//   2) 列表行显示 alias ?? hostname（alias=null 不显示「未设置」噪音）；
//   3) 每台机器只查一次（按 hostname 去重），失败静默回落 hostname。
//   run: bun src/machine-alias.test.ts
import { machineAliasLabel, machineAliasErrorText, normalizeMachineAlias, uniqueHostnames } from './machine-alias';

let passed = 0;
let total = 0;
const ck = (name: string, ok: boolean) => { total++; if (ok) passed++; else console.log('❌', name); };

ck('有别名就用别名', machineAliasLabel('imac-office', '办公室 iMac') === '办公室 iMac');
ck('没别名回落 hostname', machineAliasLabel('imac-office', null) === 'imac-office');
ck('空白别名当没设置', machineAliasLabel('imac-office', '   ') === 'imac-office');
ck('没有 hostname 时不编造', machineAliasLabel(null, null) === '');
ck('别名的控制字符被清掉（与 Hub 的「禁控制字符」同口径）', machineAliasLabel('h', 'a\u0007b') === 'ab');

ck('trim 后 1–64 字合法', normalizeMachineAlias('  Mac Studio  ').ok && (normalizeMachineAlias('  Mac Studio  ') as any).value === 'Mac Studio');
ck('空串不合法', normalizeMachineAlias('   ').ok === false);
ck('65 字不合法', normalizeMachineAlias('x'.repeat(65)).ok === false);
ck('64 字合法', normalizeMachineAlias('x'.repeat(64)).ok === true);
ck('控制字符不合法', normalizeMachineAlias('a\u0000b').ok === false);

ck('403 user_token_required 有人话', /人类账号/.test(machineAliasErrorText('user_token_required')));
ck('400 invalid_machine_alias 有人话', /别名/.test(machineAliasErrorText('invalid_machine_alias')));
ck('未知错误原样给出', machineAliasErrorText('boom') === 'boom');

ck('hostname 去重、去空、保序', JSON.stringify(uniqueHostnames(['a', 'b', 'a', '', '  '])) === JSON.stringify(['a', 'b']));

console.log(`${passed}/${total} passed`);
if (passed !== total) process.exit(1);
