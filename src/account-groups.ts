// 设置 → 账号(管理员 2026-11-15「这页也特别丑」):其他账号按 Hub 分组,行里只留能区分彼此的信息。
// 以前每行都是「y.v****.top:9300 · admin · net_399bdf86f528」—— Hub 地址在每行重复、网络 id 整串露出,
// 三个都叫 admin 的账号只能靠读灰字区分。现在:同一个 Hub 的账号收进一组(组标题 = Hub 地址),
// 行副标题只写「用户名(和显示名不同时)· 网络 xxxxxx」。纯逻辑,桌面和手机共用。
import { LOCAL_HUB_PROFILE_ID } from './local-hub';
import { maskedHubHost } from './mask-hub-address';
import type { HubProfile } from './storage';

export type AccountHubGroup = { key: string; host: string; local: boolean; profiles: HubProfile[] };

/** 按 Hub(脱敏后的 host,含端口)分组;组的顺序 = 第一次出现的顺序,本机工作区单独一组排最前。 */
export function groupProfilesByHub(profiles: readonly HubProfile[]): AccountHubGroup[] {
  const out: AccountHubGroup[] = [];
  const byKey = new Map<string, AccountHubGroup>();
  for (const p of profiles) {
    const local = p.profileId === LOCAL_HUB_PROFILE_ID;
    const host = maskedHubHost(p.serverUrl);
    const key = local ? '\u0000local' : host;
    let g = byKey.get(key);
    if (!g) { g = { key, host, local, profiles: [] }; byKey.set(key, g); out.push(g); }
    g.profiles.push(p);
  }
  return out.sort((a, b) => Number(b.local) - Number(a.local));
}

/** 网络 id 的短写:`net_399bdf86f528` → `399bdf`。够区分,不把整串 id 摊给用户看。 */
export const shortNetworkId = (id?: string | null): string => (id ? id.replace(/^net_/, '').slice(0, 6) : '');

/** 分组里一行的副标题:用户名(显示名不同时才写)+ 网络短 id。Hub 地址已经在组标题里,不再重复。 */
export function accountRowDetail(p: Pick<HubProfile, 'username' | 'displayName' | 'networkId'>, networkLabel: string): string {
  const parts: string[] = [];
  if (p.username && p.displayName && p.displayName !== p.username) parts.push(p.username);
  const net = shortNetworkId(p.networkId);
  if (net) parts.push(`${networkLabel} ${net}`);
  return parts.join(' · ');
}
