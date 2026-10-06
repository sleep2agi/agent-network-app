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

// #653 修改密码:hub 在处理 POST /api/auth/password 时就吊销了这次请求用的令牌、另发一个新的。
// 同一时刻在飞的轮询还拿着旧令牌,回来是 401 —— 那不是「这个账号的登录失效了」,app 马上就换上新令牌。
// 所以:改密码请求一发出,旧令牌记为「正在换掉」;它的 401 不上报(不弹登录页)。成功 → 旧令牌永远留在这里
// (它已经死了,之后任何拿着它的迟到请求回 401 都是预期的);失败 → 撤销记录,旧令牌的 401 照常上报
// (例如网络错误时 hub 其实已经改了、我们没拿到新令牌 —— 那就该重新登录)。新令牌的 401 永远照常上报。
const retiringTokens = new Map<string, Set<string>>();

/** 改密码请求发出前调用;返回 end(succeeded)。 */
export const beginTokenRotation = (profileId: string | undefined, token: string): ((succeeded: boolean) => void) => {
  if (!profileId || !token) return () => {};
  const set = retiringTokens.get(profileId) ?? new Set<string>();
  set.add(token);
  retiringTokens.set(profileId, set);
  return (succeeded: boolean) => { if (!succeeded) set.delete(token); };
};

export const isRetiringToken = (profileId: string | undefined, token: string | undefined): boolean =>
  !!profileId && !!token && !!retiringTokens.get(profileId)?.has(token);

/** token = 这次请求用的令牌。传了且它正被(或已被)改密码换掉 → 401 不上报。 */
export const reportProfileAuthResponse = (status: number, profileId?: string, reason?: UnauthorizedReason, token?: string): void => {
  // 403 can mean a valid account lacks permission for one endpoint. Only 401
  // proves the saved bearer credential itself must be refreshed.
  if (status !== 401) return;
  if (isRetiringToken(profileId, token)) return;
  reportProfileUnauthorized(profileId, reason);
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
