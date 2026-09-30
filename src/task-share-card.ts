// 仪表盘的「生成分享图」:在 Canvas 2D 上画一张竖版卡片(1080×1920 朋友圈 / 小红书,或 1080×1350 X / Instagram),
// 导出真正的 PNG。手机原生端没有 Canvas,用 ShareCardNative.tsx 按同一份排版画 RN 视图再截图。
//
// 设计:方向 A「大字报」(owner 2026-09-30 看了 0.2.166 说「还是太丑了」,三个方向里选了 A)——
// 超大的期内完成数 +「其中 N 个由 Agent 完成，占 P%」→ 今天 / 单日最高 / 协作者 → 一长串完成的任务(带完成者)
// → 谁完成的(Agent / 成员占比条 + 前三)。一个色系(青绿),不再蓝青混用;不放完成率。
//
// 会显得「没干什么」的图只在数据够的时候出现(shareModules,规则见那里);4:5 只放标题。
//
// 分两层:shareCardLayout 纯函数排版(ck 测试量:各块不重叠、不出画布、左右边距相等、至少 8 行标题),
// drawShareCard / ShareCardNative 照着画。所有字的基线都在这里定,两边共用。
import type { DashPeriod } from './task-dashboard-model';

export type ShareSize = 'portrait' | 'feed';
export type ShareTheme = 'dark' | 'light';
export const SHARE_W = 1080;
export const SHARE_H: Record<ShareSize, number> = { portrait: 1920, feed: 1350 };

export interface ShareTitle { text: string; /** 完成者的显示名;不知道是谁 = null(不画)。 */ who: string | null }
export interface ShareStat { label: string; value: string; unit: string }
export interface ShareWho {
  heading: string; right: string;
  agentLabel: string; userLabel: string; agent: number; user: number;
  top: { name: string; sub: string }[];
}

export interface ShareCardModel {
  period: DashPeriod;
  /** 右上角:「本周战报」+ 日期 / 范围。 */
  reportLabel: string;
  dateLabel: string;
  kicker: string;
  big: number;
  unit: string;
  /** 「其中 N 个由 Agent 完成，占 P%」;null = 不写。 */
  agentLine: string | null;
  stats: ShareStat[];
  titlesHeading: string;
  titlesRight: string;
  /** 已按用户勾选过滤的标题(新 → 旧)。 */
  titles: ShareTitle[];
  /** 期内完成总数(「… 还有 N 个」按它算,不按最多 20 条的 recent 算)。 */
  total: number;
  moreTitlesLabel: (n: number) => string;
  /** 近 30 天 / 近 7 天柱图;null = 数据太少,不画(shareModules)。 */
  chart: { heading: string; right: string; bars: { n: number; label: string }[] } | null;
  /** 贡献热力图(只画有数据以来的那几周);null = 历史不到 30 天,不画。 */
  heat: { heading: string; right: string; cells: { row: number; col: number; level: number }[] } | null;
  /** 谁完成的;null = 没有人上榜。 */
  who: ShareWho | null;
  brand: string;
  brandSub: string;
  footer: string;
  link: string;
  approxNote: string | null;
}

export interface ShareOptions { size: ShareSize; theme: ShareTheme; showHeat: boolean; showTop: boolean }

// ── 哪些块出现(按数据量,不看运气) ──

/** 近 30 天里有完成的天数 ≥ 7 才画 30 天柱图。 */
export const CHART30_MIN_ACTIVE = 7;
/** 否则近 7 天里有完成的天数 ≥ 5 才画 7 天柱图。 */
export const CHART7_MIN_ACTIVE = 5;
/** 最早一次完成距今 ≥ 30 天才画热力图,且只画那以来的周数。 */
export const HEAT_MIN_SPAN = 30;
export const HEAT_MAX_WEEKS = 53;

export interface ShareModules { chart: '30d' | '7d' | null; heatWeeks: number | null; active30: number; active7: number; span: number }

