// ck-style (self-executing; run by scripts/run-tests.mjs). 按住说话松手之后(owner:「按住说话之后，
// 别直接把输入法弹出来」,微信同款):留在语音模式、不 focus → 识别文字进「按住 说话」上方的草稿卡片,
// 右格变「发送」直接发;点卡片才切键盘并聚焦;再按住接着往后拼;上滑取消不动草稿。
import { readFileSync } from 'node:fs';
import { posix, sep } from 'node:path';
import {
  afterRecognized, IDLE, insertRecognized, onVoiceDraftCardTap, parseComposerInputMode, showVoiceDraftCard,
  VOICE_DRAFT_CARD_MAX_LINES, voiceStep, type ComposerInputMode, type ComposerModeTransition, type VoiceEvent, type VoiceState,
} from './voice-input-model';
import { composerRightSlot } from './composer-row-layout';

let p = 0, t = 0;
const ck = (name: string, cond: boolean) => { t++; if (cond) { p++; console.log(`✅ ${name}`); } else console.log(`❌ ${name}`); };
// 路径一律 POSIX(Windows 上 path.join 会给反斜杠)。
const toPosix = (f: string) => f.split(sep).join(posix.sep);
const read = (f: string) => readFileSync(toPosix(f), 'utf8');

// ── 一个最小的输入区模型:把状态机效果 + 转移函数套在 (mode, draft, focus 次数) 上 ──
type Composer = { mode: ComposerInputMode; draft: string; focusCalls: number; saved: ComposerInputMode };
const apply = (c: Composer, tr: ComposerModeTransition): Composer => ({
  ...c,
  mode: tr.mode ?? c.mode,
  focusCalls: c.focusCalls + (tr.focusInput ? 1 : 0),
  saved: tr.mode && tr.persist ? tr.mode : c.saved,
});
const hold = (c: Composer, recognized: string, opts: { cancel?: boolean } = {}): Composer => {
  let s: VoiceState = IDLE;
  const evs: VoiceEvent[] = [
    { type: 'press', configured: true, now: 0 },
    { type: 'started', now: 50 },
    ...(opts.cancel ? [{ type: 'move', dy: -200 } as VoiceEvent] : []),
    { type: 'release', now: 2000 },
    { type: 'transcribed', text: recognized },
  ];
  for (const e of evs) {
    const r = voiceStep(s, e);
    s = r.state;
    if (r.effect.kind === 'insertText') {
      c = { ...c, draft: insertRecognized(c.draft, r.effect.text) };
      c = apply(c, afterRecognized());
    }
  }
  return c;
};
const start: Composer = { mode: parseComposerInputMode('voice'), draft: '', focusCalls: 0, saved: 'voice' };

// ── 松手 ──
{
  const c = hold(start, '今天下午三点开会');
  ck('松手 → 仍是语音模式', c.mode === 'voice');
  ck('松手 → 0 次 focus(软键盘不弹)', c.focusCalls === 0);
  ck('松手 → 文字进草稿', c.draft === '今天下午三点开会');
  ck('松手 → 草稿卡片出现', showVoiceDraftCard(c.mode === 'voice', c.draft));
  ck('松手 → 右格是「发送」(语音模式下直接发)', composerRightSlot({ draft: c.draft, attachmentCount: 0, voiceMode: c.mode === 'voice' }) === 'send');
  const tr = afterRecognized();
  ck('afterRecognized:不换模式、不 focus、不写偏好', tr.mode === null && tr.focusInput === false && tr.persist === false);
}
// ── 点卡片 ──
{
  const c = apply(hold(start, 'hello'), onVoiceDraftCardTap());
  ck('点卡片 → 键盘模式', c.mode === 'keyboard');
  ck('点卡片 → focus 一次(唯一会弹键盘的路)', c.focusCalls === 1);
  ck('点卡片 → 草稿原样带进输入框', c.draft === 'hello');
  ck('点卡片 → 不写回偏好(记住的仍是语音)', c.saved === 'voice' && onVoiceDraftCardTap().persist === false);
  ck('点卡片 → 光标放草稿末尾(cursorAtEnd)', onVoiceDraftCardTap().cursorAtEnd === true && afterRecognized().cursorAtEnd === false);
  ck('键盘模式下不画卡片(文字在输入框里)', !showVoiceDraftCard(c.mode === 'voice', c.draft));
}
// ── 卡片可见性 ──
ck('空 / 全空白草稿不画卡片', !showVoiceDraftCard(true, '') && !showVoiceDraftCard(true, '  \n '));
ck('卡片最多直接显示 4 行', VOICE_DRAFT_CARD_MAX_LINES === 4);
// ── 语音模式直接发 ──
ck('语音模式 + 空草稿 → ＋', composerRightSlot({ draft: '', attachmentCount: 0, voiceMode: true }) === 'plus');
ck('语音模式 + 图片 → 发送(同 #419 规则)', composerRightSlot({ draft: '', attachmentCount: 1, voiceMode: true }) === 'send');
// ── 接着说 ──
{
  const zh = hold(hold(start, '你好'), '在吗');
  ck('再按住:中文直接相接(不插空格)', zh.draft === '你好在吗' && zh.mode === 'voice' && zh.focusCalls === 0);
  const zhPunct = hold(hold(start, '你好。'), '在吗？');
  ck('再按住:中文标点后直接相接', zhPunct.draft === '你好。在吗？');
  const en = hold(hold(start, 'hello'), 'world');
  ck('再按住:拉丁字母之间补一个空格', en.draft === 'hello world');
  const mixed = hold(hold(start, '会议在'), '3pm');
  ck('再按住:中文接拉丁不补空格', mixed.draft === '会议在3pm');
}
// ── 上滑取消 ──
{
  const before = hold(start, '第一句');
  const after = hold(before, '不要这句', { cancel: true });
  ck('上滑取消 → 草稿不动', after.draft === '第一句');
  ck('上滑取消 → 仍是语音模式、不 focus', after.mode === 'voice' && after.focusCalls === 0);
}

