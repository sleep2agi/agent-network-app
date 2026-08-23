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
