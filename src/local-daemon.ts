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
  const nodeState: ChecklistState = !scan.node ? 'missing' : nodeVersionOk(scan.node.version) ? 'ok' : 'bad';
  return [
    { key: 'node', label: 'Node.js ≥ 22.13', state: nodeState, detail: scan.node ? tool(scan.node) + (nodeState === 'bad' ? '(版本太低)' : '') : '未找到 —— 从 https://nodejs.org 安装' },
    { key: 'npm', label: 'npm', state: scan.npm ? 'ok' : 'missing', detail: tool(scan.npm) },
    { key: 'anet', label: 'anet CLI', state: scan.anet ? 'ok' : 'missing', detail: scan.anet ? tool(scan.anet) : '未安装 —— 点安装会执行 npm install -g @sleep2agi/agent-network' },
    { key: 'daemon', label: '本机 daemon', state: scan.profileExists ? 'ok' : 'missing', detail: scan.profileExists ? `${scan.daemonName} · ${scan.nodeId ?? '(node_id 未知)'}` : `未初始化(将建在 ${scan.daemonDir})` },
  ];
}

/** 能不能点「安装」:Windows 不行;没 Node/npm 或 Node 太低不行(装不了 anet)。返回 null = 可以。 */
export function installBlocker(scan: LocalDaemonScan): string | null {
  if (!scan.supported) return scan.reason ?? '当前平台不支持本机 daemon';
  if (!scan.node) return '先安装 Node.js(≥ 22.13):https://nodejs.org';
  if (!nodeVersionOk(scan.node.version)) return `Node.js ${scan.node.version ?? ''} 太低,anet 需要 ≥ 22.13`;
  if (!scan.npm) return '有 Node.js 但没有 npm,请重新安装 Node.js';
  if (!scan.hubEndpoint) return '本地 Hub 还没运行,先切到 Local workspace';
  return null;
}
