// 手机专属的交互 / 呈现 —— 一张名单,phone-only-ui.test.ts 按它扫整个 src/ + App.tsx。
//
// Owner 2026-09-27:「Windows / Mac 跟安卓版肯定是不一样的，你为什么要弄成一样的？」
// 那天的例子是桌面点 🎤 冒出手机的「按住说话」浮层和「上滑取消」。同一类的还有:鼠标按住气泡弹出手机底部
// action sheet、定时任务的表单整窗从底部滑上来、桌面「选服务器」写着「下拉刷新」(桌面根本拉不动)。
// 它们的共同点是**渲染 / 绑定处没有问一句「这是手指还是鼠标」**(pointer-ui.ts)。这里列出这类东西,
// 测试要求每一处都带着那句问话;新增一个手机专属的东西 = 在这里加一行。
//
// 只给测试用,app 不 import 这个文件。

/** 认得的平台判定(交互方式或布局)。门只认这些名字 —— 新造一个判定就先加到这里。 */
export const PREDICATE_IDS = [
  'pointer', // pointer-ui.ts pointerUi() 的结果,各屏的本地名
  'touch', // 与 pointer 相反(AgentRowMenu / message-menu-model 的参数名)
  'desktop', // 桌面工作区布局(App.tsx 传进各屏)
  'pointerUi\\([^)]*\\)',
  "Platform\\.OS\\s*[!=]==\\s*'\\w+'",
  "voiceSurface\\(desktop\\)\\s*===\\s*'phoneOverlay'", // desktop-voice-bar-model.ts(#463):录音浮层只挂手机
  'holdOverlayOn', // voice-hold-overlay-model.ts holdOverlayApplies():微信式按住浮层只在安卓 / iOS(非 desktop)
] as const;
const PRED = `(?:${PREDICATE_IDS.join('|')})`;

/** `{pred ? <X` / `{!pred && <X` / `{pred ? null : <X`,或组件自己的 `visible={!pred && …}`。 */
export const renderGate = (component: string): RegExp =>
  new RegExp(`\\{\\s*!?\\s*${PRED}\\s*(?:\\?\\s*null\\s*:|\\?|&&)\\s*\\(?\\s*<${component}\\b|visible=\\{\\s*!?\\s*${PRED}\\s*&&`);

export interface PhoneOnlySite {
  /** 名单里的名字(报错时用)。 */
  name: string;
  /** 一行命中它 = 一个渲染 / 绑定处。 */
  site: RegExp;
  /** 判定要出现在哪:'tag' = 从这一行到这个 JSX 开标签结束;数字 = 这一行和它前面 N 行。 */
  window: 'tag' | number;
  /** 窗口里要命中的判定形状。 */
  gate: RegExp;
  /** 组件自己的定义文件(那里的命中不是渲染处)。 */
  definedIn?: string;
  /** 取集自检:全仓至少这么多处。改名 / 挪文件让它扫到 0 处时,门红,而不是「0 处 0 违规」的绿。 */
  minSites: number;
  why: string;
  /**
   * 已知欠账:这些文件里的命中暂不算违规,但每次都打印出来。条目过期(那里已经带了判定)打印 RESOLVED
   * 提醒删掉,不判红 —— 修欠账的 PR 和本门谁先合都不该互相卡住(#463 与 #465)。
   */
  debt?: { files: readonly string[]; owner: string; reason: string };
}

