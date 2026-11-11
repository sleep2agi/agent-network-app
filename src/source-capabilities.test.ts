// #4495 —— 源能力门控：从 Hub 投影的五条能力推导每个入口能不能点。
//   run: bun src/source-capabilities.test.ts
//
// 规则来自 Hub 的口径：只在精确匹配时才吐键 ⇒ 键在=支持、键缺=不支持、整份列表拿不到=能力未知。
// 目的：把「看起来能用其实不能用」变成「不能点，并说清缺哪条能力」。
import { readFileSync } from 'node:fs';
import { capsOfDaemonRow, sourceCapabilityGates } from './source-capabilities';

let passed = 0;
let total = 0;
const ck = (name: string, cond: boolean, extra?: unknown) => {
  total += 1;
  if (cond) passed += 1;
  else console.log('❌', name, extra === undefined ? '' : JSON.stringify(extra));
};

const FULL = {
  source_directory_read: 'source-directory-read-v1',
  project_new_session: 'project-create-v1',
  session_attach: 'session-attach-v1',
  source_fork_transport: 'source-fork-v1',
  source_node_delivery: 'source-delivery-v1',
};

// ① 五条都在 ⇒ 四个入口都开
{
  const g = sourceCapabilityGates(FULL, 'ok');
  ck('all five ⇒ every入口 opens', g.directory.ok && g.projectNewSession.ok && g.attach.ok && g.fork.ok);
  ck('open gates carry no reason', g.directory.reasonKey === null && g.fork.reasonKey === null);
}

// ② 缺 project_new_session ⇒ 只有「用已有项目新建会话」关，目录/接入/fork 不受影响（按能力分别门控）
{
  const g = sourceCapabilityGates({ ...FULL, project_new_session: undefined }, 'ok');
  ck('missing project_new_session closes only that entry', !g.projectNewSession.ok && g.directory.ok && g.attach.ok && g.fork.ok);
  ck('closed gate names the capability', g.projectNewSession.reasonKey === 'sourcePalette.cap.projectNewSession');
}

// ③ 只有部分字段（daemon-dev 的 3/5）⇒ fork 关、其余开
{
  const g = sourceCapabilityGates({ ...FULL, source_fork_transport: undefined, source_node_delivery: undefined }, 'ok');
  ck('3/5 capabilities ⇒ fork closed, others open', !g.fork.ok && g.directory.ok && g.projectNewSession.ok && g.attach.ok);
  ck('fork needs both transport and delivery', sourceCapabilityGates({ ...FULL, source_node_delivery: undefined }, 'ok').fork.ok === false);
}

// ④ 目录缺失 ⇒ 三条目录入口全关（目录是前提），fork 仍按自己的两条判
{
  const g = sourceCapabilityGates({ ...FULL, source_directory_read: undefined }, 'ok');
  ck('no directory read ⇒ all directory entries closed', !g.directory.ok && !g.projectNewSession.ok && !g.attach.ok);
  ck('fork still judged by its own two fields', g.fork.ok === true);
}

// ⑤ 老 Hub / 读失败 ⇒ 全部关闭，原因是「Hub 版本不提供」，而不是「这台机器没开」
{
  // 规格：「老 Hub 时入口仍显示，点进去说明」——不拿未知冒充不支持，所以不门控，只给一行提示。
  const g = sourceCapabilityGates(FULL, 'unsupported');
  ck('old hub does NOT gate entries (they stay visible)', g.directory.ok && g.projectNewSession.ok && g.attach.ok && g.fork.ok);
  ck('old hub surfaces a notice instead', g.hubNoticeKey === 'sourcePalette.cap.hubUnsupported');
  const u = sourceCapabilityGates(FULL, 'unknown');
  ck('unknown read also stays ungated, with notice', u.fork.ok && u.hubNoticeKey === 'sourcePalette.cap.hubUnsupported' && u.source === 'unknown');
}

// ⑥ 行不存在 / 五条键一条都没有 ⇒ 未知 ⇒ 放行（兼容优先，别误杀老 Hub）
{
  const g = sourceCapabilityGates(null, 'ok');
  ck('row missing ⇒ ungated (compat-first)', g.directory.ok && g.projectNewSession.ok && g.attach.ok && g.fork.ok);
  const empty = sourceCapabilityGates({}, 'ok');
  ck('row with zero capability keys ⇒ ungated + notice',
    empty.fork.ok && empty.directory.ok && empty.hubNoticeKey === 'sourcePalette.cap.hubUnsupported');
}

// ⑦ 空串/空白不算能力（Hub 不会给半个值，但别把空串当支持）
{
  const g = sourceCapabilityGates({ ...FULL, session_attach: '   ' }, 'ok');
  ck('blank value is not a capability', !g.attach.ok);
}

// ⑧ capsOfDaemonRow 只挑五个字段，且过滤空值
{
  const row = capsOfDaemonRow({ ...FULL, alias: 'x', can_create_nodes: true } as never);
  ck('capsOfDaemonRow keeps the five capability fields only',
    !!row && Object.keys(row).sort().join() === 'project_new_session,session_attach,source_directory_read,source_fork_transport,source_node_delivery');
  ck('capsOfDaemonRow drops blank fields', Object.keys(capsOfDaemonRow({ ...FULL, attach: '' } as never) ?? {}).includes('attach') === false);
}

// ⑨ 接线守卫：palette 不再写死 true，且按能力分别门控
{
  const src = readFileSync(new URL('./NodeSourcePalette.tsx', import.meta.url), 'utf8');
  ck('palette no longer hardcodes hasProjectCreateCapability: true', !/hasProjectCreateCapability: true/.test(src));
  ck('palette asks the gate for each capability',
    src.includes('caps.projectNewSession.ok') && src.includes('caps.attach.ok') && src.includes('caps.fork.ok') && src.includes('caps.directory.ok'));
  ck('data comes from /api/host-supervisors', src.includes('fetchHostSupervisors('));
  // 通信欧 review 两条：别在客户端再判能力值（Hub 已白名单过滤，按值判会在版本号变化时误伤）；
  // fork 必须两条能力同时在场，别被「顺手放宽成任一条」。
  const caps = readFileSync(new URL('./source-capabilities.ts', import.meta.url), 'utf8');
  ck('client never compares capability VALUES (hub already filtered)', !/===\s*['"]source-|['"]source-directory-read-v/.test(caps));
  ck('fork gate keeps both fields ANDed',
    /present\(row\.source_fork_transport\)\s*&&\s*present\(row\.source_node_delivery\)/.test(caps));
}

console.log(`source-capabilities: ${passed}/${total}`);
process.exit(passed === total ? 0 : 1);
