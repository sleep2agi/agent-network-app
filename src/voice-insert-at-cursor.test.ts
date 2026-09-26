// ck-style (self-executing; run by scripts/run-tests.mjs). 语音插到光标处(owner:「语音输入只能从无到有…
// 我选择光标在哪个地方继续输入，这个功能有问题」):键盘模式输入框里的小麦克风 / 桌面工具栏麦克风,
// 松手把识别文字插到**按下那一刻**的光标处(选中就替换),光标落在插入文字之后,焦点留在输入框。
// 语音模式的大条仍接末尾(#422)。
import { readFileSync } from 'node:fs';
import { posix, sep } from 'node:path';
import {
  beginVoicePress, clampSelection, createSelectionCapture, hostSelection, insertAtSelection, refocusAfterInsert,
  voiceInsertTarget, withPressStart, type TextSelection,
} from './voice-insert-model';
import { insertRecognized, onVoiceDraftCardTap } from './voice-input-model';
import { COMPOSER_CONTROL_BASE, COMPOSER_CONTROL_MIN, composerControlSize, composerFieldMicSize, composerInputPadRightWithMic, FIELD_MIC_INSET } from './composer-row-layout';

let p = 0, t = 0;
const ck = (name: string, cond: boolean) => { t++; if (cond) { p++; console.log(`✅ ${name}`); } else console.log(`❌ ${name}`); };
// 路径一律 POSIX、换行一律 LF(Windows 检出是 CRLF,正则里的 \s* 和 '\n  };' 锚点会失配)。
const toPosix = (f: string) => f.split(sep).join(posix.sep);
const read = (f: string) => readFileSync(toPosix(f), 'utf8').replace(/\r\n/g, '\n');
const at = (i: number): TextSelection => ({ start: i, end: i });
const ins = (d: string, x: string, s: TextSelection | null) => insertAtSelection(d, x, s);