export const PHONE_ONLY_SITES: readonly PhoneOnlySite[] = [
  {
    name: 'VoiceRecordingOverlay(按住说话浮层 + 上滑取消区)',
    site: /<VoiceRecordingOverlay\b/,
    window: 'tag',
    gate: renderGate('VoiceRecordingOverlay'),
    definedIn: 'src/VoiceInputUI.tsx',
    minSites: 1,
    why: '手指按住、上滑取消是触摸手势;桌面点 🎤 应该是就地的录音条,不是屏幕中间一张卡 + 底部取消区。',
    debt: { files: ['src/ChatScreen.tsx'], owner: 'voice-shortcuts', reason: '桌面改为行内录音条的 PR 正在进行,那里会把这个浮层收回手机' },
  },
  {
    name: 'VoiceHoldOverlay(微信式按住说话浮层:✕ / 文 滑动手势)',
    site: /<VoiceHoldOverlay\b/,
    window: 'tag',
    gate: renderGate('VoiceHoldOverlay'),
    definedIn: 'src/VoiceInputUI.tsx',
    minSites: 1,
    why: '按住、滑到 ✕ / 文 是手指的手势;桌面是行内录音条(#463),窄桌面窗口也不画。',
  },
  {
    name: 'SelectTextSheet(全屏「选择文本」)',
    site: /<SelectTextSheet\b/,
    window: 'tag',
    gate: renderGate('SelectTextSheet'),
    definedIn: 'src/SelectTextSheet.tsx',
    minSites: 1,
    why: '触摸端的原生选区跨不过 Markdown 块;鼠标直接在气泡里拖选,不需要整屏选区页。',
  },
  {
    name: 'ComposerFullscreenEditor(⤢ 全屏编辑)',
    site: /<ComposerFullscreenEditor\b/,
    window: 'tag',
    gate: renderGate('ComposerFullscreenEditor'),
    definedIn: 'src/ComposerRowParts.tsx',
    minSites: 1,
    why: '手机输入框太矮才需要整屏编辑;桌面输入框可以拖高。',
  },
  {
    name: 'onLongPress(长按作为入口)',
    site: /\bonLongPress=\{/,
    window: 0,
    gate: new RegExp(`onLongPress=\\{\\s*!?\\s*${PRED}\\s*\\?`),
    minSites: 5,
    why: '鼠标按住是在拖选文字;桌面的同一入口是右键 / 悬停「⋯」(同一份菜单)。',
  },
  {
    name: 'styles.actionSheet(底部 action sheet)',
    site: /\bstyles\.actionSheet\b/,
    window: 3,
    gate: new RegExp(`\\b${PRED}\\b[^\\n]*(?:\\?|&&)`),
    minSites: 1,
    why: '桌面菜单落在光标 / 按钮处(锚定),不从窗口底部升起。',
  },
  {
    name: 'expo-haptics(震动)',
    site: /\bHaptics\.(?:impact|notification|selection)Async\b/,
    window: 2,
    gate: new RegExp(`${PRED}|\\btouch\\b`),
    minSites: 2,
    why: '桌面没有震动马达;调用必须在触摸端判定之后。',
  },
];

/**
 * 只有手指能做的「刷新」:RN-web 的 RefreshControl 什么都不画。用到它的屏必须还有一条不靠手势的刷新
 * (定时轮询,或一个刷新按钮)。值 = 那条路在同一文件里的样子。
 */
export const REFRESH_ALTERNATIVE = /\busePoll\(|setInterval\(|testID="[\w-]*refresh"/;

/**
 * 滑动手势(PanResponder)的文件,各自说明鼠标 / 键盘怎么做同一件事。`alternative` = 那条路在同一文件里的样子;
 * null = 这个拖动本身就是桌面手势(拖分隔条 / 拖高输入框)或只在手机布局出现,`why` 写明。
 * 新文件里出现 PanResponder.create 而不在这里 → 门红。
 */
export const SWIPE_FILES: Readonly<Record<string, { alternative: RegExp | null; why: string }>> = {
  'src/ImageViewer.tsx': { alternative: /accessibilityLabel="上一张"[\s\S]*accessibilityLabel="下一张"|viewerKeyAction/, why: '左右滑切图:桌面有 ‹ › 按钮和方向键;下滑关闭:Esc / 点空白' },
  'src/NodePicker.tsx': { alternative: /testID="node-picker-backdrop"[^>]*onPress=\{onClose\}/, why: '拖把手关闭只在手机 sheet;点遮罩 / Esc 关闭,宽窗口是居中对话框' },
  'src/TwoPaneDivider.tsx': { alternative: null, why: '只在安卓双栏渲染;拖分隔条在鼠标上也是拖' },
  'src/ChatScreen.tsx': { alternative: null, why: '桌面输入框上沿的拖高把手 —— 鼠标拖动本来就是桌面手势' },
  'src/SplitEditorParts.tsx': { alternative: /accessibilityRole="adjustable"[\s\S]*onAccessibilityAction=/, why: '规则文件 / 任务描述全屏的左右分栏分隔条:鼠标拖动本来就是桌面手势;读屏 / 键盘按步调比例,双击回 50/50' },
};

/** 手势词:出现在界面文案里就是在叫用户用手指。「点按钮」「节点按…」不是手势词,其余照字面。 */
export const GESTURE_WORDS = /上滑|下滑|左滑|右滑|滑动|下拉刷新|长按|按住|(?<!节)点按(?!钮)/;

export interface CopyException {
  file: string;
  /** 那一行里的一段原文(子串)。原文改了、这条就过期 —— 门红,提醒同步删掉或改这条。 */
  text: string;
  why: string;
  debt?: { owner: string; reason: string };
}

/**
 * 含手势词、但同一行没有判定的文案。每条要么说明为什么只会在手机上出现,要么是记名的欠账。
 * 默认做法是让文案本身带判定(`${pointer ? '向上滚动' : '上滑'}`),而不是往这里加一行。
 */
export const COPY_EXCEPTIONS: readonly CopyException[] = [
  { file: 'src/agent-row-menu.ts', text: "ROW_MENU_EMPTY_HINT = '长按列表里的 agent", why: '只在安卓双栏的空白右栏显示(App.tsx twoPaneSelection 分支);桌面空白页有自己的文案' },
  { file: 'src/xiaomi-guide.ts', text: '长按 Agent Network 的卡片', why: '小米 / HyperOS 后台指引:设置里只在 android 平台出现(settings-model platforms)' },
  { file: 'src/voice-input-model.ts', text: "default: return '按住 说话';", why: '「按住 说话」大条只在手机 / 双栏的语音模式输入行(VoiceHoldBar)' },
  { file: 'src/i18n-chat.ts', text: "'voice.switchVoice':", why: 'Translated ComposerModeToggle, only in phone/two-pane composer' },
  { file: 'src/i18n-chat.ts', text: "'voice.holdInsertHint':", why: 'Translated VoiceHoldBar accessibility hint, only in phone/two-pane composer' },
  { file: 'src/i18n-chat.ts', text: "'voice.draftHint':", why: 'Translated VoiceDraftCard, only in phone/two-pane voice mode' },
  { file: 'src/i18n-chat.ts', text: "'voice.holdSpaced':", why: 'Translated VoiceHoldBar label, same phone-only surface' },
  { file: 'src/i18n-chat.ts', text: "'voice.slideCancel':", why: 'Translated cancellation zone in gated VoiceRecordingOverlay' },
  { file: 'src/i18n-chat.ts', text: "'voice.releaseHint':", why: 'Translated hint in gated VoiceRecordingOverlay' },
  { file: 'src/i18n-chat.ts', text: "'chat.swipeUp':", why: 'Chat search history gesture chosen only for touch; pointer selects scrollUp' },
  { file: 'src/voice-input-model.ts', text: "'松开 转文字 · 上滑 取消'", why: '录音浮层提示', debt: { owner: 'voice-shortcuts', reason: '浮层在桌面也出现,桌面行内录音条的 PR 会收回' } },
  { file: 'src/voice-input-model.ts', text: "'上滑到这里取消'", why: '录音浮层取消区', debt: { owner: 'voice-shortcuts', reason: '同上' } },
  { file: 'src/i18n-chat.ts', text: "'voice.hold':", why: 'Translated legacy VoiceMicButton name', debt: { owner: 'voice-shortcuts', reason: 'Legacy hold-to-record fallback; desktop uses DesktopMicButton' } },
  { file: 'src/i18n-chat.ts', text: "'voice.holdHint':", why: 'Translated legacy VoiceMicButton hint', debt: { owner: 'voice-shortcuts', reason: 'Same legacy fallback' } },
  { file: 'src/useVoiceRecorder.ts', text: '请再次按住说话', why: '首次授权后的提示,桌面也会出现', debt: { owner: 'voice-shortcuts', reason: '桌面改为点击录音后改成「请再点一次」' } },
  { file: 'src/i18n-settings.ts', text: '按住说话时文字实时出现在录音浮层里', why: '设置 → 语音输入 的原说明迁入翻译表,平台行为未变', debt: { owner: 'voice-shortcuts', reason: '原设置说明的手机手势文案债务,不是新增录音行为' } },
];
