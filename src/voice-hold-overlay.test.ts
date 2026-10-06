// ck-style (self-executing; run by scripts/run-tests.mjs). 手机「按住 说话」微信式浮层:
// 区判定(中间 / ✕ / 文)+ 滞回、太短、松手结果映射、触感、几何对称,以及接线(源码层)。
import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import {
  hapticFor, IDLE, NEUTRAL_RELEASE, releaseOutcome, TOO_SHORT_NOTICE, voiceStep, ZONE_RELEASE, zoneOfPhase,
  type VoiceEvent, type VoicePhase, type VoiceState, type VoiceZone,
} from './voice-input-model';
import { barScale, HOLD_OVERLAY, holdOverlayApplies, holdOverlayLabel, holdOverlayLayout, holdOverlayTone, pushLevel, zoneAt } from './voice-hold-overlay-model';
import { installVoiceSim, parseVoiceSim } from './voice-sim';

let p = 0, t = 0;
const ck = (name: string, cond: boolean, extra = '') => { t++; if (cond) { p++; console.log(`✅ ${name}`); } else console.log(`❌ ${name}${extra ? ` — ${extra}` : ''}`); };
// Windows checkouts: POSIX paths, LF line ends.
const read = (...parts: string[]) => readFileSync(join(...parts).split(sep).join('/'), 'utf8').replace(/\r\n?/g, '\n');

const LIMITS = { minSeconds: 0.6, maxSeconds: 60 };
const run = (events: VoiceEvent[], from: VoiceState = IDLE) => {
  let s = from;
  const effects: string[] = [];
  const phases: VoicePhase[] = [];
  const haptics: string[] = [];
  for (const e of events) {
    const prev = s.phase;
    const r = voiceStep(s, e, LIMITS);
    s = r.state;
    effects.push(r.effect.kind === 'insertText' ? `insert:${r.effect.text}` : r.effect.kind);
    phases.push(s.phase);
    haptics.push(hapticFor(prev, s.phase) ?? '-');
  }
  return { s, effects, phases, haptics };
};
const held: VoiceEvent[] = [{ type: 'press', configured: true, now: 0 }, { type: 'started', now: 0 }];

// ── 几何:390×812 的聊天页根视图,底部安全区 24 ──
const L = holdOverlayLayout(390, 812, 24);
ck('✕ 和 文 关于中线对称(圆心到中线距离相等)', Math.abs((L.width / 2 - L.cancelX) - (L.textX - L.width / 2)) < 1e-9, `${L.cancelX}/${L.textX}`);
ck('两个圈同一高度、在气泡之下、在状态文案之上', L.circleY > L.bubbleBottom && L.circleY < L.labelCenterY);
ck('状态文案在弧形面板之上', L.labelCenterY + 11 <= L.arcTop);
ck('弧形面板铺到底、高度含底部安全区', L.arcTop + L.arcHeight === L.height && L.arcHeight >= 116 + 24);
ck('弧的矢高 > 0(面板上沿是弧,不是直线)且小于面板高', L.arcSag > 10 && L.arcSag < L.arcHeight - L.bottomInset);
ck('气泡宽度留边(两侧各 ≥ 56px)', L.bubbleWidth <= L.width - 112);
ck('放大后的圈也不出屏', L.cancelX - L.circleSizeActive / 2 >= 0 && L.textX + L.circleSizeActive / 2 <= L.width);
{
  const narrow = holdOverlayLayout(320, 600, 0);
  ck('窄屏(320×600)同样对称、圈不出屏、气泡在圈上方', Math.abs((160 - narrow.cancelX) - (narrow.textX - 160)) < 1e-9 && narrow.cancelX - narrow.circleSizeActive / 2 >= 0 && narrow.bubbleBottom < narrow.circleY);
  const noInset = holdOverlayLayout(390, 812, 0);
  ck('底部安全区只加在面板上(圈 / 文案随面板上移)', L.arcTop === noInset.arcTop - 24 && L.circleY === noInset.circleY - 24);
  const cov = holdOverlayLayout(390, 812, 24, 600);
  ck('coverTop:面板盖到输入区(含草稿卡片最高处)上方 8px,圈 / 文案一起上移', cov.arcTop === 592 && cov.circleY === 592 - (L.arcTop - L.circleY));
  ck('coverTop 比默认面板低时不缩面板', holdOverlayLayout(390, 812, 24, 780).arcTop === L.arcTop);
  ck('coverTop 缺省 / 非法 = 默认面板', holdOverlayLayout(390, 812, 24, undefined).arcTop === L.arcTop && holdOverlayLayout(390, 812, 24, NaN).arcTop === L.arcTop && holdOverlayLayout(390, 812, 24, 0).arcTop === L.arcTop);
  ck('面板最多 45% 高(矮窗不被吃掉半屏)', holdOverlayLayout(390, 400, 0, 50).arcHeight === 180);
}

