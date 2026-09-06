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
export interface ChecklistRow { key: 'node' | 'npm' | 'anet' | 'daemon'; label: string; state: ChecklistState; detail: string }

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
