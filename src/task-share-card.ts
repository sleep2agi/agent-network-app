// 仪表盘的「生成分享图」:在 Canvas 2D 上画一张竖版卡片(1080×1920 朋友圈 / 小红书,或 1080×1350 X / Instagram),
// 导出真正的 PNG。设计稿:/tmp 里的 task-dashboard-design(owner 2026-09-30 通过),加「今天完成的任务」一块。
//
// 为什么是 Canvas 而不是截 RN 视图:桌面(Tauri WebView)和 web 上 Canvas 是现成的、输出像素尺寸精确可控;
// 截视图要么依赖 DOM → 图片的第三方库(字体 / 跨域图片都会出问题),要么是原生模块。原生手机端(没有 Canvas)
// 这一版不导出,界面上说明(TaskDashboard.tsx)。
//
// 分两层:shareCardLayout 纯函数排版(ck 测试量:各块不重叠、不出画布、标题行数随可用空间变),drawShareCard 照着画。
import type { DashPeriod } from './task-dashboard-model';

export type ShareSize = 'portrait' | 'feed';
export type ShareTheme = 'dark' | 'light';
export const SHARE_W = 1080;
export const SHARE_H: Record<ShareSize, number> = { portrait: 1920, feed: 1350 };

export interface ShareCardModel {
  period: DashPeriod;
  /** 右上角:「今日战报」+ 日期 / 范围。 */
  reportLabel: string;
  dateLabel: string;
  kicker: string;
  big: number;
  unit: string;
  /** 「其中 N 个由 Agent 完成」;null = 不写这半句。 */
  agentLine: string | null;
  kpis: { label: string; value: string }[];
  titlesHeading: string;
  /** 已按用户勾选过滤的标题(新 → 旧)。 */
  titles: string[];
  moreTitlesLabel: (n: number) => string;
  dailyHeading: string;
  dailyRight: string;
  daily: { label: string; n: number }[];
  heatHeading: string;
  heatRight: string;
  /** 每格 level 0–4,按 (col,row) 排好。 */
  heat: { row: number; col: number; level: number }[];
  topHeading: string;
  top: { name: string; sub: string }[];
  brand: string;
  brandSub: string;
  footer: string;
  link: string;
  approxNote: string | null;
}

export interface ShareOptions { size: ShareSize; theme: ShareTheme; showHeat: boolean; showTop: boolean }

export type Rect = { x: number; y: number; w: number; h: number };
export interface ShareLayout {
  W: number; H: number;
  header: Rect; kicker: Rect; big: Rect; unit: Rect; kpis: Rect;
  titles: Rect | null; titleRows: number; titleOverflow: number;
  daily: Rect; heat: Rect | null; top: Rect | null; footer: Rect;
  bigFont: number;
}

const PAD = 84;
const GAP = 24;
const TITLE_ROW = 54;
const TITLE_HEAD = 84; // 面板内边距 + 标题行
const MIN_TITLE_ROWS = 3;
export const MAX_TITLE_ROWS: Record<ShareSize, number> = { portrait: 8, feed: 5 };

/** 排版:固定块先排,可选块(热力图 / 完成榜)放得下才放,剩下的高度给「完成的任务」,最多 MAX_TITLE_ROWS 行。 */
export function shareCardLayout(size: ShareSize, opts: Pick<ShareOptions, 'showHeat' | 'showTop'>, titleCount: number): ShareLayout {
  const W = SHARE_W, H = SHARE_H[size];
  const portrait = size === 'portrait';
  const innerW = W - PAD * 2;
  let y = portrait ? 76 : 64;
  const header: Rect = { x: PAD, y, w: innerW, h: 92 };
  y += header.h + (portrait ? 32 : 28);
  const kicker: Rect = { x: PAD, y, w: innerW, h: 44 };
  y += kicker.h + 8;
  const bigFont = portrait ? 200 : 170;
  const big: Rect = { x: PAD, y, w: innerW, h: Math.round(bigFont * 0.92) };
  y += big.h + 12;
  const unit: Rect = { x: PAD, y, w: innerW, h: 56 };
  y += unit.h + (portrait ? 28 : 24);
  const kpis: Rect = { x: PAD, y, w: innerW, h: portrait ? 140 : 120 };
  y += kpis.h + GAP;
  const footer: Rect = { x: PAD, y: H - (portrait ? 56 : 48) - 64, w: innerW, h: 64 };
  const dailyH = portrait ? 250 : 200;
  const heatH = 180;
  const topH = 150;
  // 从下往上:页脚 ← 柱图 ← (完成榜)← (热力图);中间剩的给标题。
  let bottom = footer.y - GAP;
  const daily: Rect = { x: PAD, y: bottom - dailyH, w: innerW, h: dailyH };
  bottom = daily.y - GAP;
  const minTitles = titleCount ? TITLE_HEAD + TITLE_ROW * Math.min(MIN_TITLE_ROWS, titleCount) + GAP : 0;
  let top: Rect | null = null;
  let heat: Rect | null = null;
  if (portrait && opts.showTop && bottom - topH - GAP - y >= minTitles) { top = { x: PAD, y: bottom - topH, w: innerW, h: topH }; bottom = top.y - GAP; }
  if (portrait && opts.showHeat && bottom - heatH - GAP - y >= minTitles) { heat = { x: PAD, y: bottom - heatH, w: innerW, h: heatH }; bottom = heat.y - GAP; }
  let titles: Rect | null = null;
  let titleRows = 0;
  if (titleCount) {
    const room = bottom - y;
    titleRows = Math.max(0, Math.min(MAX_TITLE_ROWS[size], titleCount, Math.floor((room - TITLE_HEAD) / TITLE_ROW)));
    if (titleRows) titles = { x: PAD, y, w: innerW, h: TITLE_HEAD + TITLE_ROW * titleRows };
  }
  // 放不下全部时最后一行改写成「… 还有 N 个」(N = 没画出来的,含被这一行顶掉的那条)。
  const titleOverflow = titleRows ? Math.max(0, titleCount - titleRows) : 0;
  return { W, H, header, kicker, big, unit, kpis, titles, titleRows, titleOverflow, daily, heat, top, footer, bigFont };
}

