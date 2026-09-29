// 任务描述:⤢ 全屏 + 语音输入(task-description-fullscreen-model.ts)。纯逻辑 + 接线(源码)。
import { readFileSync } from 'node:fs';
import { descriptionEditable, desktopFullscreenMode, effectiveDesktopMode, fullscreenKind, initialInlineMode, inlineModeAfterFullscreen, inlineModeFor, richEditorActive, settingsPromptKind, voiceEntry } from './task-description-fullscreen-model';
import { t as translate } from './i18n';
import { taskDescriptionTranslations } from './i18n-tasks';
import { GESTURE_WORDS } from './phone-only-registry';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

console.log('# 模型');
ck('鼠标 = 桌面全屏编辑器;手指 = 推入的一整页', fullscreenKind(true) === 'desktopEditor' && fullscreenKind(false) === 'phonePage');
ck('从预览进全屏 = 阅读', desktopFullscreenMode('preview', true) === 'read' && desktopFullscreenMode('preview', false) === 'read');
ck('从编辑进全屏 = 左右(放得下)/ 编辑(放不下)', desktopFullscreenMode('edit', true) === 'split' && desktopFullscreenMode('edit', false) === 'edit');
ck('放不下左右时「左右」退回编辑,其余不变', effectiveDesktopMode('split', false) === 'edit' && effectiveDesktopMode('split', true) === 'split' && effectiveDesktopMode('read', false) === 'read');
ck('退出全屏:阅读 → 预览,编辑 / 左右 → 编辑', inlineModeAfterFullscreen('read') === 'preview' && inlineModeAfterFullscreen('edit') === 'edit' && inlineModeAfterFullscreen('split') === 'edit');
ck('可编辑:全屏开着看全屏模式,否则看小编辑框', descriptionEditable('preview', 'split') && descriptionEditable('preview', 'edit') && !descriptionEditable('edit', 'read') && descriptionEditable('edit', null) && !descriptionEditable('preview', null));
console.log('# 所见即所得');
ck('打开:能用富文本就直接富文本;否则有内容预览、空的编辑', initialInlineMode('## x', true) === 'rich' && initialInlineMode('', true) === 'rich' && initialInlineMode('## x', false) === 'preview' && initialInlineMode(' ', false) === 'edit' && initialInlineMode('', null) === 'preview' && initialInlineMode('## x', null) === 'preview');
ck('富文本不可用了:富文本 → 预览;可用时预览 → 富文本;源码不动', inlineModeFor('rich', false) === 'preview' && inlineModeFor('preview', true) === 'rich' && inlineModeFor('edit', true) === 'edit' && inlineModeFor('edit', false) === 'edit');
ck('从富文本进全屏 = 「阅读」位(富文本编辑器)', desktopFullscreenMode('rich', true) === 'read');
ck('退出全屏:阅读位 → 富文本(可用时)/ 预览', inlineModeAfterFullscreen('read', true) === 'rich' && inlineModeAfterFullscreen('read', false) === 'preview' && inlineModeAfterFullscreen('split', true) === 'edit');
ck('富文本时全屏的阅读位也能打字(🖼 / 🎤 出现),小编辑框的富文本也能', descriptionEditable('rich', 'read', true) && !descriptionEditable('rich', 'read', false) && descriptionEditable('rich', null, true));
ck('插入目标:富文本编辑器只在它真开着时', richEditorActive('rich', null, true) && richEditorActive('edit', 'read', true) && !richEditorActive('rich', 'split', true) && !richEditorActive('edit', null, true) && !richEditorActive('rich', null, false));
ck('语音入口:桌面 = 🎤(小编辑框和全屏都有)', voiceEntry({ pointer: true, available: true, editable: true, phonePage: false }) === 'desktopMic' && voiceEntry({ pointer: true, available: true, editable: true, phonePage: true }) === 'desktopMic');
ck('语音入口:手机只在全屏页的编辑模式 = 按住说话大条', voiceEntry({ pointer: false, available: true, editable: true, phonePage: true }) === 'holdBar' && voiceEntry({ pointer: false, available: true, editable: true, phonePage: false }) === null);
ck('语音入口:不能打字 / 平台不支持 = 不放', voiceEntry({ pointer: true, available: true, editable: false, phonePage: false }) === null && voiceEntry({ pointer: false, available: false, editable: true, phonePage: true }) === null);
ck('未配置语音:有没保存的修改时不给「去设置」跳转(会丢草稿)', settingsPromptKind(true, true) === 'saveFirst' && settingsPromptKind(false, true) === 'link' && settingsPromptKind(false, false) === 'text');