/** daily:按日期升序、最后一天 = 今天(DashData.daily)。 */
export function shareModules(daily: readonly { n: number }[]): ShareModules {
  const active = (k: number) => daily.slice(-k).filter(d => d.n > 0).length;
  const active30 = active(30), active7 = active(7);
  const first = daily.findIndex(d => d.n > 0);
  const span = first < 0 ? 0 : daily.length - 1 - first;
  return {
    chart: active30 >= CHART30_MIN_ACTIVE ? '30d' : active7 >= CHART7_MIN_ACTIVE ? '7d' : null,
    heatWeeks: first >= 0 && span >= HEAT_MIN_SPAN ? Math.min(HEAT_MAX_WEEKS, Math.ceil((span + 1) / 7)) : null,
    active30, active7, span,
  };
}

// ── 排版 ──

export type Rect = { x: number; y: number; w: number; h: number };
export interface ShareLayout {
  W: number; H: number; portrait: boolean;
  header: Rect; kicker: Rect; big: Rect; agent: Rect | null; stats: Rect;
  titles: Rect | null; rowH: number; titleRows: number; titlesShown: number; moreCount: number;
  chart: Rect | null; heat: Rect | null; who: Rect | null; whoFull: boolean; footer: Rect;
  bigFont: number;
}

export const PAD = 72;
export const GAP = 24;
export const TITLE_HEAD = 80;
export const TITLE_PAD = 14;
/** 标题至少画这么多行(数据不够时画全部);可选块放得下才放。 */
export const MIN_TITLE_ROWS = 8;
export const ROW_H: Record<ShareSize, number> = { portrait: 58, feed: 52 };
export const WHO_FULL_H = 272;
export const WHO_COMPACT_H = 118;
export const CHART_H: Record<ShareSize, number> = { portrait: 210, feed: 170 };
export const HEAT_H = 180;
export const BOTTOM = 64;

/** 布局需要知道的内容量。 */
export interface ShareSpec { titles: number; total: number; chart: boolean; heat: boolean; who: boolean; approx: boolean }

export const specOf = (m: ShareCardModel, o: Pick<ShareOptions, 'size' | 'showHeat' | 'showTop'>): ShareSpec => ({
  titles: m.titles.length, total: Math.max(m.total, m.titles.length), chart: !!m.chart,
  heat: !!m.heat && o.showHeat && o.size === 'portrait', who: !!m.who && o.showTop, approx: !!m.approxNote,
});

/** 从上往下排固定块;从下往上排页脚 ← 谁完成的 ← 柱图 ← 热力图;中间给标题(至少 MIN_TITLE_ROWS 行)。
 *  可选块按 柱图 → 谁完成的(放不下整块就只放占比条)→ 热力图 的顺序,放得下才放。 */