// ── 接线(源码层) ──
const chat = read('src/ChatScreen.tsx');
const ui = read('src/VoiceInputUI.tsx');
const onInsertAt = chat.indexOf('onInsert: text => {');
const onInsertCb = chat.slice(onInsertAt, chat.indexOf('onNotice: setComposerNotice', onInsertAt));
ck('找到 onInsert(松手路径),它只转给 insertVoiceText', onInsertAt > 0 && /onInsert: text => \{\s*insertVoiceText\(text\);\s*\}/.test(onInsertCb));
// 大条(#422)那一支 = insertVoiceText 里 refocusAfterInsert(source) 为 false 的分支(到第一个 return;)。
const ivtAt = chat.indexOf('const insertVoiceText = (text: string) => {');
const ivt = chat.slice(ivtAt, chat.indexOf('\n  };', ivtAt));
const holdBarBranch = ivt.slice(ivt.indexOf('if (!refocusAfterInsert(source)) {'), ivt.indexOf('return;'));
ck('找到大条分支', ivtAt > 0 && holdBarBranch.length > 0);
const onInsert = holdBarBranch;
ck('大条分支接末尾(insertRecognized)', onInsert.includes('setDraft(d => insertRecognized(d, text));'));
ck('松手路径里没有 focus()', !/\.focus\(\)/.test(onInsert) && !onInsert.includes('focusAfterInsertRef'));
ck("松手路径里不切 setInputMode('keyboard')", !onInsert.includes("setInputMode('keyboard')") && !ivt.includes("setInputMode('keyboard')"));
ck('松手路径走 afterRecognized()', onInsert.includes('applyComposerTransition(afterRecognized());'));
const applyAt = chat.indexOf('const applyComposerTransition = ');
const applyFn = chat.slice(applyAt, chat.indexOf('};', applyAt));
ck('applyComposerTransition 只在 focusInput 时置 focus 标记', applyFn.includes('if (tr.focusInput) focusAfterInsertRef.current = true;'));
ck('applyComposerTransition 只在 persist 时写偏好', applyFn.includes('if (tr.mode && tr.persist) void saveComposerInputMode(tr.mode);'));
const cardAt = chat.indexOf('<VoiceDraftCard');
const rowAt = chat.indexOf('<View style={[styles.inputRow,');
const stripAt = chat.indexOf('testID="composer-draft-strip"');
const quoteAt = chat.indexOf('<View style={styles.quoteStrip}');
ck('卡片只在 showVoiceDraftCard(voiceMode, draft) 时画', /\{showVoiceDraftCard\(voiceMode, draft\) \? \(\s*<VoiceDraftCard/.test(chat));
ck('叠放:图片草稿条 → 引用条 → 卡片 → 按住说话行', stripAt > 0 && quoteAt > stripAt && cardAt > quoteAt && rowAt > cardAt);
const card = chat.slice(cardAt, chat.indexOf('/>', cardAt));
ck('点卡片走 onVoiceDraftCardTap', card.includes('onPress={() => applyComposerTransition(onVoiceDraftCardTap())}'));
ck('✕ 清空草稿', card.includes("onClear={() => setDraft('')}"));
ck('识别/录音中卡片不可点', card.includes('disabled={voiceBusy}'));
ck('卡片在 ScrollView 里、最多 4 行高', /<ScrollView style=\{\{ flex: 1, maxHeight: DRAFT_CARD_LINE_HEIGHT \* VOICE_DRAFT_CARD_MAX_LINES \}\}/.test(ui));
const submitAt = chat.indexOf('const submit = async () => {');
const submitFn = chat.slice(submitAt, chat.indexOf('\n  };', submitAt));
ck('submit 不 focus、不切模式(语音模式发送不弹键盘)', submitAt > 0 && !/\.focus\(\)/.test(submitFn) && !submitFn.includes('setInputMode'));
ck('桌面分支不画卡片(桌面不变):只一处,且在桌面 composer 之后的手机分支里', (chat.match(/<VoiceDraftCard/g) ?? []).length === 1 && cardAt > chat.indexOf('styles.desktopSendText'));

console.log(`voice draft card: ${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);