// ── 插入位置 ──
{
  const r = ins('明天去公司', '上午', at(2));
  ck('中间:「明天|去公司」+「上午」→「明天上午去公司」,光标在「上午」之后', r.value === '明天上午去公司' && r.cursor === 4);
  const s = ins('去公司', '明天', at(0));
  ck('开头:插在最前,光标 = 插入长度', s.value === '明天去公司' && s.cursor === 2);
  const e = ins('明天', '去公司', at(2));
  ck('末尾:等同追加', e.value === '明天去公司' && e.cursor === 5);
  const n = ins('明天去公司', '下午', null);
  ck('没有选区(从没点过输入框)= 末尾', n.value === '明天去公司下午' && n.cursor === 7);
  const empty = ins('', '你好', at(0));
  ck('空草稿', empty.value === '你好' && empty.cursor === 2);
}
// ── 替换选中 ──
{
  const r = ins('明天上午去公司', '下午', { start: 2, end: 4 });
  ck('选中「上午」→ 替换成「下午」,光标在「下午」之后', r.value === '明天下午去公司' && r.cursor === 4);
  const rev = ins('明天上午去公司', '下午', { start: 4, end: 2 });
  ck('反向选区(end < start)按同一段处理', rev.value === '明天下午去公司' && rev.cursor === 4);
  const all = ins('全部删掉', '重来', { start: 0, end: 4 });
  ck('全选 → 整段替换', all.value === '重来' && all.cursor === 2);
}
// ── 空格规则(和 #418 的追加同一条) ──
{
  ck('拉丁 | 拉丁:左边补空格', ins('hello', 'world', at(5)).value === 'hello world');
  ck('拉丁 | 拉丁:右边补空格', ins('world', 'hello', at(0)).value === 'hello world');
  const both = ins('ab', 'X', at(1));
  ck('拉丁中间:两边都补,光标在插入词之后、右边空格之前', both.value === 'a X b' && both.cursor === 3);
  ck('已有空格处不再补', ins('hello world', 'big', at(6)).value === 'hello big world');
  ck('中文 | 中文:不补', ins('你好在吗', '呀', at(2)).value === '你好呀在吗');
  ck('中文 | 拉丁:不补', ins('会议在开', '3pm', at(3)).value === '会议在3pm开');
  ck('拉丁 | 中文识别结果:不补', ins('abc', '你好', at(3)).value === 'abc你好');
  ck('标点后不补', ins('ok.', 'go', at(3)).value === 'ok.go');
  ck('数字算拉丁词', ins('v2', '3', at(2)).value === 'v2 3');
  const cont = ins('hello world', 'big', at(6));
  const next = ins(cont.value, 'bad', at(cont.cursor));
  ck('连续口述:在上次光标处接着插,空格依旧正确', next.value === 'hello big bad world' && next.cursor === 13);
}
// ── 识别结果本身 ──
{
  ck('识别结果首尾空白去掉', ins('ab', '  X  ', at(1)).value === 'a X b');
  const r = ins('明天去公司', '   ', at(2));
  ck('空识别结果:草稿不变、光标不动', r.value === '明天去公司' && r.cursor === 2);
  const rr = ins('明天上午去公司', '', { start: 2, end: 4 });
  ck('空识别结果 + 选中:不删选中的字', rr.value === '明天上午去公司');
}
// ── emoji / 代理对(RN 的选区是 UTF-16 下标) ──
{
  const d = '好😀的'; // 好 = 0, 😀 = 1..2, 的 = 3
  const mid = ins(d, '呀', at(2));
  ck('光标劈开 emoji → 挪到 emoji 之后再插,不产生孤立代理项', mid.value === '好😀呀的' && mid.cursor === 4 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(mid.value));
  ck('emoji 前后插入正常', ins(d, '呀', at(1)).value === '好呀😀的' && ins(d, '呀', at(3)).value === '好😀呀的');
  const range = ins(d, '哈', { start: 2, end: 3 });
  ck('选区劈开 emoji → 向外扩到整个 emoji 再替换', range.value === '好哈的' && range.cursor === 2);
  ck('clampSelection:越界夹住、NaN = 末尾', JSON.stringify(clampSelection({ start: -3, end: 99 }, 'abc')) === '{"start":0,"end":3}' && JSON.stringify(clampSelection({ start: NaN, end: 1 }, 'abc')) === '{"start":3,"end":3}');
  ck('过期选区(草稿被清空后)夹到 0', ins('', '你好', at(8)).value === '你好');
}
// ── 末尾追加与 insertRecognized 完全一致(大条走它,规则只有一份) ──
{
  const cases: [string, string][] = [['', 'x'], ['hello', 'world'], ['你好。', '在吗'], ['会议在', '3pm'], ['abc ', 'd'], ['好😀', 'a'], ['x', '  ']];
  ck('insertRecognized(d, x) === insertAtSelection(d, x, 末尾).value', cases.every(([d, x]) => insertRecognized(d, x) === ins(d, x, at(d.length)).value));
}

