// 手机「按住 说话」浮层(微信式)的几何与判定。纯逻辑,不 import react-native:
// VoiceHoldOverlay 用 holdOverlayLayout 摆位置,ChatScreen 用同一份 layout 做手指命中(zoneAt),
// 所以画出来的圈和判定的圈是同一组数,不会「看着在圈上、判定没进去」。
//
//   ┌──────────────────────────┐  全屏半透明黑
//   │      ┌──────────────┐    │
//   │      │ ▁▃▅▇▅▃▁  0:03 │    │  晴蓝气泡(#609,原微信绿)(电平条 + 秒数 + 流式中间结果,≤3 行后在气泡里滚)
//   │      │ 边说边出字……   │    │
//   │      └──────▼───────┘    │
//   │   (✕)              (文)   │  左上 ✕ = 取消,右上 文 = 转文字进草稿
//   │        松开 转文字         │  状态文案
//   │ ╭────────────────────────╮│
//   │ │         ((·))          ││  底部弧形大面板(盖住原来的「按住 说话」条)
//   └──────────────────────────┘
//
// 坐标系 = 浮层宿主(聊天页根视图)的本地坐标;宿主在窗口里的原点由 ChatScreen 量出来再减掉。

import { holdBarLabel, isLivePhase, zoneOfPhase, type VoicePhase, type VoiceZone } from './voice-input-model';
import { isAndroidLike } from './wide-layout';

export type Point = { x: number; y: number };

/**
 * 这个浮层只属于手机(安卓 / iOS,含安卓折叠屏双栏;网页导出 + 安卓 UA 用来模拟它)。桌面永远不画 ——
 * 包括窄到落回「phone」布局的桌面窗口(Tauri 桌面 < 860 宽,chooseAppLayout):那里沿用桌面自己的录音 UI。
 */
export function holdOverlayApplies(p: { desktop: boolean; os: string; userAgent?: string }): boolean {
  if (p.desktop) return false;
  return p.os === 'ios' || isAndroidLike(p.os, p.userAgent ?? '');
}