// ── 画 ──

type Ctx = CanvasRenderingContext2D;
const FONT = '"PingFang SC","Hiragino Sans GB","Noto Sans SC","Noto Sans CJK SC","Microsoft YaHei",system-ui,sans-serif';
const font = (px: number, w: number | string = 400) => `${w} ${px}px ${FONT}`;

interface Palette { bg: string; glowA: string; glowB: string; grid: string; text: string; sub: string; panel: string; panelBorder: string; accent: string; accentB: string; accentBg: string; axis: string; heat: string[] }
const PALETTE: Record<ShareTheme, Palette> = {
  dark: {
    bg: '#070b18', glowA: 'rgba(45,224,192,0.28)', glowB: 'rgba(45,91,255,0.38)', grid: 'rgba(127,140,170,0.07)', text: '#f3f6fb', sub: 'rgba(243,246,251,0.62)',
    panel: 'rgba(255,255,255,0.06)', panelBorder: 'rgba(255,255,255,0.10)', accent: '#2de0c0', accentB: '#3b7bff', accentBg: 'rgba(45,224,192,0.16)', axis: 'rgba(255,255,255,0.10)',
    heat: ['rgba(255,255,255,0.07)', '#12404a', '#17707a', '#22a7a8', '#2de0c0'],
  },
  light: {
    bg: '#f7f9fc', glowA: 'rgba(45,224,192,0.22)', glowB: 'rgba(45,91,255,0.18)', grid: 'rgba(127,140,170,0.07)', text: '#101828', sub: 'rgba(16,24,40,0.58)',
    panel: 'rgba(255,255,255,0.88)', panelBorder: 'rgba(16,24,40,0.06)', accent: '#0d9488', accentB: '#1d4ed8', accentBg: 'rgba(13,148,136,0.12)', axis: 'rgba(16,24,40,0.08)',
    heat: ['#e8ecf2', '#b5e4dc', '#6cc9bb', '#23a594', '#0d8577'],
  },
};

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

