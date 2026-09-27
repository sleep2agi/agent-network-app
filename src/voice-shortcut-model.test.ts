// 键盘语音输入(按住说话 / 语音输入开关)的状态机。ck 风格,自执行,失败 exit 1。run: bun src/voice-shortcut-model.test.ts
import * as V from './voice-shortcut-model';
import { comboChips } from './shortcuts-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n, extra); };

const HOLD = 'Mod+Shift+Space';
const TOGGLE = 'Mod+Shift+M';
const ctx = { composer: true, voiceIdle: true };
const down = (s: V.KbdVoiceState, o: Partial<V.KbdVoiceKeyDown> = {}, c: Partial<V.KbdVoiceContext> = {}) =>
  V.kbdVoiceKeyDown(s, { shortcut: null, combo: null, repeat: false, escape: false, ...o }, { ...ctx, ...c });
const holdDown = (s: V.KbdVoiceState, o: Partial<V.KbdVoiceKeyDown> = {}, c: Partial<V.KbdVoiceContext> = {}) => down(s, { shortcut: 'hold', combo: HOLD, ...o }, c);
const toggleDown = (s: V.KbdVoiceState, o: Partial<V.KbdVoiceKeyDown> = {}, c: Partial<V.KbdVoiceContext> = {}) => down(s, { shortcut: 'toggle', combo: TOGGLE, ...o }, c);

// ── 按住说话 ──
const a = holdDown(V.KBD_IDLE);
ck('keydown → 开始录音(press)并吃掉按键', a.effect === 'press' && a.consume && a.state.mode === 'hold' && a.state.mode === 'hold' && (a.state as { combo: string }).combo === HOLD);
const rep = holdDown(a.state, { repeat: true });
ck('按住不放的自动重复:不重开录音,但照样吃掉(不往输入框打空格)', rep.effect === 'none' && rep.consume && rep.state === a.state);
const again = holdDown(a.state);
ck('没有 repeat 标记的重复 keydown(某些 WebView)也不重开', again.effect === 'none' && again.state.mode === 'hold');
const upOther = V.kbdVoiceKeyUp(a.state, { key: 'a', code: 'KeyA' }, false);
ck('松开别的键:不算松手,不吃掉', upOther.effect === 'none' && !upOther.consume && upOther.state.mode === 'hold');
const upMain = V.kbdVoiceKeyUp(a.state, { key: ' ', code: 'Space' }, false);
ck('松开主键 Space → release(识别并插到光标处)', upMain.effect === 'release' && upMain.consume && upMain.state.mode === 'idle');
ck('松开组合里的修饰键(Windows 的 Ctrl)→ release', V.kbdVoiceKeyUp(a.state, { key: 'Control', code: 'ControlLeft' }, false).effect === 'release');
ck('松开组合里的 Shift → release', V.kbdVoiceKeyUp(a.state, { key: 'Shift', code: 'ShiftRight' }, false).effect === 'release');
ck('mac:⌘ 松开(Meta)→ release(按着 ⌘ 时松开 Space 浏览器不发 keyup)', V.kbdVoiceKeyUp(a.state, { key: 'Meta', code: 'MetaLeft' }, true).effect === 'release');
ck('mac:Mod 是 ⌘ 不是 ⌃ —— 松开 Control 不算', V.kbdVoiceKeyUp(a.state, { key: 'Control', code: 'ControlLeft' }, true).effect === 'none');
ck('Windows:Mod 是 Ctrl —— 松开 Win 键不算', V.kbdVoiceKeyUp(a.state, { key: 'Meta', code: 'MetaLeft' }, false).effect === 'none');
ck('空闲时 keyup 什么都不做', V.kbdVoiceKeyUp(V.KBD_IDLE, { key: ' ', code: 'Space' }, false).effect === 'none');
ck('松手后再来一个 keyup(先松 Space 再松 Ctrl)不再 release 第二次', V.kbdVoiceKeyUp(upMain.state, { key: 'Control' }, false).effect === 'none');
{
  const f8 = holdDown(V.KBD_IDLE, { combo: 'F8' });
  ck('改绑成 F8:松开 F8 → release', V.kbdVoiceKeyUp(f8.state, { key: 'F8', code: 'F8' }, false).effect === 'release');
}

// Esc
const esc = down(a.state, { escape: true });
ck('按住时 Esc → cancel(丢弃,不识别)并吃掉', esc.effect === 'cancel' && esc.consume && esc.state.mode === 'idle');
ck('Esc 取消后松开组合键不再 release', V.kbdVoiceKeyUp(esc.state, { key: ' ', code: 'Space' }, false).effect === 'none');
const escIdle = down(V.KBD_IDLE, { escape: true });
ck('空闲时 Esc 放行(弹窗 / 图片预览自己的 Esc 照常)', escIdle.effect === 'none' && !escIdle.consume);

// 失焦
const blur = V.kbdVoiceBlur(a.state);
ck('按住时窗口失焦 → 当作松开:release(停止并插入,不丢这段话)', blur.effect === 'release' && blur.state.mode === 'idle');
ck('空闲时失焦什么都不做', V.kbdVoiceBlur(V.KBD_IDLE).effect === 'none');