// ── 区判定 ──
const holdBarPoint = { x: L.width / 2, y: L.height - L.bottomInset - 30 };
ck('按下的位置(大条上)= 中间区', zoneAt(holdBarPoint, L, 'neutral') === 'neutral');
ck('手指到 ✕ 圆心 = 取消区', zoneAt({ x: L.cancelX, y: L.circleY }, L, 'neutral') === 'cancel');
ck('手指到 文 圆心 = 转文字区', zoneAt({ x: L.textX, y: L.circleY }, L, 'neutral') === 'toText');
ck('正上方(两圈之间)仍是中间区', zoneAt({ x: L.width / 2, y: L.circleY }, L, 'neutral') === 'neutral');
ck('一路上滑到气泡上(没往两边)仍是中间区', zoneAt({ x: L.width / 2, y: L.bubbleBottom - 40 }, L, 'neutral') === 'neutral');
{
  const at = (d: number, prev: VoiceZone, side: 'cancel' | 'toText' = 'cancel') => zoneAt({ x: (side === 'cancel' ? L.cancelX : L.textX) + d, y: L.circleY }, L, prev);
  ck(`进区边界:距圆心 = hitEnter(${L.hitEnter})算进`, at(L.hitEnter, 'neutral') === 'cancel');
  ck('进区边界:hitEnter + 1 不算', at(L.hitEnter + 1, 'neutral') === 'neutral');
  ck('滞回:已在 ✕ 里,退到 hitEnter + 10 仍在区里', at(L.hitEnter + 10, 'cancel') === 'cancel');
  ck('正控:同一点从中间区过来 = 不进(滞回是 prev 决定的,不是半径本身大)', at(L.hitEnter + 10, 'neutral') === 'neutral');
  ck(`滞回:退到 hitExit(${L.hitExit})仍在,hitExit + 1 才出`, at(L.hitExit, 'cancel') === 'cancel' && at(L.hitExit + 1, 'cancel') === 'neutral');
  ck('滞回对 文 圈同样成立', at(-(L.hitEnter + 10), 'toText', 'toText') === 'toText' && at(-(L.hitEnter + 10), 'neutral', 'toText') === 'neutral');
  ck('滞回带宽 ≥ 16px(手指抖动不会来回进出)', L.hitExit - L.hitEnter >= 16);
  ck('在 ✕ 区时,别的圈照常判定(不会卡在旧区)', zoneAt({ x: L.textX, y: L.circleY }, L, 'cancel') === 'toText');
}