function panel(ctx: Ctx, p: Palette, r: Rect, theme: ShareTheme) {
  ctx.save();
  if (theme === 'light') { ctx.shadowColor = 'rgba(16,24,40,0.06)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10; }
  roundRect(ctx, r.x, r.y, r.w, r.h, 28);
  ctx.fillStyle = p.panel;
  ctx.fill();
  ctx.restore();
  roundRect(ctx, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 28);
  ctx.strokeStyle = p.panelBorder;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function panelHead(ctx: Ctx, p: Palette, r: Rect, left: string, right: string) {
  ctx.textBaseline = 'alphabetic';
  ctx.font = font(26, 600);
  ctx.fillStyle = p.text;
  ctx.textAlign = 'left';
  ctx.fillText(left, r.x + 34, r.y + 58);
  if (right) {
    ctx.font = font(24);
    ctx.fillStyle = p.sub;
    ctx.textAlign = 'right';
    ctx.fillText(right, r.x + r.w - 34, r.y + 58);
    ctx.textAlign = 'left';
  }
}

/** 画整张卡。logo 可空(没加载到时画一个简化的三点标志)。 */
export function drawShareCard(ctx: Ctx, m: ShareCardModel, o: ShareOptions, logo: CanvasImageSource | null): ShareLayout {
  const L = shareCardLayout(o.size, o, m.titles.length);
  const p = PALETTE[o.theme];
  const { W, H } = L;
  // 底色 + 两团光 + 上半部的细网格
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = (x: number, y: number, r: number, c: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  };
  glow(W, -H * 0.05, 820, p.glowA);
  glow(-W * 0.1, H * 1.05, 900, p.glowB);
  ctx.strokeStyle = p.grid;
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 54) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H * 0.42); ctx.stroke(); }
  for (let y = 0; y <= H * 0.42; y += 54) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke(); }

  // 头:logo + 名字 | 战报 + 日期
  const hd = L.header;
  if (logo) {
    ctx.save(); roundRect(ctx, hd.x, hd.y, 92, 92, 22); ctx.clip(); ctx.drawImage(logo, hd.x - 8, hd.y - 8, 108, 108); ctx.restore();
  } else {
    roundRect(ctx, hd.x, hd.y, 92, 92, 22); ctx.fillStyle = '#0b1535'; ctx.fill();
    ctx.fillStyle = p.accent;
    for (const [cx, cy] of [[46, 26], [24, 66], [68, 66]] as const) { ctx.beginPath(); ctx.arc(hd.x + cx, hd.y + cy, 13, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = p.text;
  ctx.font = font(40, 700);
  ctx.fillText(m.brand, hd.x + 114, hd.y + 44);
  ctx.fillStyle = p.sub;
  ctx.font = font(24);
  ctx.fillText(m.brandSub, hd.x + 114, hd.y + 80);
  ctx.textAlign = 'right';
  ctx.fillStyle = p.text;
  ctx.font = font(30, 600);
  ctx.fillText(m.reportLabel, hd.x + hd.w, hd.y + 36);
  ctx.fillStyle = p.sub;
  ctx.font = font(24);
  ctx.fillText(m.dateLabel, hd.x + hd.w, hd.y + 74);
  ctx.textAlign = 'left';

  // 大数字(渐变)
  ctx.fillStyle = p.sub;
  ctx.font = font(34);
  ctx.fillText(m.kicker, L.kicker.x, L.kicker.y + 36);
  ctx.font = font(L.bigFont, 700);
  const bigText = String(m.big);
  const bigW = ctx.measureText(bigText).width;
  const grad = ctx.createLinearGradient(L.big.x, 0, L.big.x + Math.max(bigW, 200), 0);
  grad.addColorStop(0, p.accentB); grad.addColorStop(1, p.accent);
  ctx.fillStyle = grad;
  ctx.fillText(bigText, L.big.x - 6, L.big.y + L.big.h - 6);
  ctx.fillStyle = p.text;
  ctx.font = font(44, 600);
  ctx.fillText(m.unit, L.unit.x, L.unit.y + 44);
  if (m.agentLine) {
    const uw = ctx.measureText(m.unit + ' · ').width;
    ctx.fillStyle = p.accent;
    ctx.fillText(fitText(s => ctx.measureText(s).width, m.agentLine, L.unit.w - uw), L.unit.x + uw, L.unit.y + 44);
    ctx.fillStyle = p.text;
    ctx.fillText(' · ', L.unit.x + ctx.measureText(m.unit).width, L.unit.y + 44);
  }

  // 三块 KPI
  const kw = (L.kpis.w - 2 * GAP) / 3;
  m.kpis.slice(0, 3).forEach((k, i) => {
    const r = { x: L.kpis.x + i * (kw + GAP), y: L.kpis.y, w: kw, h: L.kpis.h };
    panel(ctx, p, r, o.theme);
    ctx.fillStyle = p.sub; ctx.font = font(24);
    ctx.fillText(k.label, r.x + 30, r.y + 46);
    ctx.fillStyle = p.text; ctx.font = font(o.size === 'portrait' ? 64 : 60, 700);
    ctx.fillText(fitText(s => ctx.measureText(s).width, k.value, r.w - 60), r.x + 30, r.y + r.h - 32);
  });

  // 完成的任务(标题)
  if (L.titles) {
    const r = L.titles;
    panel(ctx, p, r, o.theme);
    panelHead(ctx, p, r, m.titlesHeading, '');
    ctx.font = font(28);
    for (let i = 0; i < L.titleRows; i++) {
      const y = r.y + TITLE_HEAD + i * TITLE_ROW + 18;
      const last = i === L.titleRows - 1 && L.titleOverflow > 0;
      ctx.fillStyle = p.accent;
      ctx.beginPath(); ctx.arc(r.x + 44, y - 9, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = last ? p.sub : p.text;
      const text = last ? m.moreTitlesLabel(L.titleOverflow + 1) : m.titles[i];
      ctx.fillText(fitText(s => ctx.measureText(s).width, text, r.w - 100), r.x + 68, y);
    }
  }

  // 近 30 天柱图
  {
    const r = L.daily;
    panel(ctx, p, r, o.theme);
    panelHead(ctx, p, r, m.dailyHeading, m.dailyRight);
    const pl = 34 + 44, pr = 34, pt = 96, pb = 52;
    const cw = r.w - pl - pr, ch = r.h - pt - pb;
    const max = Math.max(10, Math.ceil(Math.max(...m.daily.map(d => d.n), 1) / 10) * 10);
    ctx.font = font(20); ctx.textAlign = 'right';
    for (let g = 0; g <= 2; g++) {
      const y = r.y + pt + ch - (ch * g) / 2;
      ctx.strokeStyle = p.axis; ctx.setLineDash(g ? [4, 6] : []); ctx.beginPath(); ctx.moveTo(r.x + pl, y + 0.5); ctx.lineTo(r.x + r.w - pr, y + 0.5); ctx.stroke();
      ctx.fillStyle = p.sub; ctx.fillText(String((max * g) / 2), r.x + pl - 10, y + 7);
    }
    ctx.setLineDash([]);
    const n = m.daily.length, bw = cw / Math.max(1, n);
    const barGrad = ctx.createLinearGradient(0, r.y + pt + ch, 0, r.y + pt);
    barGrad.addColorStop(0, p.accentB); barGrad.addColorStop(1, p.accent);
    m.daily.forEach((d, i) => {
      const h = d.n ? Math.max(4, (ch * d.n) / max) : 0;
      const x = r.x + pl + i * bw + bw * 0.18;
      if (h) { roundRect(ctx, x, r.y + pt + ch - h, bw * 0.64, h, Math.min(6, bw * 0.3)); ctx.fillStyle = i === n - 1 ? p.accent : barGrad; ctx.fill(); }
      if (i === n - 1 && d.n) { ctx.fillStyle = p.accent; ctx.font = font(22, 700); ctx.textAlign = 'center'; ctx.fillText(String(d.n), x + bw * 0.32, r.y + pt + ch - h - 10); }
      if (d.label) {
        ctx.fillStyle = p.sub; ctx.font = font(20);
        ctx.textAlign = i === n - 1 ? 'right' : 'center';
        ctx.fillText(d.label, i === n - 1 ? r.x + r.w - pr : x + bw * 0.32, r.y + r.h - 18);
      }
    });
    ctx.textAlign = 'left';
  }

  // 全年热力图
  if (L.heat) {
    const r = L.heat;
    panel(ctx, p, r, o.theme);
    panelHead(ctx, p, r, m.heatHeading, m.heatRight);
    const cols = Math.max(1, ...m.heat.map(c => c.col + 1));
    const cell = Math.min(14, (r.w - 68) / cols);
    const size = cell * 0.78;
    const x0 = r.x + (r.w - cols * cell) / 2, y0 = r.y + 78;
    for (const c of m.heat) {
      roundRect(ctx, x0 + c.col * cell, y0 + c.row * cell, size, size, 3);
      ctx.fillStyle = p.heat[c.level] ?? p.heat[0];
      ctx.fill();
    }
  }

  // 完成榜前三
  if (L.top) {
    const r = L.top;
    panel(ctx, p, r, o.theme);
    panelHead(ctx, p, r, m.topHeading, '');
    const cw = (r.w - 68) / 3;
    const medal = ['#e0b43a', '#aab4bf', '#c9864a'];
    m.top.slice(0, 3).forEach((t, i) => {
      const x = r.x + 34 + i * cw, y = r.y + 104;
      ctx.beginPath(); ctx.arc(x + 30, y, 30, 0, Math.PI * 2); ctx.fillStyle = medal[i]; ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.font = font(28, 700); ctx.textAlign = 'center'; ctx.fillText(String(i + 1), x + 30, y + 10); ctx.textAlign = 'left';
      ctx.fillStyle = p.text; ctx.font = font(26, 600);
      ctx.fillText(fitText(s => ctx.measureText(s).width, t.name, cw - 90), x + 76, y - 4);
      ctx.fillStyle = p.sub; ctx.font = font(22);
      ctx.fillText(fitText(s => ctx.measureText(s).width, t.sub, cw - 90), x + 76, y + 28);
    });
  }

  // 页脚
  {
    const r = L.footer;
    ctx.font = font(22);
    const linkW = ctx.measureText(m.link).width + 52;
    roundRect(ctx, r.x + r.w - linkW, r.y + 6, linkW, 52, 26);
    ctx.strokeStyle = p.sub; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = p.sub; ctx.textAlign = 'center';
    ctx.fillText(m.link, r.x + r.w - linkW / 2, r.y + 40);
    ctx.textAlign = 'left';
    ctx.font = font(24);
    ctx.fillText(fitText(s => ctx.measureText(s).width, m.footer, r.w - linkW - 24), r.x, r.y + 30);
    if (m.approxNote) { ctx.font = font(20); ctx.fillText(m.approxNote, r.x, r.y + 60); }
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