// ── 选区跨录音保持(安卓按麦克风可能失焦并再报一次选区) ──
{
  const cap = createSelectionCapture();
  cap.track(at(2));
  cap.freeze();                 // 按下
  cap.track(at(0));             // 失焦 / 键盘收起时报的选区
  cap.track({ start: 5, end: 5 });
  const frozen = cap.take();
  ck('按下时冻结的选区不被录音期间的选区事件覆盖', frozen?.start === 2 && frozen?.end === 2);
  ck('快照只取一次', cap.take() === null);
  ck('live 仍然跟着最新事件走', cap.peek().live?.start === 5);
  const r = ins('明天去公司', '上午', voiceInsertTarget('fieldMic', frozen));
  ck('端到端:失焦报 0 之后,文字仍插在按下时的位置', r.value === '明天上午去公司');
  const c2 = createSelectionCapture();
  c2.freeze();
  ck('从没报过选区 → 快照为空 → 末尾', c2.take() === null && ins('ab', 'c', voiceInsertTarget('fieldMic', null)).value === 'ab c');
  const c3 = createSelectionCapture();
  c3.track(at(1)); c3.reset(); c3.freeze();
  ck('reset()(全屏编辑器改过草稿)→ 当作末尾', c3.take() === null);
  const c4 = createSelectionCapture();
  c4.track({ start: 1, end: 3 }); c4.freeze(); c4.track(at(3));
  ck('选中范围也被冻结(不是只记光标)', JSON.stringify(c4.take()) === '{"start":1,"end":3}');
}
// ── 按下的第一时间冻结:withPressStart / beginVoicePress ──
{
  const log: string[] = [];
  const base = { onResponderGrant: (_e: unknown) => { log.push('grant'); }, onResponderRelease: () => log.push('release') };
  let idle = true;
  const h = withPressStart(base, () => log.push('pressStart'), () => idle);
  h.onResponderGrant({});
  ck('先冻结再交给状态机(grant 之前)', log.join(',') === 'pressStart,grant');
  ck('其它手势处理原样保留', h.onResponderRelease === base.onResponderRelease);
  log.length = 0; idle = false;
  h.onResponderGrant({});
  ck('上一句还在识别(非 idle)→ 不覆盖快照,但按下仍交给状态机', log.join(',') === 'grant');
  const cap = createSelectionCapture();
  cap.track(at(4));
  ck('输入框麦克风:beginVoicePress 冻结选区', beginVoicePress('fieldMic', cap) === 'fieldMic' && cap.take()?.start === 4);
  cap.track(at(1));
  ck('桌面麦克风:同样冻结', beginVoicePress('desktopMic', cap) === 'desktopMic' && cap.take()?.start === 1);
  cap.track(at(2));
  ck('大条:不冻结(永远接末尾)', beginVoicePress('holdBar', cap) === 'holdBar' && cap.take() === null);
}
// ── 网页宿主选区(textarea)──
{
  ck('hostSelection:textarea 的 selectionStart/End', JSON.stringify(hostSelection({ selectionStart: 2, selectionEnd: 5 })) === '{"start":2,"end":5}');
  ck('hostSelection:原生 ref / null / 非数字 → null', hostSelection({ focus() {} }) === null && hostSelection(null) === null && hostSelection({ selectionStart: '2', selectionEnd: 3 }) === null);
  const cap = createSelectionCapture();
  cap.track(at(7));                                   // 最后一次报上来的事件(过期)
  const host = hostSelection({ selectionStart: 2, selectionEnd: 2 });
  if (host) cap.track(host);                          // 按下时读到的真实选区
  beginVoicePress('fieldMic', cap);
  ck('按下时宿主选区优先于过期的事件值', cap.take()?.start === 2);
}
// ── 来源 → 插哪 / 要不要还焦点 ──
ck('大条:接末尾(忽略任何快照)', voiceInsertTarget('holdBar', at(1)) === null);
ck('输入框麦克风 / 桌面麦克风:用快照', voiceInsertTarget('fieldMic', at(1))?.start === 1 && voiceInsertTarget('desktopMic', at(3))?.start === 3);
ck('大条插完不还焦点(#422 不弹键盘);另两个还', !refocusAfterInsert('holdBar') && refocusAfterInsert('fieldMic') && refocusAfterInsert('desktopMic'));
ck('点草稿卡片:键盘 + focus + 光标放末尾', onVoiceDraftCardTap().mode === 'keyboard' && onVoiceDraftCardTap().focusInput && onVoiceDraftCardTap().cursorAtEnd);

// ── 麦克风几何(#424:不改行高、不离开中线) ──
{
  const c40 = composerControlSize(1), c36 = composerControlSize(0.5);
  ck('行高 40 → 麦克风 32;行高下限 36 → 28', c40 === COMPOSER_CONTROL_BASE && composerFieldMicSize(c40) === 32 && c36 === COMPOSER_CONTROL_MIN && composerFieldMicSize(c36) === 28);
  ck('单行时圆心 = 输入框中线(bottom inset + 半径 = 行高一半)', [c40, c36, composerControlSize(1.3)].every(c => FIELD_MIC_INSET + composerFieldMicSize(c) / 2 === c / 2));
  ck('输入框右内边距让出整个麦克风', [c40, c36].every(c => composerInputPadRightWithMic(c) >= composerFieldMicSize(c) + FIELD_MIC_INSET));
}

