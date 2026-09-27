// ck-style (self-executing; run by scripts/run-tests.mjs). 语音模式草稿卡片里选插入位置(owner:草稿卡片上有
// 「什么情况?」,想在中间再插一段语音,现在只能切到键盘去放光标;键盘模式里的麦克风太小不好按 —— 要保留大的
// 「按住 说话」,同时能选插入位置):
//   · 卡片可以点着放光标、长按 / 拖动选中,不弹软键盘(showSoftInputOnFocus={false});
//   · 按住大条 → 插到卡片的选区(选中就替换),光标落在插入文字之后 → 连着按依次往后接;
//   · 流式中间结果在光标处预览,终稿替换预览;
//   · 点 ⌨ 切键盘、再切回语音,选区都带过去;✕ 清空;发送照旧。
import { readFileSync } from 'node:fs';
import { posix, sep } from 'node:path';
import {
  beginVoicePress, createSelectionCapture, insertAtSelection, previewAtSelection, refocusAfterInsert,
  selectionAcrossModeSwitch, voiceInsertTarget, type TextSelection,
} from './voice-insert-model';
import { afterRecognized, showVoiceDraftCard, toggleComposerInputMode, type ComposerInputMode } from './voice-input-model';

let p = 0, t = 0;
const ck = (name: string, cond: boolean) => { t++; if (cond) { p++; console.log(`✅ ${name}`); } else console.log(`❌ ${name}`); };
// 路径一律 POSIX、换行一律 LF(Windows 检出是 CRLF,正则里的 \s* 锚点会失配)。
const toPosix = (f: string) => f.split(sep).join(posix.sep);
const read = (f: string) => readFileSync(toPosix(f), 'utf8').replace(/\r\n/g, '\n');
const at = (i: number): TextSelection => ({ start: i, end: i });
const sel = (s: TextSelection | undefined) => (s ? `${s.start},${s.end}` : '-');

// ── 输入区模型:照 ChatScreen 的接线把纯函数串起来(草稿、选区跟踪器、模式、focus 次数、显示的选区) ──
type Insert = typeof insertAtSelection;
function composer(mode: ComposerInputMode, draft = '', insert: Insert = insertAtSelection) {
  const cap = createSelectionCapture();
  const c = { mode, draft, focusCalls: 0, modeSwitches: 0, shown: undefined as TextSelection | undefined, preview: null as null | { value: string; selection: TextSelection } };
  const place = (s: TextSelection) => { cap.track(s); c.shown = s; };           // placeSelection → effect
  return {
    c,
    cap,
    /** 用户在卡片(语音模式)或输入框(键盘模式)里点 / 选。 */
    select(s: TextSelection) { cap.track(s); c.shown = s; },
    /** 按住大条说一句:按下冻结 → 中间结果预览 → 终稿插入(或上滑取消)。 */
    hold(text: string, opts: { interims?: string[]; cancel?: boolean } = {}) {
      const source = beginVoicePress('holdBar', cap);
      for (const i of opts.interims ?? []) c.preview = previewAtSelection(c.draft, i, cap.peek().frozen);
      if (!opts.cancel) {
        const frozen = cap.take();
        const r = insert(c.draft, text, voiceInsertTarget(source, frozen));
        c.draft = r.value;
        place(at(r.cursor));
        const tr = afterRecognized();
        if (tr.focusInput) c.focusCalls++;
        if (tr.mode) { c.mode = tr.mode; c.modeSwitches++; }
        if (refocusAfterInsert(source)) c.focusCalls++;
      }
      c.preview = null;
      place(selectionAcrossModeSwitch(cap.peek().live, c.draft));             // 一句结束:选区放回跟踪到的那个
    },
    toggle() {
      const keep = selectionAcrossModeSwitch(cap.peek().live, c.draft);
      c.mode = toggleComposerInputMode(c.mode);
      c.modeSwitches++;
      // 新挂上的输入框 / 卡片先报一次自己的默认选区(安卓常见:0),切换时拍下的 keep 随后放回去。
      cap.track(at(0));
      place(keep);
      if (c.mode === 'keyboard') { c.focusCalls++; place(keep); }
    },
    clear() { c.draft = ''; cap.reset(); },
  };
}

