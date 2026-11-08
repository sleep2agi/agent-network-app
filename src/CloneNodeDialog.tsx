// Hub req #938 — 「复制节点」浮层。节点详情和 Daemon 节点列表共用。
//
// 版式与 #4130 模型命令面板同一套：浮层卡片 + 当前来源行（✓）+ 卡片内紧凑确认区
// （名称 / 工作目录 / 是否复制会话 + 提交），不再另开老式分步弹窗。
// 请求体仍然走 node-clone.ts 的 cloneDraft（clone_node 工具，字段名不变）。
import { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { cloneNode, type HubConfig } from './api';
import { describeNodeNameRejection } from './node-name';
import {
  CLONE_NOTE_KEYS,
  CLONE_WORKDIR_POLICIES,
  cloneDraft,
  suggestCloneName,
  type CloneDialogResult,
  type CloneSource,
  type CloneWorkdirPolicy,
} from './node-clone';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-node-clone';
import { colors, radius, spacing, type as typeScale, weight } from './theme';
import { buttonStyle, buttonTextStyle } from './elevation';
import { nodeActionVisual } from './node-action-visual';
import { PaletteOverlay, makePaletteStyles } from './palette-kit';

export function CloneNodeButton({ testID, disabled, onPress }: { testID: string; disabled?: boolean; onPress: () => void }) {
  useTranslation();
  const visual = nodeActionVisual({
    card: colors.card, border: colors.border, textSecondary: colors.textSecondary,
    blocked: colors.blocked, failed: colors.failed, accent: colors.accent,
  }, 'primary');
  const label = t('nodeClone.title');
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [{
        minHeight: 40,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        borderRadius: radius.control,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
        borderColor: visual.borderColor,
        backgroundColor: visual.backgroundColor,
      }, disabled && { opacity: 0.4 }, pressed && !disabled && { opacity: 0.85 }]}
    >
      <Text style={{ color: visual.textColor, fontSize: typeScale.body, fontWeight: weight.strong }}>{label}</Text>
    </Pressable>
  );
}

