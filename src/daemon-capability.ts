// #1545 客户端侧 —— hub 发了、CLI 念了、桌面端整个丢掉。
//
// 链路现状(逐层读过实现,不是读测试名):
//   hub   server/src/server.ts:3233  out.can_create_nodes / create_nodes_blocked_reason
//                                    / create_capability_observed_ms_ago
//   CLI   agent-network/bin/cli.ts:8726  daemonCreateCapabilityLine(...)
//   app   本文件之前:三个字段一个都不读
//
// 后果:用户在「选服务器」里挑 daemon 时,一台「在线但建不了节点」的 daemon
// 和一台好的**长得一模一样**,只有点了提交才会失败 —— 这正是 #1545 描述的病,
// 在最傻瓜的那个入口上原样复发。
//
// 🔴 本模块只做**渲染**,不重算判据。
//    判据由拥有解析器的那个包(agent-node)算出、经 hub 原样带过来。
//    #1545 定的规矩是「判据只有一份,永远由拥有它的那个包计算」,而本仓的
//    历史统计是:自造判据四次,四次都比真判据更松 —— 一个更松的判据会显示
//    「可用」然后照样在建节点时失败,比现在的沉默更糟。
//
// 🔴 同理,**不复制 CLI 的 FIX_BY_REASON 修法表**。那张表会随 agent-node 的
//    版本长出新的 reason code,复制过来就是一份会静默漂掉的同义副本,而漂掉的
//    那一刻用户拿到的是一条错误的修复命令。这里只原样显示 hub 给的 reason
//    code,并指向那台机器上的 `anet doctor`(它与 daemon list 同源,见
//    agent-network/src/doctor-daemon-capability-wiring.test.ts)。
//
// 唯一从 agent-network/src/daemon-capability-display.ts 照搬的是**语义**:
//   ① can_create_nodes 不是 boolean ⇒ unknown,**绝不能当成 false**
//      (把没升级的 daemon 一律渲染成"不能建",会让人去修一台其实好好的机器);
//   ② 绝对年龄 = (now - last_seen_at) + create_capability_observed_ms_ago
//      —— daemon 只提供一个**时长**,绝对时间全部由 hub/本地的钟出,
//      它自己的钟偏移不会污染这个数;
//   ③ 年龄不四舍五入到「刚刚」—— 这一格存在的意义就是分辨新鲜和陈旧。

export type DaemonCapabilityKind = 'ready' | 'blocked' | 'unknown';

export interface DaemonCapabilityInput {
  can_create_nodes?: boolean;
  create_nodes_blocked_reason?: string;
  create_capability_observed_ms_ago?: number;
  last_seen_at?: string | null;
}

export interface DaemonCapabilityView {
  kind: DaemonCapabilityKind;
  /** 卡片上那一行短标签。 */
  label: string;
  /** 展开的一到两句:说清是什么、以及去哪修。blocked/unknown 必有。 */
  detail?: string;
  /** 这个读数有多旧;undefined = 连"多久以前测的"都不知道。 */
  ageMs?: number;
}

/** 毫秒 → 人读的相对时间。**不四舍五入到「刚刚」**。
 *  与 agent-network/src/daemon-capability-display.ts 的 formatAge 同语义。 */
export function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '?';
  if (ms < 1000) return `${Math.round(ms)}ms 前`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s 前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m 前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h 前`;
  return `${Math.floor(h / 24)}d 前`;
}

function parseLastSeen(v: string | null | undefined): number | undefined {
  if (typeof v !== 'string') return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
}

export function describeDaemonCapability(
  d: DaemonCapabilityInput,
  nowMs: number,
): DaemonCapabilityView {
  // ① 从来没报过 ⇒ unknown。**不是 false。**
  if (typeof d.can_create_nodes !== 'boolean') {
    return {
      kind: 'unknown',
      label: '创建能力未知',
      detail:
        '这台 daemon 没报过这一格(agent-node 早于 2.5.0-preview.55)。' +
        '升级那台机器的 agent-node 并重启 daemon 后才会有。',
    };
  }

  // ② 年龄:hub 的 last_seen_at 加上 daemon 自报的「测完到发出」那段。
  const lastSeen = parseLastSeen(d.last_seen_at);
  const observed = d.create_capability_observed_ms_ago;
  const ageKnown =
    lastSeen !== undefined && typeof observed === 'number' && Number.isFinite(observed);
  const ageMs = ageKnown ? Math.max(0, nowMs - lastSeen!) + observed! : undefined;

  if (d.can_create_nodes) {
    return ageMs === undefined
      ? {
          kind: 'ready',
          label: '可建节点',
          // 🔴 这句必须说清「不知道什么时候测的」以及为什么:
          //    agent-node ≤ 2.5.0-preview.54 开机只算一次并永久缓存,
          //    所以这个「可用」可能是几周前的事,而二进制早被换掉了。
          detail: '不知道是什么时候测的 —— 那台 daemon 的版本开机只算一次。重启它,或升级。',
        }
      : { kind: 'ready', label: `可建节点(${formatAge(ageMs)}测)`, ageMs };
  }

  // ③ blocked —— 原样带出 reason code,不猜修法。
  const reason = d.create_nodes_blocked_reason || 'anet_bin_unknown';
  const when = ageMs === undefined ? '(不知道是什么时候测的)' : `(${formatAge(ageMs)}测)`;
  return {
    kind: 'blocked',
    label: `建不了节点 ${when}`,
    detail:
      `原因代码:${reason}。完整原文和可粘贴的修法只在那台机器上 —— ` +
      '在它上面运行 `anet doctor` 或 `anet daemon list` 会打印出来' +
      '(带真实机器路径,按设计不上报)。',
    ageMs,
  };
}
