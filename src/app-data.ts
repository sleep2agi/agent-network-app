import * as FileSystem from 'expo-file-system/legacy';

const isTauri = () => typeof window !== 'undefined' && !!(globalThis as any).__TAURI_INTERNALS__;
const mobileRoot = `${FileSystem.documentDirectory}anet-app/`;

export const readAppData = async (relative: string): Promise<string | null> => {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string | null>('read_app_data', { relative });
  }
  try {
    const target = `${mobileRoot}${relative}`;
    const info = await FileSystem.getInfoAsync(target);
    return info.exists ? await FileSystem.readAsStringAsync(target) : null;
  } catch {
    return null;
  }
};

export const writeAppData = async (relative: string, contents: string): Promise<void> => {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('write_app_data', { relative, contents });
    return;
  }
  await FileSystem.makeDirectoryAsync(mobileRoot, { intermediates: true });
  await FileSystem.writeAsStringAsync(`${mobileRoot}${relative}`, contents);
};

export const deleteAppData = async (relative: string): Promise<void> => {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('delete_app_data', { relative });
    return;
  }
  await FileSystem.deleteAsync(`${mobileRoot}${relative}`, { idempotent: true });
};