export function shareCardLayout(size: ShareSize, spec: ShareSpec): ShareLayout {
  const W = SHARE_W, H = SHARE_H[size];
  const P = size === 'portrait';
  const innerW = W - PAD * 2;
  const R = (y: number, h: number): Rect => ({ x: PAD, y, w: innerW, h });
  let y = P ? 80 : 64;
  const header = R(y, 88);
  y += 88 + (P ? 52 : 36);
  const kicker = R(y, P ? 48 : 40);
  y += kicker.h + 4;
  const bigFont = P ? 250 : 190;
  const big = R(y, Math.round(bigFont * 0.78));
  y += big.h + (P ? 22 : 14);
  let agent: Rect | null = null;
  // agentLine 由模型决定有没有;排版总留出这一行,保证有没有这一行时下面各块位置一样(预览切换不跳)。
  agent = R(y, P ? 52 : 44);
  y += agent.h + (P ? 40 : 28);
  const stats = R(y, P ? 150 : 126);
  y += stats.h + GAP;

  const footerH = spec.approx ? 60 : 32;
  const footer = R(H - BOTTOM - footerH, footerH);
  let bottom = footer.y - (P ? 32 : 26);

  const rowH = ROW_H[size];
  const want = spec.titles + (spec.total > spec.titles ? 1 : 0);
  const minRows = Math.min(MIN_TITLE_ROWS, want);
  const need = (rows: number) => (rows ? TITLE_HEAD + rows * rowH + TITLE_PAD + GAP : 0);
  const fits = (h: number) => bottom - h - GAP - y >= need(minRows);
  const take = (h: number): Rect => { const r = R(bottom - h, h); bottom = r.y - GAP; return r; };

  let chart: Rect | null = null, who: Rect | null = null, heat: Rect | null = null, whoFull = false;
  if (spec.chart && fits(CHART_H[size])) chart = take(CHART_H[size]);
  // 画的顺序是从下往上,但柱图要在「谁完成的」上面:先占位,最后按顺序摆。
  if (spec.who) {
    if (P && fits(WHO_FULL_H)) { who = take(WHO_FULL_H); whoFull = true; }
    else if (fits(WHO_COMPACT_H)) who = take(WHO_COMPACT_H);
  }
  if (spec.heat && P && fits(HEAT_H)) heat = take(HEAT_H);
  // 从下往上的实际顺序:页脚 ← 谁完成的 ← 柱图 ← 热力图。
  let cursor = footer.y - (P ? 32 : 26);
  for (const r of [who, chart, heat]) if (r) { r.y = cursor - r.h; cursor = r.y - GAP; }
  bottom = cursor;

  let titles: Rect | null = null, titleRows = 0, titlesShown = 0, moreCount = 0;
  if (want) {
    titleRows = Math.max(0, Math.min(want, Math.floor((bottom - y - TITLE_HEAD - TITLE_PAD) / rowH)));
    if (titleRows) {
      titles = R(y, TITLE_HEAD + titleRows * rowH + TITLE_PAD);
      // 放得下全部:标题都画,多出的数(期内总数 − 标题数)进最后一行;放不下:最后一行改写成「… 还有 N 个」。
      titlesShown = titleRows >= want ? spec.titles : titleRows - 1;
      moreCount = Math.max(0, spec.total - titlesShown);
    }
  }
  return { W, H, portrait: P, header, kicker, big, agent, stats, titles, rowH, titleRows, titlesShown, moreCount, chart, heat, who, whoFull, footer, bigFont };
}

// ── 字的位置(两边共用):每段字给出基线 y 和字号,RN 版由基线换算 top ──

export const FONT_STACK = '"PingFang SC","Hiragino Sans GB","Noto Sans SC","Noto Sans CJK SC","Microsoft YaHei",system-ui,sans-serif';
/** 行高 1.4 时 Noto Sans CJK 的基线离行框顶的距离(× 字号)。RN 版用它把「基线 y」换成 top。 */
export const BASELINE_AT = 1.136;
export const LINE = 1.4;

export const TYPE = {
  brand: 38, brandSub: 23, report: 24, date: 23,
  kicker: { portrait: 34, feed: 30 }, unit: { portrait: 50, feed: 42 }, agent: { portrait: 38, feed: 32 },
  statLabel: 23, statValue: { portrait: 64, feed: 54 }, statUnit: 22,
  head: 27, headRight: 22, title: { portrait: 28, feed: 26 }, titleWho: { portrait: 21, feed: 20 },
  whoLabel: 23, leaderName: 27, leaderSub: 21, axis: 20, footer: 22, note: 20,
} as const;

export const TITLE_ICON = 26;
export const WHO_MAX_W = 200;

export interface Palette { bg: string; glow: string; text: string; sub: string; faint: string; panel: string; line: string; accent: string; strong: string; soft: string; heat: string[] }
// 一个色系:青绿。
export const PALETTE: Record<ShareTheme, Palette> = {
  light: {
    bg: '#f2f6f5', glow: 'rgba(15,148,134,0.14)', text: '#0b1f1c', sub: 'rgba(11,31,28,0.58)', faint: 'rgba(11,31,28,0.42)',
    panel: '#ffffff', line: 'rgba(11,31,28,0.08)', accent: '#0f9486', strong: '#0a6f65', soft: '#dcf1ed',
    heat: ['#e6eeec', '#bfe6df', '#7fd0c2', '#2fae9c', '#0a6f65'],
  },
  dark: {
    bg: '#061210', glow: 'rgba(52,217,189,0.16)', text: '#eefaf7', sub: 'rgba(238,250,247,0.62)', faint: 'rgba(238,250,247,0.42)',
    panel: '#0f1d1a', line: 'rgba(255,255,255,0.08)', accent: '#34d9bd', strong: '#8af2de', soft: 'rgba(52,217,189,0.16)',
    heat: ['rgba(255,255,255,0.07)', '#12403a', '#17705f', '#22a88f', '#34d9bd'],
  },
};

