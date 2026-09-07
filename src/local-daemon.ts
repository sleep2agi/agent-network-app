// app#253 —— 本机 daemon 一键扫描与安装(Vincent 2026-09-06「有个一键扫描和安装按钮」)。
// Rust 侧:src-tauri/src/local_daemon.rs(scan / install)。这里是 invoke 包装 + 纯函数
// (清单行、能不能装的判定),纯函数有 ck 测试。

export interface DaemonToolInfo { path: string; version?: string | null }

export interface LocalDaemonScan {
  supported: boolean;
  reason?: string | null;
  shell: string;
  node?: DaemonToolInfo | null;
  npm?: DaemonToolInfo | null;
  anet?: DaemonToolInfo | null;
  /** 已下载的私有 Node(~/.anet/app/local-daemon/node)。 */
  privateNode?: DaemonToolInfo | null;
  /** 私有 prefix 里与 anet 同目录的 agent-node。 */
  agentNode?: DaemonToolInfo | null;
  /** PATH 上另有的 agent-node(旧版会被 daemon 误用)。 */
  agentNodeOnPath?: string | null;
  daemonDir: string;
  daemonName: string;
  profileExists: boolean;
  nodeId?: string | null;
  hubEndpoint?: string | null;
}

export interface DaemonStepReport { name: string; ok: boolean; output: string }

export interface LocalDaemonInstallReport {
  ok: boolean;
  nodeId?: string | null;
  steps: DaemonStepReport[];
  error?: string | null;
}

export const scanLocalDaemon = async (): Promise<LocalDaemonScan> => {
  const { invoke } = await import('@tauri-apps/api/core');
  return JSON.parse(await invoke<string>('local_daemon_scan')) as LocalDaemonScan;
};

export const installLocalDaemon = async (): Promise<LocalDaemonInstallReport> => {
  const { invoke } = await import('@tauri-apps/api/core');
  return JSON.parse(await invoke<string>('local_daemon_install')) as LocalDaemonInstallReport;
};

export type ChecklistState = 'ok' | 'missing' | 'bad';
export interface ChecklistRow { key: 'node' | 'npm' | 'anet' | 'agentNode' | 'daemon'; label: string; state: ChecklistState; detail: string }

/** 与 anet 包的 engines.node(>= 22.13)一致;Rust 侧 node_version_ok 同一判据。 */
export function nodeVersionOk(version: string | null | undefined): boolean {
  if (!version) return false;
  const [major = 0, minor = 0] = version.replace(/^v/, '').split('.').map(part => Number.parseInt(part, 10) || 0);
  return major > 22 || (major === 22 && minor >= 13);
}

export function daemonChecklist(scan: LocalDaemonScan): ChecklistRow[] {
  const tool = (info: DaemonToolInfo | null | undefined) => info ? `${info.version ?? '?'} · ${info.path}` : '未找到';
  const systemOk = !!scan.node && nodeVersionOk(scan.node.version);
  const privateOk = !!scan.privateNode && nodeVersionOk(scan.privateNode.version);
  const nodeState: ChecklistState = systemOk || privateOk ? 'ok' : scan.node ? 'bad' : 'missing';
  const nodeDetail = systemOk ? tool(scan.node)
    : privateOk ? `私有 ${tool(scan.privateNode)}`
    : scan.node ? `${tool(scan.node)}(版本太低)—— 点安装会自动下载一份私有 Node 22(约 50 MB,不动系统/nvm)`
    : '未找到 —— 点安装会自动下载一份私有 Node 22(约 50 MB,装在 ~/.anet/app/local-daemon/node,不动系统)';
  return [
    { key: 'node', label: 'Node.js ≥ 22.13', state: nodeState, detail: nodeDetail },
    { key: 'npm', label: 'npm', state: systemOk && scan.npm ? 'ok' : privateOk ? 'ok' : 'missing', detail: systemOk && scan.npm ? tool(scan.npm) : privateOk ? '私有 Node 自带' : '随私有 Node 一起下载' },
    { key: 'anet', label: 'anet CLI', state: scan.anet ? 'ok' : 'missing', detail: scan.anet ? tool(scan.anet) : '未安装 —— 点安装会装进 ~/.anet/app/local-daemon/anet(私有目录,不要 sudo)' },
    { key: 'agentNode', label: 'agent-node(daemon 运行时)', state: scan.agentNode ? 'ok' : 'missing', detail: scan.agentNode ? `私有 ${tool(scan.agentNode)}` : scan.agentNodeOnPath ? `私有目录没有 —— PATH 上的 ${scan.agentNodeOnPath} 可能是旧版(不支持 host_supervisor),点安装会装私有版本并优先使用` : '未安装 —— 点安装会装进私有目录(与 anet 同目录)' },
    { key: 'daemon', label: '本机 daemon', state: scan.profileExists ? 'ok' : 'missing', detail: scan.profileExists ? `${scan.daemonName} · ${scan.nodeId ?? '(node_id 未知)'}` : `未初始化(将建在 ${scan.daemonDir})` },
  ];
}