// ── 状态机:zone 事件 ──
{
  const r = run([...held, { type: 'zone', zone: 'cancel' }, { type: 'release', now: 3000 }]);
  ck('✕ 区松手 → 丢弃、不识别、「已取消」', r.effects[3] === 'discardRecording' && r.s.phase === 'idle' && r.s.notice === '已取消' && !r.effects.includes('stopAndTranscribe'));
}
{
  const r = run([...held, { type: 'zone', zone: 'toText' }, { type: 'release', now: 3000 }, { type: 'transcribed', text: ' 转成文字 ' }]);
  ck('文 区松手 → 识别 → 插进草稿(insertText,不发送)', r.phases[2] === 'toTextArmed' && r.effects[3] === 'stopAndTranscribe' && r.effects[4] === 'insert:转成文字');
}
{
  const r = run([...held, { type: 'zone', zone: 'toText' }, { type: 'zone', zone: 'neutral' }, { type: 'release', now: 3000 }, { type: 'transcribed', text: '中间' }]);
  ck('中间区松手 = 现状:识别 → 插进草稿(和 #440 一样)', r.effects[4] === 'stopAndTranscribe' && r.effects[5] === 'insert:中间');
}
{
  const r = run([...held, { type: 'zone', zone: 'cancel' }, { type: 'zone', zone: 'neutral' }, { type: 'release', now: 3000 }]);
  ck('进 ✕ 又滑回中间再松手 → 照常识别', r.effects[4] === 'stopAndTranscribe');
}
{
  const r = run([...held, { type: 'zone', zone: 'toText' }, { type: 'release', now: 300 }]);
  ck('太短(0.3 s)在 文 区松手 → 「说话时间太短」+ 丢弃', r.effects[3] === 'discardRecording' && r.s.notice === TOO_SHORT_NOTICE && TOO_SHORT_NOTICE === '说话时间太短');
  const c = run([...held, { type: 'zone', zone: 'cancel' }, { type: 'release', now: 300 }]);
  ck('太短但在 ✕ 区松手 → 按取消(「已取消」,不报太短)', c.effects[3] === 'discardRecording' && c.s.notice === '已取消');
  const n = run([...held, { type: 'release', now: 599 }]);
  ck('太短边界:0.599 s 太短,0.6 s 识别', n.s.notice === TOO_SHORT_NOTICE && run([...held, { type: 'release', now: 600 }]).effects[2] === 'stopAndTranscribe');
}
{
  const r = run([...held, { type: 'zone', zone: 'toText' }, { type: 'tick', now: 60_000 }]);
  ck('停在 文 区满 60 s → 当作松开去识别', r.effects[3] === 'stopAndTranscribe' && r.s.phase === 'transcribing');
  const x = run([...held, { type: 'zone', zone: 'toText' }, { type: 'terminate' }]);
  ck('停在 文 区时手势被系统夺走 → 取消,绝不偷偷插入', x.effects[3] === 'discardRecording' && x.s.phase === 'idle');
}
{
  ck('zone 事件在 idle / starting / transcribing 时无效', voiceStep(IDLE, { type: 'zone', zone: 'cancel' }).state.phase === 'idle'
    && voiceStep({ phase: 'starting', startedAt: 0, notice: null }, { type: 'zone', zone: 'cancel' }).state.phase === 'starting'
    && voiceStep({ phase: 'transcribing', startedAt: 0, notice: null }, { type: 'zone', zone: 'cancel' }).state.phase === 'transcribing');
  const same = voiceStep({ phase: 'toTextArmed', startedAt: 5, notice: null }, { type: 'zone', zone: 'toText' });
  ck('同一区重复报告:状态对象不变(不触发重渲染)', same.state.phase === 'toTextArmed' && same.state.startedAt === 5);
  const d = run([...held, { type: 'move', dy: -200 }]);
  ck('桌面的上滑 dy 取消照旧(move 事件)', d.s.phase === 'cancelArmed');
}

// ── 松手结果映射 ──
ck('中间区 = 现状(insertDraft,不发送);以后改「松开 发送」只改这一处', NEUTRAL_RELEASE === 'insertDraft' && ZONE_RELEASE.neutral === NEUTRAL_RELEASE);
ck('映射表:✕ = discard,文 = insertDraft', ZONE_RELEASE.cancel === 'discard' && ZONE_RELEASE.toText === 'insertDraft');
{
  const table = (['neutral', 'cancel', 'toText'] as VoiceZone[]).flatMap(z => [0.2, 0.6, 5].map(s => `${z}@${s}=${releaseOutcome(z, s, 0.6)}`)).join(' ');
  ck('releaseOutcome 全表', table === 'neutral@0.2=tooShort neutral@0.6=insertDraft neutral@5=insertDraft cancel@0.2=discard cancel@0.6=discard cancel@5=discard toText@0.2=tooShort toText@0.6=insertDraft toText@5=insertDraft', table);
}
ck('zoneOfPhase 往返', zoneOfPhase('cancelArmed') === 'cancel' && zoneOfPhase('toTextArmed') === 'toText' && zoneOfPhase('recording') === 'neutral');

// ── 触感 ──
{
  const r = run([...held, { type: 'zone', zone: 'toText' }, { type: 'zone', zone: 'toText' }, { type: 'zone', zone: 'cancel' }, { type: 'zone', zone: 'neutral' }, { type: 'release', now: 3000 }, { type: 'transcribed', text: 'x' }]);
  ck('触感:按下 press;进文、文→✕、✕→中间 各一次 zone;同区重复 / 松手 / 识别完不震', r.haptics.join(',') === 'press,-,zone,-,zone,zone,-,-', r.haptics.join(','));
}

