/** Why a saved credential stopped working. `token_expired` = the hub's idle expiry (sign in again). */
export type UnauthorizedReason = 'token_expired';
type Listener = (profileId: string, reason?: UnauthorizedReason) => void;

const listeners = new Set<Listener>();
const reported = new Set<string>();
const reasons = new Map<string, UnauthorizedReason>();

export const reportProfileUnauthorized = (profileId?: string, reason?: UnauthorizedReason): void => {
  if (!profileId || reported.has(profileId)) return;
  reported.add(profileId);
  if (reason) reasons.set(profileId, reason);
  listeners.forEach(listener => listener(profileId, reason));
};

export const reportProfileAuthResponse = (status: number, profileId?: string, reason?: UnauthorizedReason): void => {
  // 403 can mean a valid account lacks permission for one endpoint. Only 401
  // proves the saved bearer credential itself must be refreshed.
  if (status === 401) reportProfileUnauthorized(profileId, reason);
};

/** The reason recorded with the last 401 for this profile, until it signs in again. */
export const profileUnauthorizedReason = (profileId?: string): UnauthorizedReason | undefined =>
  profileId ? reasons.get(profileId) : undefined;

export const clearProfileUnauthorized = (profileId?: string): void => {
  if (!profileId) return;
  reported.delete(profileId);
  reasons.delete(profileId);
};

export const onProfileUnauthorized = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