console.log('# 文案');
{
  const entries = Object.entries(taskDescriptionTranslations);
  ck('每条都有中英两份', entries.every(([, v]) => v.length === 2 && !!v[0] && !!v[1]));
  ck('键都注册上了(t 返回的不是键本身)', entries.every(([k]) => translate(k) !== k));
  ck('没有手势词(桌面也会显示这些文案)', entries.every(([, v]) => !GESTURE_WORDS.test(v[0])));
}

console.log('# 接线(源码)');
{
  const editor = src('./TaskDescriptionEditor.tsx');
  const full = src('./TaskDescriptionFullscreen.tsx');
  const rules = src('./NodeRulesSection.tsx');
  const parts = src('./SplitEditorParts.tsx');
  const panel = src('./TaskDetailPanel.tsx');
  ck('左右编辑器是规则文件同一套零件(不是复制一份)', /import \{[^}]*\bModeToggle\b[^}]*\bSplitDivider\b[^}]*\buseDebounced\b[^}]*\} from '\.\/SplitEditorParts'/.test(rules) && /import \{[^}]*\bModeToggle\b[^}]*\bSplitDivider\b[^}]*\buseDebounced\b[^}]*\} from '\.\/SplitEditorParts'/.test(full) && !/function (ModeToggle|RulesSplitDivider|useDebounced)\b/.test(rules));
  ck('分隔条只在 SplitEditorParts 里建 PanResponder', /PanResponder\.create\(/.test(parts) && !/PanResponder\.create\(/.test(rules) && !/PanResponder\.create\(/.test(full));
  ck('全屏的模式 tab 按 rulesModeTabs(splitOk) 给,预览节流同规则文件', full.includes('tabs={rulesModeTabs(splitOk)}') && full.includes('useDebounced(editor.value, split ? SPLIT_PREVIEW_DEBOUNCE_MS : 0)'));
  ck('全屏里 🖼 / 粘贴 / 拖放都还在', full.includes('testID="req-description-full-image"') && full.includes('ref={setDropBox}') && editor.includes("useImageIntake(pointer && !!full && full !== 'read', fullInput, fullBox"));
  ck('手机页:‹ 返回、编辑/预览、🖼', full.includes('testID="req-description-page-back"') && full.includes('testID="req-description-page-mode"') && full.includes('testID="req-description-page-image"'));
  ck('桌面全屏挂 MacTitleStrip / WinTitleBar(Modal 盖住了主窗口那两条)', full.includes('<MacTitleStrip />') && full.includes('<WinTitleBar />'));
  ck('识别结果插到按下那一刻冻结的选区(聊天同一套)', editor.includes('insertAtSelection(latest.current, text, voiceInsertTarget(source, capture.take()))') && editor.includes('sourceRef.current = beginVoicePress(source, capture)') && editor.includes('hostSelection(activeInput())'));
  ck('手机大条插完不聚焦(不弹键盘),桌面还给编辑框', editor.includes('refocusAfterInsert(source)'));
  ck('桌面录音条 / 🎤 只在 desktopMic 入口', editor.includes("entry === 'desktopMic' ? <DesktopMicButton") && editor.includes("entry === 'desktopMic' && showVoiceBar(voice.state.phase) ? <DesktopVoiceBar"));
  ck('手机大条只在 holdBar 入口,浮层带 holdOverlayOn 判定', editor.includes("entry === 'holdBar' ? <VoiceHoldBar") && full.includes('{holdOverlayOn ? <VoiceHoldOverlay voice={voice} layout={layout} /> : null}'));
  ck('快捷键:聊天同一个状态机,window 捕获阶段,只在桌面可编辑时挂', editor.includes("useVoiceShortcuts(entry === 'desktopMic'") && editor.includes("win.addEventListener('keydown', onKeyDown, true)") && editor.includes('kbdVoiceKeyDown(stateRef.current'));
  ck('全屏的 Esc:keydown 到了 document 才算(录音中的 Esc 归录音条),keyup 才关(不连带关掉底下的详情页);web 不走 Modal 自己的 keyup Esc', full.includes("doc.addEventListener('keydown', onDown);") && full.includes("doc.addEventListener('keyup', onUp);") && /if \(event\.key !== 'Escape' \|\| !armed\) return;/.test(full) && full.includes('onRequestClose={WEB ? undefined : onClose}'));
  ck('退出全屏时正在录音就取消', /const closeFull = \(\) => \{\n\s*if \(voice\.state\.phase !== 'idle'\) voiceCancel\(\);/.test(editor));
  ck('未配置语音:「去设置」提示,有没保存的修改时换成先保存', editor.includes("onOpenSettings={promptKind === 'link' ? onOpenVoiceSettings : undefined}") && editor.includes("note={promptKind === 'saveFirst' ? t('taskDesc.voiceSaveFirst') : undefined}"));
  ck('详情把「有没保存的修改」和去设置传给描述', panel.includes('dirty={!!patch} onOpenVoiceSettings={onOpenVoiceSettings}'));
}

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