// ── 文案 / 配色档 ──
{
  const phases: VoicePhase[] = ['idle', 'starting', 'recording', 'cancelArmed', 'toTextArmed', 'transcribing'];
  ck('浮层文案都不承诺「发送」(松手只进草稿)', !phases.some(ph => holdOverlayLabel(ph).includes('发送')), phases.map(holdOverlayLabel).join('|'));
  ck('中间区文案 = 大条的「松开 转文字」', holdOverlayLabel('recording') === '松开 转文字');
  ck('✕ 区:「松开手指，取消」;文 区:「松开 放进草稿」', holdOverlayLabel('cancelArmed') === '松开手指，取消' && holdOverlayLabel('toTextArmed') === '松开 放进草稿');
  ck('配色档跟着区走', holdOverlayTone('cancelArmed') === 'cancel' && holdOverlayTone('toTextArmed') === 'toText' && holdOverlayTone('recording') === 'neutral' && holdOverlayTone('transcribing') === 'neutral');
}

// ── 波形 ──
{
  let h: number[] = [];
  for (const v of [0.1, 0.5, 2, NaN, -1]) h = pushLevel(h, v, 5);
  ck('pushLevel:定长、新的在右、越界夹到 0..1、NaN 当 0', h.join(',') === '0.1,0.5,1,0,0', h.join(','));
  ck('pushLevel:不足 n 时左边补 0', pushLevel([], 0.4, 4).join(',') === '0,0,0,0.4');
  ck('barScale:静音也留底高、满电平 = 1(中间那根)、单调', barScale(0, 10) > 0 && barScale(1, 10) === 1 && barScale(0.2, 10) > barScale(0.05, 10));
  ck('barScale:两边比中间矮', barScale(0.5, 0) < barScale(0.5, (HOLD_OVERLAY.bars - 1) / 2));
}

// ── 只在手机画 ──
{
  const AUA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15';
  ck('安卓 / iOS / 折叠屏双栏(非 desktop)→ 画', holdOverlayApplies({ desktop: false, os: 'android' }) && holdOverlayApplies({ desktop: false, os: 'ios' }));
  ck('桌面(desktop 布局)→ 永远不画,哪怕 UA 像安卓', !holdOverlayApplies({ desktop: true, os: 'web', userAgent: AUA }) && !holdOverlayApplies({ desktop: true, os: 'android' }));
  ck('窄到 phone 布局的桌面窗口(web + 非安卓 UA)→ 不画', !holdOverlayApplies({ desktop: false, os: 'web', userAgent: MAC }) && !holdOverlayApplies({ desktop: false, os: 'web' }) && !holdOverlayApplies({ desktop: false, os: 'windows' }));
  ck('网页导出 + 安卓 UA(测试模拟手机)→ 画', holdOverlayApplies({ desktop: false, os: 'web', userAgent: AUA }));
}

// ── 网页模拟开关 ──
ck('voiceSim 只认 ?voiceSim=1', parseVoiceSim('?voiceSim=1') && !parseVoiceSim('?voiceSim=0') && !parseVoiceSim('') && !parseVoiceSim(null));
ck('voiceSim 在设备上恒不开(os ≠ web)', !installVoiceSim('android') && !installVoiceSim('ios'));

