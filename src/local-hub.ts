import type { HubConfig } from './api';

export const LOCAL_HUB_PROFILE_ID = 'local-workspace';

export interface LocalHubResult {
  state: 'running' | 'running_external' | 'stopped' | 'not_provisioned' | 'error';
  endpoint: string;
  port: number;
  hubVersion: string;
  pid?: number | null;
  session?: HubConfig | null;
  error?: string | null;
  logsPath: string;
  requiresMigration: boolean;
  /** 本 app 捆绑的 Hub 版本(「升级本地 Hub」按钮标签)。旧 app 不带此字段。 */
  expectedHubVersion?: string;
}

const invokeLocalHub = async (command: string): Promise<LocalHubResult> => {
  const { invoke } = await import('@tauri-apps/api/core');
  return JSON.parse(await invoke<string>(command)) as LocalHubResult;
};

export const startLocalHub = (): Promise<LocalHubResult> => invokeLocalHub('start_local_hub');
export const localHubStatus = (): Promise<LocalHubResult> => invokeLocalHub('local_hub_status');
export const restartLocalHub = (): Promise<LocalHubResult> => invokeLocalHub('restart_local_hub');
export const stopLocalHub = async (): Promise<void> => {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('stop_local_hub');
};
export const openLocalHubLogs = async (): Promise<void> => {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('open_local_hub_logs');
};

export interface LocalHubBackupResult { path: string; restarted: boolean }

export const backupLocalHubData = async (): Promise<LocalHubBackupResult> => {
  const { invoke } = await import('@tauri-apps/api/core');
  return JSON.parse(await invoke<string>('backup_local_hub_data')) as LocalHubBackupResult;
};

export const deleteLocalHubData = async (): Promise<string> => {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('delete_local_hub_data', { confirmation: 'DELETE LOCAL WORKSPACE' });
};

// ---------------------------------------------------------------------------
// Vincent 2026-09-05:切到 Local workspace 报「No matching entry found in secure storage」、
// 本地 Hub 停着。原来 activateProfile 只调 switch_desktop_profile(读钥匙串里的 token),
// 从不启动本地 Hub;钥匙串条目一丢就在读 token 这一步失败,后面什么都不发生。
// 现在:切到 Local 先 start_local_hub(它会启动 Hub、凭据缺失时重新登录/恢复并把 profile 写回),
// 再 switch 让它成为当前 profile。远程 profile 路径不变。
// ---------------------------------------------------------------------------

export interface ActivateHubProfileDeps<Cfg> {
  isDesktop: () => boolean;
  startLocalHub: () => Promise<Pick<LocalHubResult, 'session' | 'error' | 'state'>>;
  switchHubProfile: (profileId: string) => Promise<Cfg>;
}

/** 切换到某个 profile;Local workspace 在桌面端先把本地 Hub 拉起来(含凭据恢复)再切。 */
export async function activateHubProfile<Cfg>(profileId: string, deps: ActivateHubProfileDeps<Cfg>): Promise<Cfg> {
  if (profileId === LOCAL_HUB_PROFILE_ID && deps.isDesktop()) {
    const local = await deps.startLocalHub();
    if (!local.session) {
      throw new Error(local.error || `本地工作区启动后没有返回会话(状态:${local.state})`);
    }
  }
  return deps.switchHubProfile(profileId);
}