// ── 画 ──

type Ctx = CanvasRenderingContext2D;
const font = (px: number, w: number | string = 400) => `${w} ${px}px ${FONT_STACK}`;

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 一行放不下就截断加「…」(按实测宽度,中英文混排都对)。 */
export function fitText(measure: (s: string) => number, text: string, maxW: number): string {
  if (measure(text) <= maxW) return text;
  const chars = [...text];
  let lo = 0, hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(chars.slice(0, mid).join('') + '…') <= maxW) lo = mid; else hi = mid - 1;
  }
  return chars.slice(0, lo).join('') + '…';
}

export const PANEL_R = 28;

function panel(ctx: Ctx, p: Palette, r: Rect, theme: ShareTheme) {
  ctx.save();
  if (theme === 'light') { ctx.shadowColor = 'rgba(11,31,28,0.05)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 8; }
  roundRect(ctx, r.x, r.y, r.w, r.h, PANEL_R);
  ctx.fillStyle = p.panel;
  ctx.fill();
  ctx.restore();
  roundRect(ctx, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, PANEL_R);
  ctx.strokeStyle = p.line;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** 面板标题(左)+ 右侧说明,基线 = 面板顶 + 58。 */
export const HEAD_BASE = 58;
export const PANEL_X = 36;

function panelHead(ctx: Ctx, p: Palette, r: Rect, left: string, right: string) {
  ctx.textAlign = 'left';
  ctx.font = font(TYPE.head, 700);
  ctx.fillStyle = p.text;
  ctx.fillText(left, r.x + PANEL_X, r.y + HEAD_BASE);
  if (right) {
    ctx.font = font(TYPE.headRight);
    ctx.fillStyle = p.sub;
    ctx.textAlign = 'right';
    ctx.fillText(right, r.x + r.w - PANEL_X, r.y + HEAD_BASE);
    ctx.textAlign = 'left';
  }
}

/** 分享图各段的几何(Canvas 与 RN 共用的派生值)。 */
export function statColumns(L: ShareLayout): Rect[] {
  const w = L.stats.w / 3;
  return [0, 1, 2].map(i => ({ x: L.stats.x + i * w, y: L.stats.y, w, h: L.stats.h }));
}
export const statBase = (L: ShareLayout) => ({ label: L.stats.y + (L.portrait ? 56 : 48), value: L.stats.y + L.stats.h - (L.portrait ? 34 : 28) });
export const titleRowTop = (L: ShareLayout, i: number) => L.titles!.y + TITLE_HEAD + i * L.rowH;
export const titleBase = (L: ShareLayout, i: number, size: number) => titleRowTop(L, i) + L.rowH / 2 + size * 0.36;
export const whoGeom = (L: ShareLayout) => {
  const r = L.who!;
  const barY = r.y + (L.whoFull ? 84 : 30);
  const barH = L.whoFull ? 22 : 18;
  return { barY, barH, labelBase: barY + barH + 38, leaderCy: r.y + 212, colW: (r.w - PANEL_X * 2 - 2 * 20) / 3 };
};
export const chartGeom = (L: ShareLayout) => {
  const r = L.chart!;
  return { top: r.y + 86, bottom: r.y + r.h - 44, labelBase: r.y + r.h - 14, left: r.x + PANEL_X, right: r.x + r.w - PANEL_X };
};
export const heatGeom = (L: ShareLayout, cols: number) => {
  const r = L.heat!;
  const cell = Math.min(14, (r.w - PANEL_X * 2) / Math.max(1, cols));
  return { cell, size: cell * 0.78, x0: r.x + (r.w - cols * cell) / 2, y0: r.y + 78 };
};
export const footerBase = (L: ShareLayout) => ({ line: L.footer.y + 24, note: L.footer.y + 52 });

/** 画整张卡。logo 可空(没加载到时画一个简化的三点标志)。 */
export function drawShareCard(ctx: Ctx, m: ShareCardModel, o: ShareOptions, logo: CanvasImageSource | null): ShareLayout {
  const L = shareCardLayout(o.size, specOf(m, o));
  const p = PALETTE[o.theme];
  const P = L.portrait;
  const { W, H } = L;
  const measure = (s: string) => ctx.measureText(s).width;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W, -H * 0.03, 0, W, -H * 0.03, 900);
  g.addColorStop(0, p.glow); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // 头:logo + 名字 | 战报胶囊 + 日期
  const hd = L.header;
  if (logo) {
    ctx.save(); roundRect(ctx, hd.x, hd.y, 88, 88, 22); ctx.clip(); ctx.drawImage(logo, hd.x - 8, hd.y - 8, 104, 104); ctx.restore();
  } else {
    roundRect(ctx, hd.x, hd.y, 88, 88, 22); ctx.fillStyle = '#0b1535'; ctx.fill();
    ctx.fillStyle = p.accent;
    for (const [cx, cy] of [[44, 25], [23, 63], [65, 63]] as const) { ctx.beginPath(); ctx.arc(hd.x + cx, hd.y + cy, 12, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = p.text; ctx.font = font(TYPE.brand, 700);
  ctx.fillText(m.brand, hd.x + 110, hd.y + 44);
  ctx.fillStyle = p.sub; ctx.font = font(TYPE.brandSub);
  ctx.fillText(m.brandSub, hd.x + 110, hd.y + 78);
  ctx.font = font(TYPE.report, 700);
  const pillW = measure(m.reportLabel) + 36;
  roundRect(ctx, hd.x + hd.w - pillW, hd.y + 4, pillW, 40, 20); ctx.fillStyle = p.soft; ctx.fill();
  ctx.fillStyle = p.strong; ctx.textAlign = 'center';
  ctx.fillText(m.reportLabel, hd.x + hd.w - pillW / 2, hd.y + 33);
  ctx.textAlign = 'right'; ctx.fillStyle = p.sub; ctx.font = font(TYPE.date);
  ctx.fillText(m.dateLabel, hd.x + hd.w, hd.y + 80);
  ctx.textAlign = 'left';

  // 引子 + 大数字(竖向渐变,同一色系)+ 单位 + Agent 那句
  ctx.fillStyle = p.sub; ctx.font = font(TYPE.kicker[o.size]);
  ctx.fillText(fitText(measure, m.kicker, L.kicker.w), L.kicker.x, L.kicker.y + L.kicker.h - 12);
  ctx.font = font(L.bigFont, 800);
  const spacing = 'letterSpacing' in ctx;
  if (spacing) (ctx as any).letterSpacing = `${-Math.round(L.bigFont * 0.03)}px`;
  const bigText = String(m.big);
  const bigW = measure(bigText);
  const grad = ctx.createLinearGradient(0, L.big.y, 0, L.big.y + L.big.h);
  grad.addColorStop(0, p.accent); grad.addColorStop(1, p.strong);
  ctx.fillStyle = grad;
  ctx.fillText(bigText, L.big.x, L.big.y + L.big.h);
  if (spacing) (ctx as any).letterSpacing = '0px';
  ctx.fillStyle = p.text; ctx.font = font(TYPE.unit[o.size], 700);
  ctx.fillText(m.unit, L.big.x + bigW + 16, L.big.y + L.big.h);
  if (m.agentLine && L.agent) {
    ctx.fillStyle = p.accent; ctx.font = font(TYPE.agent[o.size], 700);
    ctx.fillText(fitText(measure, m.agentLine, L.agent.w), L.agent.x, L.agent.y + L.agent.h - 12);
  }

  // 三格数
  panel(ctx, p, L.stats, o.theme);
  const sb = statBase(L);
  statColumns(L).forEach((col, i) => {
    const s = m.stats[i];
    if (!s) return;
    if (i) { ctx.fillStyle = p.line; ctx.fillRect(col.x, col.y + 28, 1, col.h - 56); }
    const x = col.x + 34, maxW = col.w - 68;
    ctx.fillStyle = p.sub; ctx.font = font(TYPE.statLabel);
    ctx.fillText(fitText(measure, s.label, maxW), x, sb.label);
    ctx.fillStyle = p.text; ctx.font = font(TYPE.statValue[o.size], 800);
    const v = fitText(measure, s.value, maxW);
    ctx.fillText(v, x, sb.value);
    const vw = measure(v);
    if (s.unit) {
      ctx.fillStyle = p.sub; ctx.font = font(TYPE.statUnit);
      const room = maxW - vw - 8;
      if (room > 20) ctx.fillText(fitText(measure, s.unit, room), x + vw + 8, sb.value);
    }
  });

  // 完成的任务
  if (L.titles) {
    const r = L.titles;
    panel(ctx, p, r, o.theme);
    panelHead(ctx, p, r, m.titlesHeading, m.titlesRight);
    const size = TYPE.title[o.size], whoSize = TYPE.titleWho[o.size];
    for (let i = 0; i < L.titleRows; i++) {
      const top = titleRowTop(L, i);
      ctx.fillStyle = p.line; ctx.fillRect(r.x + PANEL_X, top, r.w - PANEL_X * 2, 1);
      const cy = top + L.rowH / 2, cx = r.x + PANEL_X + TITLE_ICON / 2;
      ctx.beginPath(); ctx.arc(cx, cy, TITLE_ICON / 2, 0, Math.PI * 2); ctx.fillStyle = p.soft; ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx - 5.5, cy + 0.5); ctx.lineTo(cx - 1.9, cy + 3.9); ctx.lineTo(cx + 5.5, cy - 3.9);
      ctx.strokeStyle = p.accent; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
      const more = i >= L.titlesShown;
      const t = more ? null : m.titles[i];
      const textX = r.x + PANEL_X + TITLE_ICON + 18;
      let right = r.x + r.w - PANEL_X;
      if (t?.who) {
        ctx.font = font(whoSize); ctx.fillStyle = p.sub; ctx.textAlign = 'right';
        const w = fitText(measure, t.who, WHO_MAX_W);
        ctx.fillText(w, right, titleBase(L, i, whoSize));
        ctx.textAlign = 'left';
        right -= measure(w) + 24;
      }
      ctx.font = font(size); ctx.fillStyle = more ? p.sub : p.text;
      const text = more ? m.moreTitlesLabel(L.moreCount) : t!.text;
      ctx.fillText(fitText(measure, text, right - textX), textX, titleBase(L, i, size));
    }
  }

  // 柱图
  if (L.chart && m.chart) {
    const r = L.chart, cg = chartGeom(L), c = m.chart;
    panel(ctx, p, r, o.theme);
    panelHead(ctx, p, r, c.heading, c.right);
    const n = c.bars.length, bw = (cg.right - cg.left) / Math.max(1, n);
    const max = Math.max(1, ...c.bars.map(b => b.n));
    c.bars.forEach((b, i) => {
      const x = cg.left + i * bw + bw * 0.18, w = bw * 0.64;
      const h = b.n ? Math.max(6, ((cg.bottom - cg.top) * b.n) / max) : 3;
      roundRect(ctx, x, cg.bottom - h, w, h, Math.min(6, w / 2));
      ctx.globalAlpha = b.n ? (i === n - 1 ? 1 : 0.55) : 1;
      ctx.fillStyle = b.n ? p.accent : p.line; ctx.fill();
      ctx.globalAlpha = 1;
      if (b.label) {
        ctx.fillStyle = p.sub; ctx.font = font(TYPE.axis);
        ctx.textAlign = i === n - 1 ? 'right' : i === 0 ? 'left' : 'center';
        ctx.fillText(b.label, i === n - 1 ? cg.right : i === 0 ? cg.left : x + w / 2, cg.labelBase);
        ctx.textAlign = 'left';
      }
    });
  }

  // 热力图
  if (L.heat && m.heat) {
    const r = L.heat;
    panel(ctx, p, r, o.theme);
    panelHead(ctx, p, r, m.heat.heading, m.heat.right);
    const cols = Math.max(1, ...m.heat.cells.map(c => c.col + 1));
    const hg = heatGeom(L, cols);
    for (const c of m.heat.cells) {
      roundRect(ctx, hg.x0 + c.col * hg.cell, hg.y0 + c.row * hg.cell, hg.size, hg.size, 3);
      ctx.fillStyle = p.heat[c.level] ?? p.heat[0];
      ctx.fill();
    }
  }

  // 谁完成的
  if (L.who && m.who) {
    const r = L.who, wg = whoGeom(L), w = m.who;
    panel(ctx, p, r, o.theme);
    if (L.whoFull) panelHead(ctx, p, r, w.heading, w.right);
    const bx = r.x + PANEL_X, bw = r.w - PANEL_X * 2, total = Math.max(1, w.agent + w.user);
    const aw = w.user ? Math.max(wg.barH, (bw - 4) * (w.agent / total)) : bw;
    roundRect(ctx, bx, wg.barY, aw, wg.barH, wg.barH / 2); ctx.fillStyle = p.accent; ctx.fill();
    if (w.user) { roundRect(ctx, bx + aw + 4, wg.barY, bw - aw - 4, wg.barH, wg.barH / 2); ctx.fillStyle = p.soft; ctx.fill(); }
    ctx.font = font(TYPE.whoLabel, 700); ctx.fillStyle = p.text;
    ctx.fillText(w.agentLabel, bx, wg.labelBase);
    ctx.textAlign = 'right';
    ctx.fillText(w.userLabel, bx + bw, wg.labelBase);
    ctx.textAlign = 'left';
    if (L.whoFull) {
      w.top.slice(0, 3).forEach((t, i) => {
        const x = bx + i * (wg.colW + 20);
        ctx.beginPath(); ctx.arc(x + 28, wg.leaderCy, 28, 0, Math.PI * 2); ctx.fillStyle = i === 0 ? p.accent : p.soft; ctx.fill();
        ctx.fillStyle = i === 0 ? '#ffffff' : p.strong; ctx.font = font(26, 700); ctx.textAlign = 'center';
        ctx.fillText(String(i + 1), x + 28, wg.leaderCy + 9); ctx.textAlign = 'left';
        ctx.fillStyle = p.text; ctx.font = font(TYPE.leaderName, 700);
        ctx.fillText(fitText(measure, t.name, wg.colW - 72), x + 72, wg.leaderCy - 6);
        ctx.fillStyle = p.sub; ctx.font = font(TYPE.leaderSub);
        ctx.fillText(fitText(measure, t.sub, wg.colW - 72), x + 72, wg.leaderCy + 26);
      });
    }
  }

  // 页脚:一行灰字 + 仓库链接(不再是胶囊)
  {
    const r = L.footer, fb = footerBase(L);
    ctx.font = font(TYPE.footer, 500); ctx.fillStyle = p.sub; ctx.textAlign = 'right';
    ctx.fillText(m.link, r.x + r.w, fb.line);
    const linkW = measure(m.link);
    ctx.textAlign = 'left'; ctx.font = font(TYPE.footer); ctx.fillStyle = p.faint;
    ctx.fillText(fitText(measure, m.footer, r.w - linkW - 24), r.x, fb.line);
    if (m.approxNote) { ctx.font = font(TYPE.note); ctx.fillText(fitText(measure, m.approxNote, r.w), r.x, fb.note); }
  }
  return L;
}

/** 画到一张新的 canvas 上并编码成 PNG(web / 桌面)。 */
export async function renderShareCardPng(m: ShareCardModel, o: ShareOptions, logoUri: string | null): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = SHARE_W;
  canvas.height = SHARE_H[o.size];
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');
  const logo = logoUri ? await loadImage(logoUri).catch(() => null) : null;
  drawShareCard(ctx, m, o, logo);
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png'));
}

function loadImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('logo failed to load'));
    img.src = uri;
  });
}

/** 文件名:agent-network-<期>-<日期>-<尺寸>.png(不带用户名 / 网络名)。 */
export const shareFileName = (period: DashPeriod, date: string, size: ShareSize) => `agent-network-${period}-${date}-${size === 'portrait' ? '1080x1920' : '1080x1350'}.png`;
