// ck-style (self-executing; run by scripts/run-tests.mjs). 按住说话状态机:按下/按住/松开/上滑取消/超时/未配置。
import { CANCEL_SLIDE_PX, formatElapsed, IDLE, insertRecognized, overlayHint, voiceStep, type VoiceEvent, type VoiceState } from './voice-input-model';

let p = 0, t = 0;
const ck = (name: string, cond: boolean) => { t++; if (cond) { p++; console.log(`✅ ${name}`); } else console.log(`❌ ${name}`); };

const LIMITS = { minSeconds: 0.6, maxSeconds: 60 };
const run = (events: VoiceEvent[], from: VoiceState = IDLE) => {
  let s = from;
  const effects: string[] = [];
  for (const e of events) { const r = voiceStep(s, e, LIMITS); s = r.state; effects.push(r.effect.kind === 'insertText' ? `insert:${r.effect.text}` : r.effect.kind); }
  return { s, effects };
};

// 正常一句
{
  const { s, effects } = run([
    { type: 'press', configured: true, now: 0 },
    { type: 'started', now: 100 },
    { type: 'move', dy: -10 },
    { type: 'release', now: 2100 },
    { type: 'transcribed', text: '  打开终端 ' },
  ]);
  ck('按下 → startRecording', effects[0] === 'startRecording');
  ck('松开(2 s)→ stopAndTranscribe', effects[3] === 'stopAndTranscribe');
  ck('识别完 → 插入文本(去空白),回到 idle', effects[4] === 'insert:打开终端' && s.phase === 'idle');
  ck('全程没有 routeToSettings / discard', !effects.includes('routeToSettings') && !effects.includes('discardRecording'));
}
{
  const r = voiceStep({ phase: 'starting', startedAt: 0, notice: null }, { type: 'started', now: 500 }, LIMITS);
  ck('started 记录开始时间', r.state.phase === 'recording' && r.state.startedAt === 500);
}

// 太短
{
  const { s, effects } = run([{ type: 'press', configured: true, now: 0 }, { type: 'started', now: 0 }, { type: 'release', now: 300 }]);
  ck('<0.6 s 松开 → 丢弃 + 「说话时间太短」', effects[2] === 'discardRecording' && s.phase === 'idle' && s.notice === '说话时间太短');
}
{
  const { effects } = run([{ type: 'press', configured: true, now: 0 }, { type: 'started', now: 0 }, { type: 'release', now: 600 }]);
  ck('恰好 0.6 s → 识别(边界值)', effects[2] === 'stopAndTranscribe');
}

// 上滑取消
{
  const base: VoiceEvent[] = [{ type: 'press', configured: true, now: 0 }, { type: 'started', now: 0 }];
  const a = run([...base, { type: 'move', dy: -(CANCEL_SLIDE_PX - 1) }]);
  ck('上滑不到阈值 → 仍在录', a.s.phase === 'recording');
  const b = run([...base, { type: 'move', dy: -CANCEL_SLIDE_PX }]);
  ck('上滑到阈值 → cancelArmed', b.s.phase === 'cancelArmed');
  ck('cancelArmed 提示「松开手指,取消发送」', overlayHint(b.s.phase).includes('取消'));
  const c = run([...base, { type: 'move', dy: -200 }, { type: 'release', now: 5000 }]);
  ck('在取消区松开 → 丢弃、不识别', c.effects[3] === 'discardRecording' && !c.effects.includes('stopAndTranscribe') && c.s.phase === 'idle');
  const d = run([...base, { type: 'move', dy: -200 }, { type: 'move', dy: -5 }, { type: 'release', now: 5000 }]);
  ck('滑回来再松开 → 照常识别', d.s.phase === 'transcribing' && d.effects[4] === 'stopAndTranscribe');
}

