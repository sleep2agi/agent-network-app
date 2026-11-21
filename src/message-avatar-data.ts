import { fetchHubNodes, type HubConfig } from './api';
import { fetchNetworkMembers } from './user-admin-api';
import { fetchOrg } from './org-api';

/** Read identities within the clicked message's network, never the account default.
 * Identity reads fail together: an incomplete directory cannot prove a label unambiguous.
 * Organization metadata is optional and must remain distinguishable from "no department".
 */
export async function fetchMessageAvatarData(cfg: HubConfig, networkId: string) {
  if (!networkId.trim()) throw new Error('network_id_required');
  const scoped = { ...cfg, networkId };
  const [nodeData, members, org] = await Promise.all([
    fetchHubNodes(scoped),
    fetchNetworkMembers(scoped, networkId),
    fetchOrg(scoped, networkId).catch(() => null),
  ]);
  return {
    networkId,
    nodes: nodeData.nodes ?? [],
    members,
    org,
  };
}
