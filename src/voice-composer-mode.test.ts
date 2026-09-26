// ck-style (self-executing; run by scripts/run-tests.mjs). 微信式输入区:🎤/⌨ 切换、「按住 说话」条的按压状态、
// 上滑取消区、触感时机。状态机本身在 voice-input-model.test.ts;这里测它们在输入区上的投影。
import {
  CANCEL_SLIDE_PX, cancelZoneLabel, hapticFor, holdBarLabel, holdBarTone, IDLE, parseComposerInputMode,
  toggleButtonShows, toggleComposerInputMode, VOICE_TOGGLE_ICON, voiceStep, type VoiceEvent, type VoiceState,
} from './voice-input-model';
import { readFileSync } from 'node:fs';
import { posix, sep } from 'node:path';

const read = (f: string) => readFileSync(f.split(sep).join(posix.sep), 'utf8').replace(/\r\n/g, '\n');

let p = 0, t = 0;
const ck = (name: string, cond: boolean) => { t++; if (cond) { p++; console.log(`✅ ${name}`); } else console.log(`❌ ${name}`); };

// ── 切换 ──
ck('没存过 / 读坏了 → 键盘', parseComposerInputMode(null) === 'keyboard' && parseComposerInputMode('bogus') === 'keyboard');
ck('存了 voice → 语音', parseComposerInputMode('voice') === 'voice');
ck('切换:键盘 ⇄ 语音', toggleComposerInputMode('keyboard') === 'voice' && toggleComposerInputMode('voice') === 'keyboard');
ck('按钮显示「点了会去哪」:键盘模式显示 🔊(语音),语音模式显示 ⌨', toggleButtonShows('keyboard') === 'voice' && toggleButtonShows('voice') === 'keyboard');
ck('键盘模式切换图标 = Ionicons 音量族(微信 🔊),不是麦克风', VOICE_TOGGLE_ICON === 'volume-high-outline' && !VOICE_TOGGLE_ICON.includes('mic'));
{
  // 图标名必须真在 Ionicons 字形表里(写错名 = 渲染成「?」,类型检查未必拦得住)。
  const glyphs = JSON.parse(read('node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json')) as Record<string, number>;
  ck('VOICE_TOGGLE_ICON 在 Ionicons 字形表里', typeof glyphs[VOICE_TOGGLE_ICON] === 'number');
  const ui = read('src/VoiceInputUI.tsx');
  const toggle = ui.slice(ui.indexOf('export function ComposerModeToggle'), ui.indexOf('/** 语音模式下代替输入框的整条'));
  ck('切换按钮用 VOICE_TOGGLE_ICON,切换按钮里没有麦克风图标', toggle.includes('<Ionicons name={VOICE_TOGGLE_ICON}') && !/mic/.test(toggle.replace(/\/\*\*[\s\S]*?\*\//g, '')));
  ck('键盘模式一行里只有一个麦克风:mic 图标只出现在 VoiceMicButton(桌面)和 VoiceFieldMic(框内)', (ui.match(/'mic-outline'/g) ?? []).length === 2);
}

// ── 按住说话条:一次完整按压的文字 / 颜色 ──
const drive = (events: VoiceEvent[]) => {
  let s: VoiceState = IDLE;
  const trace: { phase: string; label: string; tone: string; haptic: string | null }[] = [];
  for (const e of events) {
    const prev = s.phase;
    s = voiceStep(s, e).state;
    trace.push({ phase: s.phase, label: holdBarLabel(s.phase), tone: holdBarTone(s.phase), haptic: hapticFor(prev, s.phase) });
  }
  return trace;
};
{
  const tr = drive([
    { type: 'press', configured: true, now: 0 },
    { type: 'started', now: 50 },
    { type: 'move', dy: -(CANCEL_SLIDE_PX - 1) },
    { type: 'move', dy: -CANCEL_SLIDE_PX },
    { type: 'move', dy: -10 },
    { type: 'release', now: 3000 },
  ]);
  ck('松着:「按住 说话」/ idle 色', holdBarLabel('idle') === '按住 说话' && holdBarTone('idle') === 'idle');
  ck('按下(还在起麦)就变「松开 转文字」+ 按下色', tr[0].label === '松开 转文字' && tr[0].tone === 'pressed');
  ck('录音中:「松开 转文字」+ 按下色', tr[1].label === '松开 转文字' && tr[1].tone === 'pressed');
  ck(`上滑 ${CANCEL_SLIDE_PX - 1}px:还没进取消区`, tr[2].phase === 'recording' && tr[2].tone === 'pressed');
  ck(`上滑 ${CANCEL_SLIDE_PX}px:进取消区 →「松开 取消」+ 红色`, tr[3].phase === 'cancelArmed' && tr[3].label === '松开 取消' && tr[3].tone === 'cancel');
  ck('滑回来:退出取消区', tr[4].phase === 'recording' && tr[4].tone === 'pressed');
  ck('松手:「识别中…」+ busy', tr[5].phase === 'transcribing' && tr[5].label === '识别中…' && tr[5].tone === 'busy');
  ck('触感:按下一次、进取消区一次,其余不震', tr.map(x => x.haptic ?? '-').join(',') === 'press,-,-,cancelArmed,-,-');
}
{
  const tr = drive([
    { type: 'press', configured: true, now: 0 },
    { type: 'started', now: 50 },
    { type: 'move', dy: -200 },
    { type: 'release', now: 3000 },
  ]);
  ck('在取消区里松手 → 回到 idle(不识别),条恢复「按住 说话」', tr[3].phase === 'idle' && tr[3].label === '按住 说话' && tr[3].tone === 'idle');
}
{
  const tr = drive([{ type: 'press', configured: false, now: 0 }]);
  ck('未配置时按下:不变色、不震(只给「去设置」)', tr[0].tone === 'idle' && tr[0].haptic === null);
}

// ── 取消区文案 ──
ck('取消区:平时「上滑到这里取消」,进去后「松开手指，取消」', cancelZoneLabel('recording') === '上滑到这里取消' && cancelZoneLabel('cancelArmed') === '松开手指，取消');
ck('按住文案不承诺「发送」(松手只进输入框)', !['starting', 'recording', 'cancelArmed', 'transcribing', 'idle'].some(ph => holdBarLabel(ph as any).includes('发送')));

console.log(`voice composer mode: ${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);
