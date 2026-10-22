// Daemon 域 SKILLS 页:这台 daemon 自己的技能(只读),复用节点页的 NodeSkillsSection。
// 判定与空态文案在 daemon-skills-pane.ts。离线 / 不支持时不发请求。
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text } from './ui-text';
import { fetchNodeStatus, type HubConfig, type HubNode, type Session } from './api';
import { DAEMON_SKILLS_EMPTY_KEY, daemonSkillsView } from './daemon-skills-pane';
import { PendingCardTitle, PendingPanelCard } from './backend-pending-ui';
import { NodeSkillsSection } from './NodeSkillsSection';
import { buttonStyle, buttonTextStyle } from './elevation';
import { useTranslation } from './i18n-react';
import './i18n-daemon';
import { colors, spacing, type } from './theme';
import { usePoll } from './usePoll';

export default function DaemonSkillsPane({ cfg, alias, node, supervisorOnline }: { cfg: HubConfig; alias: string; node: HubNode | null; supervisorOnline?: boolean }) {
  const { t } = useTranslation();
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      // 只取这个 alias 的行。读不到全量就当"没读到",不退回 ?light=1(它没有 skills_capable)。
      const data = await fetchNodeStatus(cfg, alias);
      setSession((data.sessions ?? []).find(row => row.alias === alias) ?? null);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoaded(true);
    }
  }, [cfg, alias]);
  usePoll(() => { void load(); }, 10000, [load]);

  const view = daemonSkillsView({ node, session, statusLoaded: loaded, statusFailed: failed && !session, supervisorOnline });

  if (view.kind === 'ready' && node && session) {
    return (
      <View testID="daemon-skills-real" style={{ gap: spacing.md }}>
        <NodeSkillsSection cfg={cfg} alias={alias} node={node} session={session} />
      </View>
    );
  }
  return (
    <PendingPanelCard testID="daemon-skills-empty">
      <PendingCardTitle title={t('daemon.skills.title')} />
      {view.kind === 'empty' && view.reason === 'loading' ? <ActivityIndicator color={colors.accent} /> : null}
      <Text testID="daemon-skills-empty-reason" style={{ color: colors.textSecondary, fontSize: type.body, lineHeight: 20 }}>
        {t(DAEMON_SKILLS_EMPTY_KEY[view.kind === 'empty' ? view.reason : 'loading'])}
      </Text>
      {view.kind === 'empty' && (view.reason === 'status-unread' || view.reason === 'no-session') ? (
        <Pressable testID="daemon-skills-retry" accessibilityRole="button" onPress={() => { void load(); }} style={({ pressed }) => [buttonStyle('secondary'), { alignSelf: 'flex-start' }, pressed && { opacity: 0.85 }]}>
          <Text style={buttonTextStyle('secondary')}>{t('daemon.mgmt.retry')}</Text>
        </Pressable>
      ) : null}
    </PendingPanelCard>
  );
}
