import * as SecureStore from 'expo-secure-store';
import type { HubConfig } from './api';
import { profileIdFor } from './profile-model';

const REGISTRY_KEY = 'hub_profiles_v2';
const ACTIVE_KEY = 'hub_active_profile_v2';
const LEGACY_KEY = 'hub_config_v1';
const TOKEN_PREFIX = 'hub_profile_token_v2_';

export interface HubProfile {
  id: string;
  serverUrl: string;
  username: string;
  networkId?: string;
  label?: string;
  createdAt: number;
  lastUsedAt: number;
}

export interface ActiveHubProfile {
  profile: HubProfile;
  cfg: HubConfig;
}

const readRegistry = async (): Promise<HubProfile[]> => {
  try {
    const raw = await SecureStore.getItemAsync(REGISTRY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(p => p && typeof p.id === 'string' && typeof p.serverUrl === 'string') : [];
  } catch {
    return [];
  }
};

const writeRegistry = (profiles: HubProfile[]) =>
  SecureStore.setItemAsync(REGISTRY_KEY, JSON.stringify(profiles));

const tokenKey = (id: string) => `${TOKEN_PREFIX}${id}`;

export const listHubProfiles = async (): Promise<HubProfile[]> =>
  (await readRegistry()).sort((a, b) => b.lastUsedAt - a.lastUsedAt);

export const saveHubProfile = async (cfg: HubConfig, username: string, label?: string): Promise<HubProfile> => {
  const profiles = await readRegistry();
  const id = profileIdFor(cfg.serverUrl, username, cfg.networkId);
  const now = Date.now();
  const existing = profiles.find(p => p.id === id);
  const profile: HubProfile = {
    id,
    serverUrl: cfg.serverUrl,
    username: username.trim(),
    networkId: cfg.networkId,
    label: label?.trim() || existing?.label,
    createdAt: existing?.createdAt ?? now,
    lastUsedAt: now,
  };
  await SecureStore.setItemAsync(tokenKey(id), cfg.token);
  await writeRegistry([profile, ...profiles.filter(p => p.id !== id)]);
  await SecureStore.setItemAsync(ACTIVE_KEY, id);
  return profile;
};

export const activateHubProfile = async (id: string): Promise<ActiveHubProfile | null> => {
  const profiles = await readRegistry();
  const found = profiles.find(p => p.id === id);
  if (!found) return null;
  const token = await SecureStore.getItemAsync(tokenKey(id));
  if (!token) return null;
  const profile = { ...found, lastUsedAt: Date.now() };
  await writeRegistry([profile, ...profiles.filter(p => p.id !== id)]);
  await SecureStore.setItemAsync(ACTIVE_KEY, id);
  return { profile, cfg: { serverUrl: profile.serverUrl, token, networkId: profile.networkId, profileId: profile.id } };
};

export const removeHubProfile = async (id: string): Promise<void> => {
  const profiles = await readRegistry();
  await writeRegistry(profiles.filter(p => p.id !== id));
  await SecureStore.deleteItemAsync(tokenKey(id));
  if ((await SecureStore.getItemAsync(ACTIVE_KEY)) === id) await SecureStore.deleteItemAsync(ACTIVE_KEY);
};

export const loadActiveHubProfile = async (): Promise<ActiveHubProfile | null> => {
  try {
    let profiles = await readRegistry();
    let activeId = await SecureStore.getItemAsync(ACTIVE_KEY);

    // One-time, lossless migration from the single-account v1 record. The
    // username was not stored in v1, so preserve it as a disclosed legacy
    // label until /api/auth/me or a fresh login supplies the real username.
    if (!profiles.length) {
      const legacyRaw = await SecureStore.getItemAsync(LEGACY_KEY);
      if (legacyRaw) {
        const legacy = JSON.parse(legacyRaw) as HubConfig;
        if (typeof legacy.serverUrl === 'string' && typeof legacy.token === 'string') {
          const migrated = await saveHubProfile(legacy, '已保存账号');
          profiles = [migrated];
          activeId = migrated.id;
          await SecureStore.deleteItemAsync(LEGACY_KEY);
        }
      }
    }

    const id = activeId ?? profiles[0]?.id;
    return id ? activateHubProfile(id) : null;
  } catch {
    return null;
  }
};