// ── 接线(源码层)──
{
  const ui = read('src', 'VoiceInputUI.tsx');
  const chat = read('src', 'ChatScreen.tsx');
  const hook = read('src', 'useVoiceInput.ts');
  const ov = ui.slice(ui.indexOf('function useReduceMotion'), ui.indexOf('/** 未配置时按麦克风'));
  ck('浮层用 ui-text 的 Text(字体大小设置生效)', /import \{ Text, TextInput \} from '\.\/ui-text';/.test(ui) && !/import \{[^}]*\bText\b[^}]*\} from 'react-native'/.test(ui));
  ck('动画都走 NATIVE_DRIVER(安卓 / iOS 原生驱动)', (ov.match(/useNativeDriver: NATIVE_DRIVER/g) ?? []).length >= 3 && !/useNativeDriver: false/.test(ov) && ui.includes("const NATIVE_DRIVER = Platform.OS !== 'web';"));
  ck('减弱动态效果:读系统设置并跳过缩放 / 补帧', ov.includes('AccessibilityInfo.isReduceMotionEnabled()') && ov.includes("'reduceMotionChanged'") && /reduceMotion \? 0 : 110/.test(ov) && /if \(reduceMotion\) \{ appear\.setValue\(1\)/.test(ov));
  ck(`气泡缩放淡入 ${HOLD_OVERLAY.scaleInMs}ms`, HOLD_OVERLAY.scaleInMs === 150 && ov.includes('duration: HOLD_OVERLAY.scaleInMs'));
  ck('浮层不接收触摸(手势留在大条上)', /<View pointerEvents="none" style=\{styles\.holdWrap\}/.test(ov));
  ck('流式文字 ≤3 行,再多在气泡里滚到最新', HOLD_OVERLAY.interimMaxLines === 3 && ov.includes('maxHeight: HOLD_OVERLAY.interimLineHeight * HOLD_OVERLAY.interimMaxLines') && ov.includes('scrollToEnd'));
  ck('只在手机挂微信式浮层(holdOverlayOn);#463 的卡片在手机上被 hidden,只留给窄桌面窗口', chat.includes('{holdOverlayOn ? <VoiceHoldOverlay voice={voice} layout={holdLayout} /> : null}') && chat.includes("{voiceSurface(desktop) === 'phoneOverlay' ? <VoiceRecordingOverlay voice={voice} bottom={88 + composerInset} hidden={holdOverlayOn} /> : null}") && ui.includes("if (hidden || phase === 'idle') return null;") && chat.includes('const holdOverlayOn = holdOverlayApplies({ desktop, os: Platform.OS,') && chat.includes('const holdLayout = holdOverlayOn && paneWidth > 0'));
  ck('phone-only 门认得 holdOverlayOn、登记了 VoiceHoldOverlay', read('src', 'phone-only-registry.ts').includes("'holdOverlayOn',") && read('src', 'phone-only-registry.ts').includes('site: /<VoiceHoldOverlay\\b/,'));
  ck('VoiceHoldOverlay 只有一处挂载(在 holdOverlayOn 分支里)', (chat.match(/<VoiceHoldOverlay\b/g) ?? []).length === 1);
  ck('命中判定和浮层用同一份 layout(holdLayoutRef)', /zoneAt: \(pageX, pageY, prev\) => \{\s*const l = holdLayoutRef\.current;/.test(chat) && chat.includes('holdZoneAt({ x: pageX - rootOriginRef.current.x, y: pageY - rootOriginRef.current.y }, l, prev)'));
  ck('底部安全区走 ChatScreen 已有的 composerInset(不另读 insets)', chat.includes('holdOverlayLayout(paneWidth, rootHeight, composerInset, holdCoverTop)'));
  ck('面板盖过草稿卡片能长到的最高处', chat.includes('inputRowTop - (showVoiceDraftCard(voiceMode, draft) ? VOICE_DRAFT_CARD_BLOCK_MAX : 0)') && ui.includes('export const VOICE_DRAFT_CARD_BLOCK_MAX = spacing.xs + 8 * 2 + 2 + DRAFT_CARD_LINE_HEIGHT * VOICE_DRAFT_CARD_MAX_LINES;'));
  ck('按下大条时量根视图原点', /if \(source === 'holdBar'\) measureRootOrigin\(\);/.test(chat));
  ck('hook:有 zoneAt 且判得出区 → zone 事件,否则沿用 dy(桌面)', /if \(zone\) dispatch\(\{ type: 'zone', zone \}\);\s*else dispatch\(\{ type: 'move', dy:/.test(hook));
  ck('voiceSim 只在模块加载时按 Platform.OS 装一次', hook.includes('const VOICE_SIM = installVoiceSim(Platform.OS);'));
  const theme = read('src', 'theme.ts');
  ck('亮 / 暗主题都有气泡与弧形面板色(#609 气泡 = 强调色的 bubbleMine,不写色值)', (theme.match(/voiceBubble: ACCENT\.(light|dark)\.bubbleMine,/g) ?? []).length === 2 && (theme.match(/onVoiceBubble: ACCENT\.(light|dark)\.onBubbleMine,/g) ?? []).length === 2 && (theme.match(/voiceArc: '#/g) ?? []).length === 2);
}

console.log(`voice hold overlay: ${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);