// ── 接线(源码层) ──
const chat = read('src/ChatScreen.tsx');
const ui = read('src/VoiceInputUI.tsx');
const ivtAt = chat.indexOf('const insertVoiceText = (text: string) => {');
const ivt = chat.slice(ivtAt, chat.indexOf('\n  };', ivtAt));
ck('insertVoiceText:先 take() 快照(一次性),再按来源分支', ivtAt > 0 && ivt.indexOf('selectionCaptureRef.current.take()') < ivt.indexOf('refocusAfterInsert(source)'));
const cursorBranch = ivt.slice(ivt.indexOf('return;'));
ck('光标分支:插入 → setDraft → placeCursor(r.cursor) → focus()', /const r = insertAtSelection\(draftRef\.current, text, voiceInsertTarget\(source, frozen\)\);[\s\S]*setDraft\(r\.value\);\s*placeCursor\(r\.cursor\);\s*mainComposerRef\.current\?\.focus\(\);/.test(cursorBranch));
ck('placeCursor 在草稿提交之后(effect)才受控设置 selection', /useEffect\(\(\) => \{\s*const c = pendingCursorRef\.current;[\s\S]{0,200}setForcedSelection\(sel\);\s*\}, \[cursorRequest\]\);/.test(chat));
ck('放光标后放开控制(undefined),用户可以随便挪', /setTimeout\(\(\) => setForcedSelection\(undefined\), \d+\)/.test(chat));
ck('放光标时同步更新跟踪器(下一句从这里接)', /const sel = \{ start: c, end: c \};\s*selectionCaptureRef\.current\.track\(sel\);/.test(chat));
const selCount = (chat.match(/onSelectionChange=\{onComposerSelectionChange\}\s*selection=\{forcedSelection\}/g) ?? []).length;
ck('手机输入框 + 桌面输入框都跟踪选区、都接受受控光标', selCount === 2);
ck('三个麦克风各自带来源:大条 holdBar / 框内 fieldMic / 桌面 desktopMic', chat.includes("handlers={voiceHandlersFor('holdBar')}") && chat.includes("handlers={voiceHandlersFor('fieldMic')}") && chat.includes("handlers={voiceHandlersFor('desktopMic')}"));
const vhAt = chat.indexOf('const voiceHandlersFor = (source: VoiceSource) => withPressStart(');
const vh = chat.slice(vhAt, chat.indexOf('\n  );', vhAt));
ck('voiceHandlersFor:按下时先读宿主选区,再 beginVoicePress,且只在 idle 时', vhAt > 0
  && /const host = hostSelection\(mainComposerRef\.current\);\s*if \(host\) selectionCaptureRef\.current\.track\(host\);\s*voiceSourceRef\.current = beginVoicePress\(source, selectionCaptureRef\.current\);/.test(vh)
  && /\(\) => voice\.state\.phase === 'idle',\s*$/.test(vh));
ck('框内麦克风只在键盘模式(手机 / 双栏,非桌面,available)', chat.includes('const fieldMic = !desktop && voice.available && !voiceMode;') && chat.includes("{fieldMic ? <VoiceFieldMic voice={voice} handlers={voiceHandlersFor('fieldMic')} /> : null}"));
ck('有框内麦克风时输入框让出右内边距', chat.includes('fieldMic && styles.inputWithFieldMic') && /inputWithFieldMic: \{ paddingRight: composerInputPadRightWithMic\(/.test(chat));
ck('点草稿卡片:focus 后 placeCursor(草稿末尾)', /if \(atEnd\) placeCursor\(draftRef\.current\.length\);/.test(chat) && chat.includes('if (tr.cursorAtEnd) cursorAtEndAfterFocusRef.current = true;'));
ck('全屏编辑器关闭 → 选区作废', chat.includes('if (fullEditorOpen && !t.open) selectionCaptureRef.current.reset();'));
ck('网页 / 桌面 webview:麦克风 mousedown 不抢输入框焦点', /const keepInputFocus = Platform\.OS === 'web' \? \{ onMouseDown: \(e: \{ preventDefault\(\): void \}\) => e\.preventDefault\(\) \} : null;/.test(ui) && (ui.match(/\{\.\.\.keepInputFocus\}/g) ?? []).length === 2);
const fm = ui.slice(ui.indexOf('export function VoiceFieldMic'), ui.indexOf('/** Ionicons 没有键盘图标'));
ck('VoiceFieldMic 用传进来的 handlers(不是裸 voice.micHandlers)', fm.includes('{...handlers}') && !fm.includes('voice.micHandlers'));
ck('VoiceFieldMic 未配置时同样可按(走「去设置」),识别中 busy', fm.includes("voice.configured ? '按住说话,插到光标处' : '语音输入(未配置)'") && fm.includes('accessibilityState={{ busy, disabled: busy }}'));
ck('框内麦克风钉在输入框右下角 inset 处', /fieldMic: \{\s*position: 'absolute',\s*right: FIELD_MIC_INSET,\s*bottom: FIELD_MIC_INSET,/.test(ui));

console.log(`voice insert at cursor: ${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);
