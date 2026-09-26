// ck-style (self-executing; run by scripts/run-tests.mjs). 识别模型选择与回退规则:
// 哪个平台走流式、什么失败要记住、失败时怎样整段回退极速版,以及一句话编排器(Utterance)。
import {
  chooseRoute, defaultMode, finishUtterance, MODE_LABELS, parseMode, shouldRemember, STREAM_UNAVAILABLE_HINT,
  streamFailureMessage, streamingSupported, testFallbackNote, type SessionLike,
} from './voice-stream-policy';
import { toStreamPcm, Utterance, type StreamSessionLike } from './voice-utterance';
import type { StreamFailure, StreamOutcome } from './doubao-stream';

let p = 0, t = 0;
const ck = (name: string, cond: boolean) => { t++; if (cond) { p++; console.log(`✅ ${name}`); } else console.log(`❌ ${name}`); };

// ── 平台与默认 ──
ck('流式只在安卓 / iOS', streamingSupported('android') && streamingSupported('ios') && !streamingSupported('desktop') && !streamingSupported('web'));
ck('默认:手机 = 流式,桌面 = 极速版', defaultMode('android') === 'stream' && defaultMode('ios') === 'stream' && defaultMode('desktop') === 'flash');
ck('存过的选择优先;读坏了回平台默认', parseMode('flash', 'android') === 'flash' && parseMode('stream', 'ios') === 'stream' && parseMode('bogus', 'android') === 'stream' && parseMode(null, 'desktop') === 'flash');
ck('桌面即使存了 stream 也走极速版(webview WS 设不了头)', chooseRoute({ mode: 'stream', platform: 'desktop', streamUnavailable: false }) === 'flash');
ck('手机 + 流式 + 没记住失败 → stream', chooseRoute({ mode: 'stream', platform: 'android', streamUnavailable: false }) === 'stream');
ck('手机 + 流式 + 本次已记住不可用 → flash', chooseRoute({ mode: 'stream', platform: 'ios', streamUnavailable: true }) === 'flash');
ck('手机 + 选了极速版 → flash', chooseRoute({ mode: 'flash', platform: 'android', streamUnavailable: false }) === 'flash');
ck('文案:识别模型两项', MODE_LABELS.stream === '流式语音识别（边说边出字）' && MODE_LABELS.flash === '录音文件识别·极速版（整段识别）');
ck('提示文案', STREAM_UNAVAILABLE_HINT === '流式未开通，已使用极速版');

// ── 记住哪些失败 ──
const remember: [StreamFailure, string | undefined, boolean][] = [
  ['not_enabled', '403', true],
  ['auth_rejected', '401', true],
  ['protocol', 'gzip_unsupported', true],
  ['bad_endpoint', undefined, true],
  ['rejected', '400', true],
  ['rejected', '45000001', true],
  ['rejected', '45000002', false], // 空音频:这一句的问题
  ['rejected', '45000081', false], // 等包超时:偶发
  ['rejected', '55000031', false], // 服务繁忙
  ['connect_failed', undefined, false],
  ['connect_timeout', undefined, false],
  ['closed', undefined, false],
  ['server_error', '55000031', false],
  ['final_timeout', undefined, false],
];
for (const [f, up, want] of remember) ck(`shouldRemember(${f}${up ? ' ' + up : ''}) = ${want}`, shouldRemember(f, up) === want);

// ── 回退:流式失败 → 整段录音走极速版 ──
const session = (out: StreamOutcome): SessionLike & { cancelled: boolean } => ({ cancelled: false, finish: async () => out, cancel() { this.cancelled = true; } });
{
  let flashCalls = 0;
  const r = await finishUtterance({ session: session({ ok: true, text: '流式终稿' }), flash: async () => { flashCalls++; return 'x'; }, onRemember: () => {} });
  ck('流式成功 → 用流式终稿,不调极速版', r.text === '流式终稿' && r.via === 'stream' && flashCalls === 0);
}
{
  const remembered: string[] = [];
  const r = await finishUtterance({ session: session({ ok: false, failure: 'not_enabled', upstream: '403' }), flash: async () => '极速版结果', onRemember: (f, u) => remembered.push(`${f}:${u}`) });
  ck('流式没开通 → 这一句改走极速版,并记住', r.text === '极速版结果' && r.via === 'flash' && r.failure === 'not_enabled' && r.remembered === true && remembered.join() === 'not_enabled:403');
}
{
  const remembered: string[] = [];
  const r = await finishUtterance({ session: session({ ok: false, failure: 'final_timeout' }), flash: async () => '整段', onRemember: f => remembered.push(f) });
  ck('等终稿超时 → 这一句改走极速版,不记住', r.text === '整段' && r.via === 'flash' && !r.remembered && remembered.length === 0);
}
{
  const r = await finishUtterance({ session: null, flash: async () => '只有极速版', onRemember: () => {} });
  ck('没有流式会话(选了极速版)→ 直接极速版', r.text === '只有极速版' && r.via === 'flash' && r.failure === undefined);
}
{
  let threw = '';
  try { await finishUtterance({ session: session({ ok: false, failure: 'closed' }), flash: async () => { throw new Error('flash-down'); }, onRemember: () => {} }); } catch (e) { threw = (e as Error).message; }
  ck('流式失败且极速版也失败 → 抛极速版的错(真实失败,不吞)', threw === 'flash-down');
}