// ── 1 光标在中间插入 ──
{
  const k = composer('voice', '什么情况?');
  k.select(at(2));                                               // 点在「什么|情况?」
  k.hold('具体');
  ck('中间插入:「什么|情况?」+「具体」→「什么具体情况?」', k.c.draft === '什么具体情况?');
  ck('插完光标紧跟插入文字(4)', sel(k.c.shown) === '4,4');
  ck('全程留在语音模式、0 次 focus(软键盘不弹)、没切过键盘', k.c.mode === 'voice' && k.c.focusCalls === 0 && k.c.modeSwitches === 0);
  ck('卡片仍在(有草稿)', showVoiceDraftCard(k.c.mode === 'voice', k.c.draft));
}
// ── 2 选中一段 → 替换 ──
{
  const k = composer('voice', '明天上午去公司');
  k.select({ start: 2, end: 4 });                                 // 长按 / 拖选「上午」
  k.hold('下午');
  ck('选中「上午」→ 替换成「下午」', k.c.draft === '明天下午去公司');
  ck('替换后光标在「下午」之后(4),选区收成光标', sel(k.c.shown) === '4,4');
  const rev = composer('voice', '明天上午去公司');
  rev.select({ start: 4, end: 2 });
  rev.hold('下午');
  ck('反向拖选同样替换', rev.c.draft === '明天下午去公司');
}
// ── 3 连着按:依次往后接(在新光标处) ──
{
  const k = composer('voice', '什么情况?');
  k.select(at(2));
  k.hold('具体');
  k.hold('是');
  k.hold('哪里的');
  ck('三次按住在中间依次接:「什么具体是哪里的情况?」', k.c.draft === '什么具体是哪里的情况?');
  ck('光标一直跟在最后一次插入之后(8)', sel(k.c.shown) === '8,8');
  const e = composer('voice');
  e.hold('你好'); e.hold('在吗'); e.hold('hello'); e.hold('world');
  ck('没点过卡片 = 末尾,连着按依次追加(#422 不变,拉丁补空格)', e.c.draft === '你好在吗hello world');
  const en = composer('voice', 'hello world');
  en.select(at(5));
  en.hold('big'); en.hold('bad');
  ck('拉丁中间连着插:空格规则每次都对', en.c.draft === 'hello big bad world');
}
// ── 4 模式切换保留选区 ──
{
  const k = composer('voice', '什么情况?');
  k.select({ start: 2, end: 4 });
  k.toggle();
  ck('语音 → 键盘:选区带到输入框(2,4),挂上后默认报的 0 不算', k.c.mode === 'keyboard' && sel(k.c.shown) === '2,4' && sel(k.cap.peek().live ?? undefined) === '2,4');
  ck('切到键盘:focus 一次(这是唯一弹键盘的路)', k.c.focusCalls === 1);
  k.toggle();
  ck('键盘 → 语音:选区带回卡片(2,4)', k.c.mode === 'voice' && sel(k.c.shown) === '2,4');
  k.hold('情');
  ck('来回切过之后按住,仍替换那段', k.c.draft === '什么情?');
  const kb = composer('keyboard', '明天去公司开会');
  kb.select(at(3));                                              // 键盘模式里放的光标
  kb.toggle();
  kb.hold('我们');
  ck('键盘里放好光标再切语音按住:插在那里', kb.c.draft === '明天去我们公司开会' && sel(kb.c.shown) === '5,5');
  const stale = composer('voice', 'abc');
  stale.select(at(3));
  stale.c.draft = 'a';                                           // 草稿被别处改短(发送 / 全屏编辑器)
  stale.toggle();
  ck('选区过期(超出草稿)→ 夹到草稿末尾', sel(stale.c.shown) === '1,1');
}
// ── 5 流式中间结果在光标处预览,终稿替换 ──
{
  const pv = previewAtSelection('什么情况?', '具', at(2));
  ck('中间结果插在光标处预览,光标跟在预览之后', pv.value === '什么具情况?' && sel(pv.selection) === '3,3');
  const pv2 = previewAtSelection('明天上午去公司', '下', { start: 2, end: 4 });
  ck('选中了一段:预览顶掉那段', pv2.value === '明天下去公司' && sel(pv2.selection) === '3,3');
  const none = previewAtSelection('明天上午', '', { start: 2, end: 4 });
  ck('还没出字:草稿原样、选区原样(选中那段还亮着)', none.value === '明天上午' && sel(none.selection) === '2,4');
  ck('没点过卡片:预览在末尾', previewAtSelection('你好', '在', null).value === '你好在');
  const k = composer('voice', '什么情况?');
  k.select(at(2));
  k.hold('具体地说', { interims: ['具', '具体', '具体的说'] });
  ck('终稿替换预览(不是叠在预览后面)', k.c.draft === '什么具体地说情况?' && k.c.preview === null);
  const c = composer('voice', '什么情况?');
  c.select(at(2));
  c.hold('不要这句', { interims: ['不要'], cancel: true });
  ck('上滑取消:草稿不动,选区回到按下前(2)', c.c.draft === '什么情况?' && sel(c.c.shown) === '2,2');
}
// ── 6 ✕ / 发送 ──
{
  const k = composer('voice', '什么情况?');
  k.select(at(2));
  k.clear();
  ck('✕ 清空:草稿空、卡片消失', k.c.draft === '' && !showVoiceDraftCard(true, k.c.draft));
  k.hold('重新说');
  ck('✕ 之后再按住:从头开始(旧选区作废)', k.c.draft === '重新说' && sel(k.c.shown) === '3,3');
}
// ── 正控:判据真的能看见「插到末尾」这种缺陷(把大条换回 #422 的末尾追加,上面的断言必须红) ──
{
  const appendOnly: Insert = (d, x) => insertAtSelection(d, x, null);
  const k = composer('voice', '什么情况?', appendOnly);
  k.select(at(2));
  k.hold('具体');
  ck('正控:末尾追加的实现会被「中间插入」判据判红', k.c.draft !== '什么具体情况?');
}