/** 能不能点「安装」:Windows 不行;没 Node/npm 或 Node 太低不行(装不了 anet)。返回 null = 可以。 */
export function installBlocker(scan: LocalDaemonScan): string | null {
  if (!scan.supported) return scan.reason ?? '当前平台不支持本机 daemon';
  // Node 缺/太低不再是阻塞:安装会自动下载私有 Node 22(Vincent 2026-09-06「node 也自动安装一下?」)
  if (!scan.hubEndpoint) return '本地 Hub 还没运行,先切到 Local workspace';
  return null;
}

// ---------------------------------------------------------------------------
// 「Hub 视角」(Vincent 2026-09-07 截图:本机 daemon ✓、1 个在线节点,但 host_supervisor 列表为空)。
// 清单里只有本机文件的视角;列表认的是 Hub 里 nodes 行的 config_snapshot.role。这里把 Hub 那一侧
// 的三个事实并排给出:会话在不在线、nodes 行有没有 / 快照 role 是什么、host_supervisors 里有没有。
// 纯函数,三份数据由调用方用既有 API 取(fetchStatus / fetchHubNodes / fetchHostSupervisors)。
// ---------------------------------------------------------------------------
export interface HubDaemonViewInput {
  nodeId: string | null | undefined;
  alias: string;
  sessions?: Array<{ alias?: string; status?: string; version?: string | null }> | null;
  nodes?: Array<{ node_id: string; alias?: string; role?: string | null; lifecycle_state?: string | null; config_snapshot?: { role?: string | null } | null }> | null;
  supervisors?: Array<{ daemon_node_id?: string; alias?: string; online?: boolean }> | null;
  /** 三个请求各自的错误(拿不到 ≠ 没有)。 */
  errors?: { sessions?: string; nodes?: string; supervisors?: string };
}

export interface HubDaemonView {
  ok: boolean;
  lines: string[];
  /** 一句话结论,给人读。 */
  verdict: string;
}

export function hubDaemonView(input: HubDaemonViewInput): HubDaemonView {
  const lines: string[] = [];
  const e = input.errors ?? {};
  const session = input.sessions?.find(s => s.alias === input.alias);
  lines.push(e.sessions ? `会话:查不到(${e.sessions})` : session ? `会话:${session.status ?? '?'} · agent-node ${session.version ?? '?'}` : '会话:Hub 上没有这个 alias(daemon 没起来或没注册)');
  const node = input.nodeId ? input.nodes?.find(n => n.node_id === input.nodeId) : undefined;
  const snapRole = node?.config_snapshot?.role ?? node?.role ?? null;
  lines.push(e.nodes ? `节点行:查不到(${e.nodes})` : !input.nodeId ? '节点行:本机没有 node_id' : node ? `节点行:有 · role=${snapRole ?? '(快照里没有 role)'}${node.lifecycle_state ? ` · ${node.lifecycle_state}` : ''}` : `节点行:Hub 这个网络里没有 ${input.nodeId}(daemon 注册到了别的网络,或 init 没成功)`);
  const listed = input.supervisors?.find(d => d.daemon_node_id === input.nodeId || d.alias === input.alias);
  lines.push(e.supervisors ? `host_supervisors:查不到(${e.supervisors})` : listed ? `host_supervisors:在列表里${listed.online ? '(online)' : '(offline)'}` : 'host_supervisors:不在列表里');
  const ok = !!listed;
  let verdict: string;
  if (ok) verdict = 'Hub 已经认到这台 daemon,选服务器列表应能看到它。';
  else if (!session) verdict = 'daemon 进程没有向 Hub 注册:点「打开日志」看 daemon 输出(常见:hub 地址/凭据不对,或进程已退出)。';
  else if (!node) verdict = 'daemon 在线但 Hub 这个网络里没有它的节点行:大概率注册到了别的网络,重新点「重新注册并启动本机 daemon」。';
  else if (snapRole !== 'host_supervisor') verdict = `daemon 在线、节点行也在,但配置快照的 role 是 ${snapRole ?? '空'} 而不是 host_supervisor:daemon 用的多半是 PATH 上的旧版 agent-node(不支持 host_supervisor)。点「重新注册并启动本机 daemon」,安装器会装私有 agent-node 并先停掉旧进程。`;
  else verdict = '节点行 role 是 host_supervisor 却不在列表里:多半是 node token 被吊销(多次重新注册后旧进程还在跑旧 token)。先停掉旧 daemon 再重新注册。';
  return { ok, lines, verdict };
}
