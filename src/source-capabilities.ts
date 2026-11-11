// #4495 —— 用 Hub 投影出来的「源能力」决定入口能不能点（不再是写死 true）。
//
// 数据只来自 `GET /api/host-supervisors` 的那一行（Hub 只在**精确匹配**时才吐键）：
//   source_directory_read / project_new_session / session_attach /
//   source_fork_transport / source_node_delivery
//
// 规则（与 Hub 的兼容口径一致）：
//   · 键在且非空 = 支持；
//   · 键缺 = 不支持（不是「未知」——Hub 不会给半个值）；
//   · 老 Hub（整份列表都拿不到）= 能力未知：入口仍显示，但说明「当前 Hub 版本不提供该能力」，
//     不静默失败、也不假装支持。
//
// 这里只做门控与原因文案的**键**，真实文案在 i18n（避免把中文写进逻辑层）。

export interface DaemonSourceCaps {
  source_directory_read?: string | null;
  project_new_session?: string | null;
  session_attach?: string | null;
  source_fork_transport?: string | null;
  source_node_delivery?: string | null;
}

/** 这次读取 Hub 的结果：拿到列表 = 'ok'；老 Hub/失败 = 其它。 */
export type CapsSource = 'ok' | 'unsupported' | 'unknown';

export interface CapabilityGate {
  ok: boolean;
  /** 不能点时的 i18n 键（ok=true 时为 null）。 */
  reasonKey: string | null;
}

export interface SourceCapabilityGates {
  directory: CapabilityGate;
  projectNewSession: CapabilityGate;
  attach: CapabilityGate;
  fork: CapabilityGate;
  source: CapsSource;
  /** 只有在「Hub 读不到能力」时才有值：给 UI 显示一行说明（不参与门控）。 */
  hubNoticeKey?: string;
}

const present = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;

const gate = (ok: boolean, reasonKey: string): CapabilityGate => (ok ? { ok: true, reasonKey: null } : { ok: false, reasonKey });

/**
 * 把「这台 daemon 的能力行」翻译成四个入口的门。
 * @param row 该 daemon 在 /api/host-supervisors 里的那一行（找不到 = undefined）
 * @param source 这次列表读取的结果
 */
export function sourceCapabilityGates(row: DaemonSourceCaps | null | undefined, source: CapsSource): SourceCapabilityGates {
  if (source !== 'ok') {
    // 老 Hub / 读失败：**不门控**（入口照常显示，点进去由服务端给真实原因），
    // 同时在 UI 上看得到一句「当前 Hub 版本不提供该能力」。
    // 为什么不在这里关：规格要求「入口仍显示，但点进去说明」，而且此时我们**不知道**
    // 这台机器到底支持什么 —— 拿不到数据就把入口关掉，等于用「未知」冒充「不支持」。
    const r = 'sourcePalette.cap.hubUnsupported';
    return {
      directory: { ok: true, reasonKey: null }, projectNewSession: { ok: true, reasonKey: null },
      attach: { ok: true, reasonKey: null }, fork: { ok: true, reasonKey: null }, source, hubNoticeKey: r,
    };
  }
  // 列表拿到了，但这台 daemon 没有被列出来 ⇒ 能力无处可查 ⇒ 按「未知」处理：放行，不禁用。
  // （兼容优先：宁可让老 Hub/非守护节点保持 #4495 之前的行为，也不要误杀。）
  if (!row) {
    return {
      directory: { ok: true, reasonKey: null }, projectNewSession: { ok: true, reasonKey: null },
      attach: { ok: true, reasonKey: null }, fork: { ok: true, reasonKey: null }, source,
    };
  }
  // 拿到了行，但五条键一条都没有 ⇒ 与「读不到」同义（老 daemon / 老 Hub），同样放行 + 中性提示。
  const anyKey = present(row.source_directory_read) || present(row.project_new_session)
    || present(row.session_attach) || present(row.source_fork_transport) || present(row.source_node_delivery);
  if (!anyKey) {
    return {
      directory: { ok: true, reasonKey: null }, projectNewSession: { ok: true, reasonKey: null },
      attach: { ok: true, reasonKey: null }, fork: { ok: true, reasonKey: null }, source, hubNoticeKey: 'sourcePalette.cap.hubUnsupported',
    };
  }
  const directory = present(row.source_directory_read);
  return {
    // 目录是前提：没有 source_directory_read 就没有 projects/sessions 可列。
    directory: gate(directory, 'sourcePalette.cap.directory'),
    projectNewSession: gate(directory && present(row.project_new_session), 'sourcePalette.cap.projectNewSession'),
    attach: gate(directory && present(row.session_attach), 'sourcePalette.cap.attach'),
    // fork 需要「传输 + 投递」两条都在（Hub 侧也是成对放行）。
    fork: gate(present(row.source_fork_transport) && present(row.source_node_delivery), 'sourcePalette.cap.fork'),
    source,
  };
}

/** 取一行里我们关心的五个能力字段（其余字段忽略，避免把整行塞进纯函数）。 */
export function capsOfDaemonRow(row: DaemonSourceCaps | null | undefined): DaemonSourceCaps | null {
  if (!row || typeof row !== 'object') return null;
  return {
    ...(present(row.source_directory_read) ? { source_directory_read: row.source_directory_read } : {}),
    ...(present(row.project_new_session) ? { project_new_session: row.project_new_session } : {}),
    ...(present(row.session_attach) ? { session_attach: row.session_attach } : {}),
    ...(present(row.source_fork_transport) ? { source_fork_transport: row.source_fork_transport } : {}),
    ...(present(row.source_node_delivery) ? { source_node_delivery: row.source_node_delivery } : {}),
  };
}
