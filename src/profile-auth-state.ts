type Listener = (profileId: string) => void;

const listeners = new Set<Listener>();
const reported = new Set<string>();

export const reportProfileUnauthorized = (profileId?: string): void => {
  if (!profileId || reported.has(profileId)) return;
  reported.add(profileId);
  listeners.forEach(listener => listener(profileId));
};

export const reportProfileAuthResponse = (status: number, profileId?: string): void => {
  // 403 can mean a valid account lacks permission for one endpoint. Only 401
  // proves the saved bearer credential itself must be refreshed.
  if (status === 401) reportProfileUnauthorized(profileId);
};

export const clearProfileUnauthorized = (profileId?: string): void => {
  if (profileId) reported.delete(profileId);
};

export const onProfileUnauthorized = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
