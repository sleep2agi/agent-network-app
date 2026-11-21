import { useEffect, useState } from 'react';
import type { HubConfig } from './api';
import AliasAvatar from './AliasAvatar';
import ChatInfoPanel from './ChatInfoPanel';
import { fetchMessageAvatarData } from './message-avatar-data';
import { messageAvatarTarget, type MessageAvatarTarget } from './message-avatar-target';
import type { ChatInfoPresentation } from './chat-info-model';
import { useTranslation } from './i18n-react';
import './i18n-users';

type Loaded = { target: MessageAvatarTarget; name: string; details: string[] };

/** A separate read scope prevents another sender's card from inheriting chat actions. */
export default function MessageSenderInfo({ cfg, networkId, author, currentAlias, presentation, paneWidth, headerHeight, onClose, onMessage }: {
  cfg: HubConfig;
  networkId: string;
  author: { nodeId?: string; userId?: string; label?: string };
  currentAlias: string;
  presentation: ChatInfoPresentation;
  paneWidth: number;
  headerHeight?: number;
  onClose: () => void;
  onMessage?: (target: { alias: string; networkId: string }) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setLoaded(null);
    setFailed(false);
    void fetchMessageAvatarData(cfg, networkId).then(data => {
      const nodes = data.nodes.filter(n => n.node_id && n.alias).map(n => ({ networkId, nodeId: n.node_id, alias: n.alias }));
      const users = data.members.map(u => ({ networkId, userId: u.user_id, username: u.username }));
      const target = messageAvatarTarget({ networkId, author, nodes, users });
      if (!active) return;
      if (target.kind === 'unresolved') { setFailed(true); return; }
      const member = target.kind === 'user' ? data.members.find(u => u.user_id === target.userId) : undefined;
      const node = target.kind === 'node' ? data.nodes.find(n => n.node_id === target.nodeId) : undefined;
      const name = target.kind === 'node' ? node?.node_name || target.alias : member?.display_name || target.username;
      const placement = target.kind === 'user' ? data.org?.members.find(m => m.user_id === target.userId) : undefined;
      const departmentId = target.kind === 'node' ? node?.department_id : placement?.department_id;
      const department = departmentId ? data.org?.departments.find(d => d.id === departmentId)?.name : undefined;
      // Missing metadata is unknown, not evidence that a sender has no department.
      const userRole = member?.role || 'member';
      const details = [target.kind === 'node' ? node?.role || 'Agent' : t(`users.role.${userRole}`),
        department || t(departmentId === null ? 'chat.sender.noDepartment' : 'chat.sender.unknownDepartment')];
      setLoaded({ target, name, details });
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [cfg.serverUrl, cfg.token, cfg.profileId, networkId, author.nodeId, author.userId, author.label, t]);

  const target = loaded?.target;
  const message = target?.kind === 'node' && target.alias !== currentAlias && onMessage
    ? { label: t('chat.sender.message'), onPress: () => { onClose(); onMessage({ alias: target.alias, networkId: target.networkId }); } }
    : undefined;
  const name = loaded?.name || author.label || t('chat.sender.title');
  // Avatar lookup is keyed by alias/username, not the mutable display name.
  const avatarAlias = target?.kind === 'node' ? target.alias
    : target?.kind === 'user' ? target.username : author.label || '';
  return <ChatInfoPanel
    visible presentation={presentation} groups={[]} alias={name}
    paneWidth={paneWidth} headerHeight={headerHeight} onClose={onClose} onRow={() => {}}
    identity={{ avatar: <AliasAvatar alias={avatarAlias} size={48} />, name,
      details: loaded?.details || [t(failed ? 'chat.sender.unavailable' : 'chat.sender.loading')], message }}
  />;
}