// ── 「测试」结果下面的说明 ──
ck('测试:流式没开通 → 点名服务 + 资源 ID + 已使用极速版', testFallbackNote('stream', { via: 'flash', failure: 'not_enabled', remembered: true }, 'volc.bigasr.sauc.duration') === '服务未开通：请在开通管理里开通 流式语音识别大模型（资源 ID volc.bigasr.sauc.duration）。流式未开通，已使用极速版');
ck('测试:流式偶发失败 → 「本次已改用极速版」', testFallbackNote('stream', { via: 'flash', failure: 'connect_failed', remembered: false }, 'x')!.endsWith('本次已改用极速版'));
ck('测试:流式成功 / 本来就选极速版 → 无说明', testFallbackNote('stream', { via: 'stream' }, 'x') === undefined && testFallbackNote('flash', { via: 'flash' }, 'x') === undefined);
ck('流式鉴权失败按控制台版本点名字段', streamFailureMessage('auth_rejected', 'x', 'api-key') === '鉴权失败：API Key 不对' && streamFailureMessage('auth_rejected', 'x', 'app-token') === '鉴权失败：App ID 或 Access Token 不对');
ck('流式网络类失败 → 「网络失败」开头', (['connect_failed', 'connect_timeout', 'closed', 'final_timeout'] as StreamFailure[]).every(f => streamFailureMessage(f, 'x').startsWith('网络失败')));

// ── Utterance 编排 ──
class FakeSession implements StreamSessionLike {
  pushed: Int16Array[] = [];
  cancelled = false;
  constructor(private out: StreamOutcome) {}
  push(pcm: Int16Array) { this.pushed.push(pcm); }
  finish() { return Promise.resolve(this.out); }
  cancel() { this.cancelled = true; }
}
{
  let created: FakeSession | null = null;
  let release!: () => void;
  const credsGate = new Promise<void>(r => { release = r; });
  const interim: string[] = [];
  let cb: ((s: string) => void) | null = null;
  const u = new Utterance({
    route: 'stream',
    loadCreds: async () => { await credsGate; return { appId: '', accessToken: 'k', endpoint: '' }; },
    openSession: (_c, onInterim) => { cb = onInterim; return (created = new FakeSession({ ok: true, text: '终稿' })); },
    onInterim: x => interim.push(x),
  });
  u.start();
  u.onChunk(new Int16Array(4800), 48000, 1); // 凭据还在读:先攒着(且已转成 16 kHz)
  u.onChunk(new Int16Array([100, 300]), 16000, 2); // 双声道 → 取平均
  ck('会话还没建好时收到的分段先攒着', created === null);
  release();
  await new Promise(r => setTimeout(r, 0));
  ck('会话建好后按顺序补推(48 kHz → 16 kHz、立体声 → 单声道)', !!created && created!.pushed.length === 2 && created!.pushed[0].length === 1600 && created!.pushed[1].length === 1 && created!.pushed[1][0] === 200);
  cb!('中间');
  ck('中间结果透传', interim.join() === '中间');
  const r = await u.finish(async () => 'flash', () => {});
  ck('finish → 流式终稿', r.text === '终稿' && r.via === 'stream');
  u.onChunk(new Int16Array(10), 16000, 1);
  ck('finish 之后的分段不再推', created!.pushed.length === 2);
}
{
  let opened = 0;
  const u = new Utterance({ route: 'flash', loadCreds: async () => null, openSession: () => { opened++; return new FakeSession({ ok: true, text: '' }); }, onInterim: () => {} });
  u.start(); u.onChunk(new Int16Array(10), 16000, 1);
  const r = await u.finish(async () => '极速', () => {});
  ck('极速版路线:不建流式会话,直接极速版', opened === 0 && r.text === '极速' && r.via === 'flash');
}
{
  let s: FakeSession | null = null;
  const u = new Utterance({ route: 'stream', loadCreds: async () => null, openSession: () => (s = new FakeSession({ ok: true, text: 'x' })), onInterim: () => {} });
  u.start();
  await new Promise(r => setTimeout(r, 0));
  u.cancel();
  ck('取消 → 会话 cancel', s!.cancelled);
  u.onChunk(new Int16Array(10), 16000, 1);
  ck('取消后不再推分段', s!.pushed.length === 0);
}
{
  let opened = 0;
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const u = new Utterance({ route: 'stream', loadCreds: async () => { await gate; return null; }, openSession: () => { opened++; return new FakeSession({ ok: true, text: 'x' }); }, onInterim: () => {} });
  u.start(); u.cancel(); release();
  await new Promise(r => setTimeout(r, 0));
  ck('凭据还没读完就取消 → 不再建连', opened === 0);
}
ck('toStreamPcm:16 kHz 单声道原样', (() => { const x = new Int16Array([1, 2, 3]); return toStreamPcm(x, 16000, 1) === x; })());

console.log(`voice stream policy: ${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);
