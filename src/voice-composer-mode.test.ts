// ck-style (self-executing; run by scripts/run-tests.mjs). 微信式输入区:🎤/⌨ 切换、「按住 说话」条的按压状态、
// 上滑取消区、触感时机。状态机本身在 voice-input-model.test.ts;这里测它们在输入区上的投影。
import {
  CANCEL_SLIDE_PX, cancelZoneLabel, hapticFor, holdBarLabel, holdBarTone, IDLE, parseComposerInputMode,
  toggleButtonShows, toggleComposerInputMode, voiceStep, type VoiceEvent, type VoiceState,
} from './voice-input-model';

let p = 0, t = 0;
const ck = (name: string, cond: boolean) => { t++; if (cond) { p++; console.log(`✅ ${name}`); } else console.log(`❌ ${name}`); };

// ── 切换 ──
ck('没存过 / 读坏了 → 键盘', parseComposerInputMode(null) === 'keyboard' && parseComposerInputMode('bogus') === 'keyboard');
ck('存了 voice → 语音', parseComposerInputMode('voice') === 'voice');
ck('切换:键盘 ⇄ 语音', toggleComposerInputMode('keyboard') === 'voice' && toggleComposerInputMode('voice') === 'keyboard');
ck('按钮显示「点了会去哪」:键盘模式显示 🎤,语音模式显示 ⌨', toggleButtonShows('keyboard') === 'mic' && toggleButtonShows('voice') === 'keyboard');

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
