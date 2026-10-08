import { useEffect, useState } from 'react';
import { AgentTeamsSection } from './AgentTeams';
import type { HubConfig } from './api';
import type { AuthMe, NetworkMember } from './user-admin';
import { listRequirementPeople } from './requirement-people-api';
import { SettingsGroup, SettingsRow } from './settings-kit';
import { useTranslation } from './i18n-react';

type Props = { cfg: HubConfig; networkId: string; me: AuthMe | null; phone: boolean };

/** Member-readable names, not the administrator-only network-members API.
 * Hub remains authoritative for every write; teamPerms controls the existing UI.
 */
export default function AgentTeamsEntry(p: Omit<Props, 'networkId'> & { networkId?: string }) {
  return p.networkId ? <ScopedEntry key={JSON.stringify([p.cfg.serverUrl, p.cfg.token, p.networkId])} {...p} networkId={p.networkId} /> : null;
}

function ScopedEntry(p: Props) {
  const { t } = useTranslation();
  const [people, setPeople] = useState<NetworkMember[]>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setFailed(false);
    void listRequirementPeople({ ...p.cfg, networkId: p.networkId }).then(rows => {
      if (live) setPeople(rows.filter(r => r.kind === 'user' && !r.unavailable).map(r => ({ user_id: r.id, username: r.name, display_name: r.displayName || r.name, role: 'member' })));
    }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [p.cfg.serverUrl, p.cfg.token, p.networkId, attempt]);
  return <>
    {failed ? <SettingsGroup testID="team-people-error"><SettingsRow label={t('teams.loadFailed')} value={t('teams.retry')} onPress={() => setAttempt(n => n + 1)} /></SettingsGroup> : null}
    <AgentTeamsSection {...p} people={people} />
  </>;
}
