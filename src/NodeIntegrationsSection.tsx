// Node 层 — SKILLS / 令牌 / Provider（与 Hub、Daemon 同一套 tab IA）。
import { useState } from 'react';
import { View } from 'react-native';
import type { HubConfig, HubNode, Session } from './api';
import { BackendPendingIntegration } from './BackendPendingDemo';
import type { PendingTab } from './backend-pending-ui';
import NodeSkillsSection from './NodeSkillsSection';
import { PendingPanelCard, PendingCardTitle } from './backend-pending-ui';
import { useTranslation } from './i18n-react';
import './i18n-backend-pending';
import { spacing } from './theme';

export default function NodeIntegrationsSection({
  cfg,
  alias,
  node,
  session,
  skillsCapable,
  readOnly,
}: {
  cfg: HubConfig;
  alias: string;
  node: HubNode | null | undefined;
  session: Session;
  skillsCapable: boolean;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<PendingTab>('skills');
  const skillsSlot = skillsCapable ? (
    <PendingPanelCard testID="node-pending-skills-live">
      <PendingCardTitle title={t('backendPending.section.skills')} subtitle={t('backendPending.skillsLiveHint')} />
      <NodeSkillsSection cfg={cfg} alias={alias} node={node ?? null} session={session} readOnly={readOnly} />
    </PendingPanelCard>
  ) : undefined;
  return (
    <View testID="node-integrations-section" style={{ gap: spacing.md }}>
      <BackendPendingIntegration
        layer="node"
        tab={tab}
        onTabChange={setTab}
        showTabs
        testIDPrefix="node-pending"
        skillsSlot={skillsSlot}
      />
    </View>
  );
}
