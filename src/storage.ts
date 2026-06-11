import * as SecureStore from 'expo-secure-store';
import { HubConfig } from './api';

// Token + server persist in the platform keystore (Android Keystore /
// iOS Keychain) so login survives app restarts. Vincent tg 683 known
// gap: v0.1.1 lost the session on kill — this closes it.

const KEY = 'hub_config_v1';

export const saveConfig = async (cfg: HubConfig): Promise<void> => {
  await SecureStore.setItemAsync(KEY, JSON.stringify(cfg));
};

export const loadConfig = async (): Promise<HubConfig | null> => {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.serverUrl === 'string' && typeof parsed?.token === 'string') {
      return parsed as HubConfig;
    }
    return null;
  } catch {
    return null;
  }
};

export const clearConfig = async (): Promise<void> => {
  await SecureStore.deleteItemAsync(KEY);
};
