// 没有打开的会话时按语音快捷键(voice-shortcut-model.ts)→「先打开一个会话」:窗口底部居中,几秒后消失。
// 录音本身的界面是输入框里的录音条(DesktopVoiceBar.tsx),这里只有这一条提示。
import { StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { colors, onThemeChange, spacing } from './theme';

export function ShortcutToast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <View pointerEvents="none" style={styles.toastWrap}>
      <View style={styles.toast} testID="shortcut-toast" accessibilityLiveRegion="polite">
        <Text style={styles.toastText}>{text}</Text>
      </View>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  // 只在没有会话时出现(没有输入框可挡),贴近窗口底部,不压设置页页脚那段说明。
  toastWrap: { position: 'absolute', left: 0, right: 0, bottom: 24, alignItems: 'center' },
  toast: { paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  toastText: { color: colors.text, fontSize: 12 },
});

// 与其它组件同一套主题写法:模块级 styles 随主题重建。
let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
