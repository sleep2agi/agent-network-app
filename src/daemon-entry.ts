// Hub 域集成 → Daemon。点进去和 Hub 概览点一台机器是同一条路：
// openDaemonFromHub(alias) → 守护进程管理页（节点设置 + 虚拟机域设置）。
// 数据只读现有 GET /api/host-supervisors，不新开接口。
// 一台就直接打开；多台先列出别名，点一行再走同一条路。

export type DaemonEntryRow = {
  alias?: string | null;
  hostname?: string | null;
  online?: boolean | null;
};

export type DaemonEntryResult =
  | { ok: true; daemons?: readonly DaemonEntryRow[] | null }
  | { ok: false; unconfirmed?: boolean };

export type DaemonEntryChoice = {
  alias: string;
  hostname: string | null;
  online: boolean | null;
};

export type DaemonEntryTarget =
  | { kind: 'open'; alias: string }
  | { kind: 'choose'; daemons: DaemonEntryChoice[] }
  | { kind: 'missing' }
  | { kind: 'unsupported' }
  | { kind: 'error' };

/** One unique alias opens that daemon. Several stay a list, in the order the Hub sent them. */
export function daemonEntryTarget(result: DaemonEntryResult): DaemonEntryTarget {
  if (!result.ok) return result.unconfirmed ? { kind: 'unsupported' } : { kind: 'error' };
  const seen = new Set<string>();
  const daemons: DaemonEntryChoice[] = [];
  for (const row of result.daemons ?? []) {
    const alias = row.alias?.trim() ?? '';
    if (!alias || seen.has(alias)) continue;
    seen.add(alias);
    const hostname = row.hostname?.trim() || null;
    daemons.push({
      alias,
      hostname,
      online: typeof row.online === 'boolean' ? row.online : null,
    });
  }
  if (daemons.length === 1) return { kind: 'open', alias: daemons[0].alias };
  if (daemons.length === 0) return { kind: 'missing' };
  return { kind: 'choose', daemons };
}