// 前提
const noComposer = holdDown(V.KBD_IDLE, {}, { composer: false });
ck('没有输入框 → needComposer(提示「先打开一个会话」),仍吃掉', noComposer.effect === 'needComposer' && noComposer.consume && noComposer.state.mode === 'idle' && V.NEED_COMPOSER_NOTICE === '先打开一个会话');
ck('没有输入框 + 自动重复 → 不重复提示', holdDown(V.KBD_IDLE, { repeat: true }, { composer: false }).effect === 'none');
const busy = holdDown(V.KBD_IDLE, {}, { voiceIdle: false });
ck('上一句还在识别 → 不开新录音(和麦克风一样)', busy.effect === 'none' && busy.state.mode === 'idle');
ck('不是语音快捷键的按键:不管、不吃', (() => { const r = down(a.state, { combo: 'Mod+K' }); return r.effect === 'none' && !r.consume && r.state === a.state; })());

// ── 开关 ──
const t1 = toggleDown(V.KBD_IDLE);
ck('开关:第一下开始', t1.effect === 'press' && t1.state.mode === 'toggle');
ck('开关:松开按键不结束', V.kbdVoiceKeyUp(t1.state, { key: 'm', code: 'KeyM' }, false).effect === 'none' && V.kbdVoiceKeyUp(t1.state, { key: 'Control' }, false).effect === 'none');
ck('开关:自动重复不结束', toggleDown(t1.state, { repeat: true }).effect === 'none');
ck('开关:失焦不结束(它本来就不用一直按着)', V.kbdVoiceBlur(t1.state).effect === 'none' && V.kbdVoiceBlur(t1.state).state.mode === 'toggle');
const t2 = toggleDown(t1.state);
ck('开关:第二下结束并插入', t2.effect === 'release' && t2.state.mode === 'idle');
ck('开关:录音中 Esc 取消', down(t1.state, { escape: true }).effect === 'cancel');
ck('开关录音中按「按住说话」不插手', holdDown(t1.state).effect === 'none' && holdDown(t1.state).state.mode === 'toggle');
ck('按住说话中按开关不插手', toggleDown(a.state).effect === 'none' && toggleDown(a.state).state.mode === 'hold');

// ── 与语音状态机同步 ──
ck('录音自己结束(60 s 上限进入识别)→ 回 idle,之后 keyup 不再 release', (() => {
  const s = V.kbdVoiceSync(a.state, 'transcribing');
  return s.mode === 'idle' && V.kbdVoiceKeyUp(s, { key: ' ', code: 'Space' }, false).effect === 'none';
})());
ck('开麦失败 / 太短 / 未配置(语音回 idle)→ 开关也回 idle,下一下重新开始', (() => {
  const s = V.kbdVoiceSync(t1.state, 'idle');
  return s.mode === 'idle' && toggleDown(s).effect === 'press';
})());
ck('录音中 / 准备中不动', V.kbdVoiceSync(a.state, 'recording') === a.state && V.kbdVoiceSync(a.state, 'starting') === a.state);

// ── 完整一轮(按住 → 重复 ×3 → 松开;开关 → 开关)──
{
  const events: V.KbdVoiceEffect[] = [];
  let s: V.KbdVoiceState = V.KBD_IDLE;
  const push = (r: V.KbdVoiceStep) => { s = r.state; if (r.effect !== 'none') events.push(r.effect); };
  push(holdDown(s)); push(holdDown(s, { repeat: true })); push(holdDown(s, { repeat: true })); push(holdDown(s, { repeat: true }));
  push(V.kbdVoiceKeyUp(s, { key: ' ', code: 'Space' }, false)); push(V.kbdVoiceKeyUp(s, { key: 'Shift' }, false)); push(V.kbdVoiceKeyUp(s, { key: 'Control' }, false));
  s = V.kbdVoiceSync(s, 'idle');
  push(toggleDown(s)); push(toggleDown(s));
  ck('一轮:press, release, press, release —— 恰好各一次', JSON.stringify(events) === '["press","release","press","release"]', JSON.stringify(events));
}

// ── 指示条文案 ──
ck('按住说话提示:Windows「松开 Ctrl+Shift+Space 完成 · Esc 取消」', V.kbdVoiceHint('hold', comboChips(HOLD, false), false, 'recording') === '松开 Ctrl+Shift+Space 完成 · Esc 取消');
ck('按住说话提示:mac「松开 ⌘⇧Space 完成 · Esc 取消」', V.kbdVoiceHint('hold', comboChips(HOLD, true), true, 'recording') === '松开 ⌘⇧Space 完成 · Esc 取消');
ck('开关提示:「再按 Ctrl+Shift+M 完成 · Esc 取消」', V.kbdVoiceHint('toggle', comboChips(TOGGLE, false), false, 'recording') === '再按 Ctrl+Shift+M 完成 · Esc 取消');
ck('识别中 / 准备中', V.kbdVoiceHint('hold', [], false, 'transcribing') === '识别中…' && V.kbdVoiceHint('toggle', [], false, 'starting') === '准备录音…');
ck('comboReleaseKeys', JSON.stringify(V.comboReleaseKeys('Mod+Shift+Space', true)) === '{"main":"Space","modifiers":["Meta","Shift"]}' && JSON.stringify(V.comboReleaseKeys('Mod+Alt+V', false)) === '{"main":"V","modifiers":["Control","Alt"]}');

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
