// Hub req #938 — 「复制节点」对话框。节点详情和 Daemon 节点列表共用。
import { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import DialogFrame from './DialogFrame';
import { cloneNode, type HubConfig } from './api';
import { describeNodeNameRejection } from './node-name';
import {
  CLONE_NOTE_KEYS,
  cloneDraft,
  suggestCloneName,
  type CloneSource,
} from './node-clone';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-node-clone';
import { colors, radius, spacing, type as typeScale, weight } from './theme';
import { buttonStyle, buttonTextStyle } from './elevation';
import { nodeActionVisual } from './node-action-visual';

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
  onDone: (outcome: { demo: boolean; name: string; copySession: boolean }) => void;
}) {
  useTranslation();
  const [name, setName] = useState(() => suggestCloneName(source.name || source.alias, takenNames));
  const [copySession, setCopySession] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [demo, setDemo] = useState(false);
  const draft = cloneDraft({ source, name, copySession, taken: takenNames });

  const finish = (outcome: { demo: boolean; name: string; copySession: boolean }) => {
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
      finish({ demo: false, name: draft.request.name, copySession });
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
    <DialogFrame
      testID="clone-node-dialog"
      title={t('nodeClone.title')}
      subtitle={source.name || source.alias}
      closeLabel={t('nodeClone.cancel')}
      onClose={() => { if (!busy) onClose(); }}
      footer={(
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm }}>
          {demo ? null : (
            <Pressable
              testID="clone-node-cancel"
              accessibilityRole="button"
              disabled={busy}
              onPress={onClose}
              style={({ pressed }) => [buttonStyle('secondary'), pressed && { opacity: 0.85 }]}
            >
              <Text style={buttonTextStyle('secondary')}>{t('nodeClone.cancel')}</Text>
            </Pressable>
          )}
          <Pressable
            testID="clone-node-submit"
            accessibilityRole="button"
            disabled={busy || (!demo && !draft.ok)}
            onPress={() => {
              if (demo) finish({ demo: true, name: draft.ok ? draft.request.name : name.trim(), copySession });
              else void submit();
            }}
            style={({ pressed }) => [buttonStyle('primary'), (busy || (!demo && !draft.ok)) && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
          >
            <Text style={buttonTextStyle('primary')}>{demo ? t('nodeClone.ack') : busy ? t('nodeClone.working') : t('nodeClone.submit')}</Text>
          </Pressable>
        </View>
      )}
    >
      <View style={{ gap: spacing.md }}>
        <Text style={{ color: colors.textSecondary, fontSize: typeScale.body, lineHeight: 20 }}>{t('nodeClone.source', { name: source.name || source.alias })}</Text>
        <View style={{ gap: spacing.xs }}>
          <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>{t('nodeClone.nameLabel')}</Text>
          <TextInput
            testID="clone-node-name"
            value={name}
            onChangeText={value => { setName(value); setError(''); setDemo(false); }}
            editable={!busy && !demo}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t('nodeClone.nameLabel')}
            placeholderTextColor={colors.textMuted}
            style={{ color: colors.text, borderWidth: 1, borderColor: error ? colors.failed : colors.border, borderRadius: radius.control, padding: spacing.md, fontSize: typeScale.body, backgroundColor: colors.inputBg }}
          />
          {error ? <Text testID="clone-node-error" style={{ color: colors.failed, fontSize: typeScale.small, lineHeight: 18 }}>{error}</Text> : null}
          {!error && !draft.ok ? <Text testID="clone-node-name-hint" style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }}>{t(draft.messageKey)}</Text> : null}
        </View>
        <View style={{ backgroundColor: colors.subtleFill, borderRadius: radius.control, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
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
        <View testID="clone-node-notes" style={{ gap: spacing.xs }}>
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
    </DialogFrame>
  );
}