export default function CloneNodeDialog({
  cfg,
  source,
  takenNames,
  onClose,
  onDone,
}: {
  cfg: HubConfig;
  source: CloneSource;
  takenNames: readonly string[];
  onClose: () => void;
  onDone: (outcome: CloneDialogResult) => void;
}) {
  useTranslation();
  const styles = makePaletteStyles();
  const [name, setName] = useState(() => suggestCloneName(source.name || source.alias, takenNames));
  const [copySession, setCopySession] = useState(true);
  const [workdirPolicy, setWorkdirPolicy] = useState<CloneWorkdirPolicy>('new_empty');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [demo, setDemo] = useState(false);
  const draft = cloneDraft({ source, name, copySession, workdirPolicy, taken: takenNames });

  const finish = (outcome: CloneDialogResult) => {
    onDone(outcome);
    onClose();
  };

  const submit = async () => {
    if (busy || !draft.ok) {
      if (!draft.ok) setError(t(draft.messageKey));
      return;
    }
    setBusy(true);
    setError('');
    const result = await cloneNode(cfg, draft.request);
    setBusy(false);
    if (result.ok) {
      finish({
        demo: false,
        pending: true,
        name: result.child_name,
        copySession: result.copy_session,
        workdirPolicy: result.workdir_policy,
        sessionDetail: result.sessionDetail,
      });
      return;
    }
    if (result.demo) {
      setDemo(true);
      return;
    }
    const named = describeNodeNameRejection(result.error, draft.request.name, 'hub');
    setError(named ?? (result.errorKey ? t(result.errorKey) : result.error));
  };

  return (
    <PaletteOverlay testID="clone-node-dialog" onClose={() => { if (!busy) onClose(); }}>
      <View style={styles.header}>
        <Text style={styles.headerTitle} numberOfLines={1} testID="clone-node-dialog-title">{t('nodeClone.title')}</Text>
        <Pressable
          testID="clone-node-cancel"
          accessibilityRole="button"
          accessibilityLabel={t('nodeClone.cancel')}
          disabled={busy}
          onPress={onClose}
          hitSlop={8}
          style={styles.closeBtn}
        >
          <Ionicons name="close" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>
      <Text style={styles.headerSub} numberOfLines={1}>{t('nodeClone.source', { name: source.name || source.alias })}</Text>

      {/* 来源行：和来源浮层里「当前项」同一副长相（浅灰底 + ✓），只是这里不可切换。 */}
      <View style={[styles.row, styles.rowCurrent]} testID="clone-node-source-row">
        <View style={styles.rowMain}>
          <Text style={styles.rowLabel} numberOfLines={1}>{source.name || source.alias}</Text>
          <Text style={styles.rowDetail} numberOfLines={1}>{source.nodeId}{source.daemonNodeId ? ` · daemon ${source.daemonNodeId}` : ''}</Text>
        </View>
        <Ionicons name="checkmark" size={18} color={colors.textSecondary} />
      </View>

      <View style={styles.confirm}>
        <View style={styles.confirmRow}>
          <TextInput
            testID="clone-node-name"
            value={name}
            onChangeText={value => { setName(value); setError(''); setDemo(false); }}
            editable={!busy && !demo}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t('nodeClone.nameLabel')}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={t('nodeClone.nameLabel')}
            style={[styles.confirmInput, error && { borderColor: colors.failed }]}
          />
          <Pressable
            testID="clone-node-submit"
            accessibilityRole="button"
            disabled={busy || (!demo && !draft.ok)}
            onPress={() => {
              if (demo) finish({ demo: true, pending: false, name: draft.ok ? draft.request.name : name.trim(), copySession, workdirPolicy, sessionDetail: null });
              else void submit();
            }}
            style={[styles.primaryBtn, (busy || (!demo && !draft.ok)) && { opacity: 0.4 }]}
          >
            <Text style={styles.primaryBtnText}>{demo ? t('nodeClone.ack') : busy ? t('nodeClone.working') : t('nodeClone.submit')}</Text>
          </Pressable>
        </View>
        {error ? <Text testID="clone-node-error" style={{ color: colors.failed, fontSize: typeScale.small, lineHeight: 18 }}>{error}</Text> : null}
        {!error && !draft.ok ? <Text testID="clone-node-name-hint" style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }}>{t(draft.messageKey)}</Text> : null}

        <View testID="clone-node-workdir" accessibilityRole="radiogroup" style={{ gap: spacing.xs }}>
          <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>{t('nodeClone.workdirLabel')}</Text>
          <View style={{ flexDirection: 'row', padding: 2, borderRadius: radius.control, backgroundColor: colors.subtleFill, borderWidth: 1, borderColor: colors.border, gap: 2 }}>
            {CLONE_WORKDIR_POLICIES.map(policy => {
              const on = workdirPolicy === policy;
              return (
                <Pressable
                  key={policy}
                  testID={`clone-node-workdir-${policy}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on, disabled: busy || demo }}
                  disabled={busy || demo}
                  onPress={() => setWorkdirPolicy(policy)}
                  style={({ pressed }) => [{
                    flex: 1,
                    minHeight: 34,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: radius.item,
                    borderWidth: 1,
                    borderColor: on ? colors.accent : 'transparent',
                    backgroundColor: on ? colors.tonalBg : colors.card,
                    paddingHorizontal: spacing.sm,
                    paddingVertical: spacing.xs,
                  }, pressed && !(busy || demo) && { opacity: 0.85 }]}
                >
                  <Text style={{ color: on ? colors.accent : colors.textSecondary, fontSize: typeScale.small, fontWeight: on ? weight.strong : weight.regular }}>{t(`nodeClone.workdir.${policy}`)}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }}>{t(`nodeClone.workdir.hint.${workdirPolicy}`)}</Text>
        </View>

        <View style={{ backgroundColor: colors.subtleFill, borderRadius: radius.control, padding: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={{ color: colors.text, fontSize: typeScale.body, fontWeight: weight.strong }}>{t('nodeClone.copySession')}</Text>
            <Text style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }}>{t('nodeClone.copySessionHint')}</Text>
          </View>
          <Switch
            testID="clone-node-copy-session"
            accessibilityLabel={t('nodeClone.copySession')}
            value={copySession}
            disabled={busy || demo}
            onValueChange={setCopySession}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor={colors.card}
          />
        </View>

        <View testID="clone-node-notes" style={{ gap: 2 }}>
          {CLONE_NOTE_KEYS.map(key => (
            <Text key={key} style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }}>{`· ${t(key)}`}</Text>
          ))}
        </View>
        {demo ? (
          <View testID="clone-node-demo" style={{ borderWidth: 1, borderColor: colors.blocked, borderRadius: radius.control, padding: spacing.md, gap: spacing.xs, backgroundColor: colors.card }}>
            <Text style={{ color: colors.blocked, fontSize: typeScale.small, fontWeight: weight.strong }}>{t('nodeClone.demoBadge')}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: typeScale.small, lineHeight: 18 }}>{t('nodeClone.demoBody')}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.source} numberOfLines={1}>{t('nodeClone.cardBody')}</Text>
    </PaletteOverlay>
  );
}