// 录音还没起来就松开 / 起来后才到
{
  const a = run([{ type: 'press', configured: true, now: 0 }, { type: 'release', now: 50 }]);
  ck('starting 时松开 → 直接回 idle,无副作用', a.s.phase === 'idle' && a.effects[1] === 'none');
  const b = run([{ type: 'started', now: 80 }], a.s);
  ck('松开后录音才起来 → 立刻丢弃(不留后台录音)', b.effects[0] === 'discardRecording' && b.s.phase === 'idle');
  const c = run([{ type: 'press', configured: true, now: 0 }, { type: 'startFailed', reason: '麦克风权限被拒绝' }]);
  ck('启动失败 → idle + 原因', c.s.phase === 'idle' && c.s.notice === '麦克风权限被拒绝');
}

// 手势被系统夺走
{
  const a = run([{ type: 'press', configured: true, now: 0 }, { type: 'started', now: 0 }, { type: 'terminate' }]);
  ck('terminate → 丢弃(绝不偷偷识别)', a.effects[2] === 'discardRecording' && a.s.phase === 'idle');
}

// 60 s 上限
{
  const base: VoiceEvent[] = [{ type: 'press', configured: true, now: 0 }, { type: 'started', now: 0 }];
  const a = run([...base, { type: 'tick', now: 59_000 }]);
  ck('59 s tick → 继续录', a.s.phase === 'recording' && a.effects[2] === 'none');
  const b = run([...base, { type: 'tick', now: 60_000 }]);
  ck('60 s → 自动识别 + 上限提示', b.effects[2] === 'stopAndTranscribe' && b.s.phase === 'transcribing' && !!b.s.notice?.includes('60'));
  const c = run([...base, { type: 'move', dy: -100 }, { type: 'tick', now: 60_000 }]);
  ck('60 s 时在取消区 → 取消', c.effects[3] === 'discardRecording' && c.s.phase === 'idle');
  const d = run([...base, { type: 'tick', now: 60_000 }, { type: 'release', now: 60_100 }]);
  ck('自动识别后再松开 → 无副作用', d.effects[3] === 'none' && d.s.phase === 'transcribing');
}

// 未配置
{
  const a = run([{ type: 'press', configured: false, now: 0 }]);
  ck('未配置按下 → routeToSettings,不录音', a.effects[0] === 'routeToSettings' && a.s.phase === 'idle');
  ck('未配置提示文案', a.s.notice === '未配置语音识别，去设置');
  const b = run([{ type: 'release', now: 10 }], a.s);
  ck('未配置时松开 → 无副作用', b.effects[0] === 'none');
}

// 识别中
{
  const tr: VoiceState = { phase: 'transcribing', startedAt: 0, notice: null };
  ck('识别中再按 → 忽略', voiceStep(tr, { type: 'press', configured: true, now: 1 }, LIMITS).effect.kind === 'none');
  const empty = voiceStep(tr, { type: 'transcribed', text: '  ' }, LIMITS);
  ck('识别为空 → 不插入 + 「没有识别到文字」', empty.effect.kind === 'none' && empty.state.notice === '没有识别到文字');
  const fail = voiceStep(tr, { type: 'failed', message: '语音识别超时,请重试' }, LIMITS);
  ck('识别失败 → idle + 错误提示', fail.state.phase === 'idle' && fail.state.notice === '语音识别超时,请重试');
  ck('idle 时迟到的识别结果 → 不插入', voiceStep(IDLE, { type: 'transcribed', text: 'x' }, LIMITS).effect.kind === 'none');
}

// 插入输入框(不自动发送)
ck('空草稿 → 直接是识别文本', insertRecognized('', '你好') === '你好');
ck('中文接中文 → 直接相接', insertRecognized('你好。', '在吗') === '你好。在吗');
ck('英文接英文 → 补一个空格', insertRecognized('hello', 'world') === 'hello world');
ck('草稿末尾已有空白 → 不重复补', insertRecognized('hello ', 'world') === 'hello world');
ck('空识别 → 草稿不变', insertRecognized('草稿', '  ') === '草稿');
ck('计时格式', formatElapsed(7_900) === '00:07' && formatElapsed(65_000) === '01:05' && formatElapsed(-5) === '00:00');

console.log(`voice input model: ${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);
