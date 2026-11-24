// 聊天里的「密钥输入卡」（admin 2026-11-20 插队需求）。
//
// 只在 agent 举手（secret_request_ui）时出现，替代那条原始 tool-call 文本。
// 样式与交互抄 NodeSecretsSection 的「输入 key → 请求 → 等 revision → 轮询」，尺寸收成气泡大小。
//
// 值的边界（和节点密钥页同一条规矩）：
//   · 值只存在于这张卡片的输入框状态与 onSubmit 的参数里；
//   · 不写日志、不进消息正文、不进任何提示文案；保存后父级发的是「{KEY} 已保存。」；
//   · agent 从头到尾看不到值。
import type { ReactNode } from 'react';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Ionicons } from './icons';
import { Text, TextInput } from './ui-text';
import { colors, radius, spacing, type, weight } from './theme';
import type { SecretRequest } from './secret-request';

export type SecretRequestPhase = 'idle' | 'saving' | 'saved' | 'error';

export default function SecretRequestCard({
  request, phase, error, onSave, savedFooter, testID = 'secret-request-card', bare = false,
}: {
  request: SecretRequest;
  phase: SecretRequestPhase;
  error?: string;
  /** 只在用户点保存时调用；值作为参数传出，不落到卡片以外的地方。 */
  onSave: (value: string) => void;
  /** 保存完成后可选的底部操作区（例如 #5505 的「立即重启使其生效」按钮）。 */
  savedFooter?: ReactNode;
  testID?: string;
  /** 放在聊天回复气泡里时不再画自己的边框（气泡已经是框）。 */
  bare?: boolean;
}) {
  const [value, setValue] = useState('');
  const [shown, setShown] = useState(false);
  const title = request.label ? request.label : request.key;
  const saved = phase === 'saved';
  const saving = phase === 'saving';
  const disabled = saved || saving || !value.trim();

  return (
    <View testID={testID} style={bare ? { maxWidth: 420, gap: spacing.sm } : {
      maxWidth: 420,
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radius.surface,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: type.body, fontWeight: weight.strong }} numberOfLines={1}>
          {request.hint ? title : `需要你的${title}`}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: type.small }} numberOfLines={1} testID={`${testID}-key`}>
          {request.key}
        </Text>
      </View>

      {saved ? (
        <View style={{ gap: spacing.xs }}>
          <Text testID={`${testID}-saved`} style={{ color: colors.running, fontSize: type.small }}>
            {`${request.key} 已保存。`}
          </Text>
          {savedFooter ?? null}
        </View>
      ) : (
        <>
          <Text style={{ color: colors.textSecondary, fontSize: type.small }}>{request.hint || '内容不会出现在聊天里，agent 也看不到。'}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <TextInput
              testID={`${testID}-input`}
              value={value}
              onChangeText={setValue}
              placeholder={`粘贴 ${request.key}`}
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!shown}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!saving}
              onSubmitEditing={() => { if (!disabled) onSave(value); }}
              style={{
                flex: 1,
                minHeight: 34,
                paddingHorizontal: spacing.sm,
                paddingVertical: 6,
                borderRadius: radius.surface,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.inputBg,
                color: colors.text,
                fontSize: type.body,
                outlineStyle: 'none',
              } as object}
            />
            <Pressable
              testID={`${testID}-reveal`}
              accessibilityRole="button"
              accessibilityLabel={shown ? '隐藏' : '显示'}
              hitSlop={8}
              onPress={() => setShown(s => !s)}
            >
              <Ionicons name={shown ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textMuted} />
            </Pressable>
            <Pressable
              testID={`${testID}-submit`}
              accessibilityRole="button"
              accessibilityLabel={`保存 ${request.key}`}
              disabled={disabled}
              onPress={() => onSave(value)}
              style={{
                paddingHorizontal: spacing.md,
                paddingVertical: 8,
                borderRadius: radius.surface,
                backgroundColor: colors.accent,
                opacity: disabled ? 0.5 : 1,
              }}
            >
              {saving
                ? <ActivityIndicator size="small" color={colors.onAccent} />
                : <Text style={{ color: colors.onAccent, fontSize: type.small, fontWeight: weight.strong }}>{saved ? '已保存' : '保存'}</Text>}
            </Pressable>
          </View>
          {request.hint ? (
            <Text style={{ color: colors.textMuted, fontSize: type.small }}>安全保存，AI 看不到内容；这个 AI 下次启动后可用（环境变量 {request.key}）。</Text>
          ) : null}
          {phase === 'error' && error ? (
            <Text testID={`${testID}-error`} style={{ color: colors.failed, fontSize: type.small }}>{error}</Text>
          ) : null}
        </>
      )}
    </View>
  );
}