// ── 接线(源码层) ──
const chat = read('src/ChatScreen.tsx');
const ui = read('src/VoiceInputUI.tsx');
const cardFnAt = ui.indexOf('export function VoiceDraftCard(');
const cardFn = ui.slice(cardFnAt, ui.indexOf('\nconst makeStyles', cardFnAt));
ck('卡片是输入框,不弹软键盘(showSoftInputOnFocus={false};网页 inputmode=none)', /<TextInput\n(\s+[^\n]*\n)*?\s+showSoftInputOnFocus=\{false\}\n/.test(cardFn) && /\{\.\.\.\(Platform\.OS === 'web' \? \{ inputMode: 'none' as const/.test(cardFn));
ck('卡片没有 editable={false}(否则放不了光标)、也没有整块 Pressable 抢点击', !/editable=\{false\}/.test(cardFn) && !cardFn.includes('onPress={onPress}'));
ck('卡片用 ui-text 的 TextInput(字号设置生效)', /import \{ Text, TextInput \} from '\.\/ui-text';/.test(ui));
const cardAt = chat.indexOf('<VoiceDraftCard');
const card = chat.slice(cardAt, chat.indexOf('/>', cardAt));
ck('卡片接 ref(按下时网页读宿主选区)', card.includes('inputRef={draftCardRef}'));
ck('卡片显示:按住期间 = 光标处预览,否则 = 草稿', card.includes('value={draftCardPreview ? draftCardPreview.value : draft}'));
ck('卡片选区:按住期间跟着预览,否则 = 受控放光标(插完 / 切换)', card.includes('selection={draftCardPreview ? draftCardPreview.selection : forcedSelection}'));
ck('按住期间卡片报的选区不记(那是预览里的位置)', card.includes('onSelectionChange={voiceBusy ? undefined : onComposerSelectionChange}'));
ck('按住期间卡片的文字改动不进草稿', card.includes('onChangeText={text => { if (!voiceBusy) setDraft(text); }}'));
ck('预览只在语音模式 + 按住大条时算,用按下时冻结的选区', /const draftCardPreview = voiceMode && voiceBusy && voiceSourceRef\.current === 'holdBar'\s*\? previewAtSelection\(draft, voice\.interim, selectionCaptureRef\.current\.peek\(\)\.frozen\)/.test(chat));
ck('一句结束:选区放回跟踪到的那个(取消时卡片光标不留在预览里)', /if \(!was \|\| voiceBusy \|\| !voiceMode\) return;\s*placeSelection\(selectionAcrossModeSwitch\(selectionCaptureRef\.current\.peek\(\)\.live, draftRef\.current\)\);/.test(chat));
const toggleAt = chat.indexOf('const toggleInputMode = () => {');
const toggle = chat.slice(toggleAt, chat.indexOf('\n  };', toggleAt));
ck('切换:先拍下选区,再切模式', toggleAt > 0 && toggle.indexOf('const keep = selectionAcrossModeSwitch(') < toggle.indexOf('setInputMode(next);'));
ck('切换:新挂上的那一个立刻拿到选区(placeSelection(keep))', /setInputMode\(next\);[\s\S]*placeSelection\(keep\);/.test(toggle));
ck('切到键盘:focus 之后再放回选区', toggle.includes('selectionAfterFocusRef.current = keep;') && /mainComposerRef\.current\?\.focus\(\);\s*if \(keep\) placeSelection\(keep\);/.test(chat));
const vhAt = chat.indexOf('const voiceHandlersFor = (source: VoiceSource) => withPressStart(');
const vh = chat.slice(vhAt, chat.indexOf('\n  );', vhAt));
ck('大条按下读的是卡片的宿主选区(网页),输入框麦克风读输入框', vh.includes("hostSelection(source === 'holdBar' ? draftCardRef.current : mainComposerRef.current)"));
const holdBarFn = ui.slice(ui.indexOf('export function VoiceHoldBar('), ui.indexOf('const BARS'));
ck('网页:大条 mousedown 不抢卡片焦点(按住期间光标还在卡片里)', holdBarFn.includes('{...keepInputFocus}'));
const ivtAt = chat.indexOf('const insertVoiceText = (text: string) => {');
const ivt = chat.slice(ivtAt, chat.indexOf('\n  };', ivtAt));
const holdBranch = ivt.slice(ivt.indexOf('if (!refocusAfterInsert(source)) {'), ivt.indexOf('return;'));
ck('大条分支:不 focus、不切键盘', holdBranch.length > 0 && !/\.focus\(\)/.test(holdBranch) && !holdBranch.includes("setInputMode('keyboard')"));
ck('大条分支:插完 placeCursor(r.cursor)', holdBranch.includes('placeCursor(r.cursor);'));
ck('桌面分支不变:卡片只在手机分支里画一处', (chat.match(/<VoiceDraftCard/g) ?? []).length === 1 && cardAt > chat.indexOf('styles.desktopSendText'));

console.log(`voice draft cursor: ${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);