export type HoldOverlayLayout = {
  width: number;
  height: number;
  bottomInset: number;
  /** 弧形面板的顶点(中线处最高点)y;面板一直铺到宿主底部。 */
  arcTop: number;
  arcHeight: number;
  /** 画弧用的大圆直径(面板里只露出它的顶部一段)。 */
  arcDiameter: number;
  /** 面板左右边缘比顶点低多少(弧的矢高)。 */
  arcSag: number;
  /** 状态文案(「松开 转文字」)的中线 y。 */
  labelCenterY: number;
  /** ✕ / 文 两个圈的圆心。 */
  circleY: number;
  cancelX: number;
  textX: number;
  circleSize: number;
  circleSizeActive: number;
  /** 命中半径:进区用 hitEnter,已经在区里时用更大的 hitExit(滞回,手指抖一下不会进进出出)。 */
  hitEnter: number;
  hitExit: number;
  bubbleWidth: number;
  /** 气泡(含尾巴)的底边 y:气泡往上长,字多了底边不动。 */
  bubbleBottom: number;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const HOLD_OVERLAY = {
  circleSize: 64,
  circleSizeActive: 80,
  hitEnter: 56,
  hitExit: 76,
  bubbleTail: 8,
  /** 气泡里流式文字最多直接显示几行,再多在气泡里滚。 */
  interimMaxLines: 3,
  interimLineHeight: 22,
  bars: 21,
  /** 气泡出现:缩放 + 淡入的时长(reduce-motion 时为 0)。 */
  scaleInMs: 150,
  /** 「说话时间太短」提示停留多久。 */
  tooShortToastMs: 1200,
} as const;

/**
 * `coverTop`(可选):输入区最上沿(含语音草稿卡片能长到的最高处)。面板至少盖到它上面 8px ——
 * 否则草稿卡片(按住期间还会显示光标处预览,#440)会从面板上方露出来,压在状态文案和圈底下。
 */
export function holdOverlayLayout(width: number, height: number, bottomInset: number, coverTop?: number): HoldOverlayLayout {
  const inset = Math.max(0, bottomInset);
  const base = Math.round(clamp(height * 0.17, 116, 170)) + inset;
  const cover = coverTop !== undefined && Number.isFinite(coverTop) && coverTop > 0 ? height - coverTop + 8 : 0;
  // 不让面板吃掉半屏(横屏 / 分屏的矮窗):最多 45% 高。
  const arcHeight = Math.round(Math.min(Math.max(base, cover), Math.max(base, height * 0.45)));
  const arcTop = height - arcHeight;
  const arcDiameter = Math.round(width * 3);
  const r = arcDiameter / 2;
  const arcSag = r - Math.sqrt(r * r - (width / 2) * (width / 2));
  const labelCenterY = arcTop - 26;
  const circleY = labelCenterY - 24 - HOLD_OVERLAY.circleSizeActive / 2;
  const spread = Math.min(Math.round(width * 0.3), 150);
  const cx = width / 2;
  return {
    width,
    height,
    bottomInset: inset,
    arcTop,
    arcHeight,
    arcDiameter,
    arcSag,
    labelCenterY,
    circleY,
    cancelX: cx - spread,
    textX: cx + spread,
    circleSize: HOLD_OVERLAY.circleSize,
    circleSizeActive: HOLD_OVERLAY.circleSizeActive,
    hitEnter: HOLD_OVERLAY.hitEnter,
    hitExit: HOLD_OVERLAY.hitExit,
    bubbleWidth: Math.round(Math.min(width - 112, 300)),
    bubbleBottom: circleY - HOLD_OVERLAY.circleSizeActive / 2 - 36,
  };
}

/**
 * 手指在哪个区。滞回:已经在某个圈里时,离开要超过 hitExit(比 hitEnter 大 20px),
 * 边界上抖动不会反复进出(每次进出都有触感,抖起来会一直震)。两个圈相距很远,不会同时命中。
 */
export function zoneAt(pt: Point, layout: HoldOverlayLayout, prev: VoiceZone): VoiceZone {
  const within = (x: number, zone: VoiceZone) => Math.hypot(pt.x - x, pt.y - layout.circleY) <= (prev === zone ? layout.hitExit : layout.hitEnter);
  if (within(layout.cancelX, 'cancel')) return 'cancel';
  if (within(layout.textX, 'toText')) return 'toText';
  return 'neutral';
}

/** 状态文案(面板上方那一行)。中间区沿用「按住 说话」条的文案(不承诺「发送」,见 holdBarLabel)。 */
export function holdOverlayLabel(phase: VoicePhase): string {
  if (phase === 'cancelArmed') return '松开手指，取消';
  if (phase === 'toTextArmed') return '松开 放进草稿';
  if (phase === 'transcribing') return '正在识别…';
  return holdBarLabel(phase === 'idle' ? 'recording' : phase);
}

export type HoldOverlayTone = 'neutral' | 'cancel' | 'toText';

/** 气泡 / 圈 / 面板的配色档:只有手指所在的区决定。 */
export function holdOverlayTone(phase: VoicePhase): HoldOverlayTone {
  return isLivePhase(phase) ? zoneOfPhase(phase) : 'neutral';
}

/**
 * 波形:最近 n 次电平(0..1),新的在右边。电平约 10 次/秒到,条的高度在两次之间由原生动画补帧。
 */
export function pushLevel(history: readonly number[], level: number, n: number = HOLD_OVERLAY.bars): number[] {
  const v = Number.isFinite(level) ? clamp(level, 0, 1) : 0;
  const next = [...history, v];
  while (next.length < n) next.unshift(0);
  return next.slice(next.length - n);
}

/**
 * 一根条的高度比例(0..1):电平开根号拉开小声段(说话电平大多落在 0.05–0.3),
 * 再按离中间的距离微微收窄,保留一点底高表示「在录」。
 */
export function barScale(level: number, index: number, n: number = HOLD_OVERLAY.bars): number {
  const v = clamp(Number.isFinite(level) ? level : 0, 0, 1);
  const shape = 1 - 0.35 * Math.abs(index - (n - 1) / 2) / ((n - 1) / 2);
  return clamp(0.12 + 0.88 * Math.sqrt(v) * shape, 0.12, 1);
}
