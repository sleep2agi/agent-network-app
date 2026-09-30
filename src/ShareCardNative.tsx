// 分享图的 RN 版:和 task-share-card.ts 的 Canvas 版同一份排版(shareCardLayout)、同一套颜色、同一份内容
// (ShareCardModel)、同一组字号和基线,只是用 View / Text 画。手机原生端没有 Canvas —— 生成分享图时显示的就是它,
// 点「分享图片」时 share-card-capture.ts 用 react-native-view-shot 把它按 1080 宽截成 PNG。
//
// scale:1 = 1080 逻辑像素宽;预览时按容器缩小(所有尺寸乘 scale,不用 transform,文字排版随之缩放)。
// 字的位置:Canvas 版给的是基线 y;这里行高固定 1.4 倍,top = 基线 − BASELINE_AT × 字号(Noto Sans CJK 的度量)。
// 与 Canvas 版的已知差别:大数字是纯色(RN 没有文字渐变),背景没有右上角那团光;粗体是 weight.strong(600),
// Canvas 版是 700 / 800(界面字重门 theme-minimal.test.ts 不许在 tsx 里写 700+)。
// 字一律 fixedSize:这是一张图,界面密度 / 系统字号不该把它撑变形。
import { Image, Platform, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { radius, weight } from './theme';
import {
  BASELINE_AT, FONT_STACK, LINE, PALETTE, PANEL_X, HEAD_BASE, SHARE_H, SHARE_W, TITLE_ICON, TYPE, WHO_MAX_W,
  chartGeom, footerBase, heatGeom, shareCardLayout, specOf, statBase, statColumns, titleRowTop, whoGeom,
  type Rect, type ShareCardModel, type ShareOptions,
} from './task-share-card';

/** 行高 = 1 倍字号时 Noto Sans CJK 的基线位置(× 字号),大数字用。 */
const BIG_BASE = 0.936;
/** web 上(布局测试、桌面预览)用与 Canvas 版同一组字体;原生端用系统字体(一个 CSS 字体栈在原生上不是合法的 fontFamily)。 */
const FAMILY = Platform.OS === 'web' ? { fontFamily: FONT_STACK } : null;

export default function ShareCardNative({ model: m, opts: o, scale, testID }: { model: ShareCardModel; opts: ShareOptions; scale: number; testID?: string }) {
  const L = shareCardLayout(o.size, specOf(m, o));
  const p = PALETTE[o.theme];
  const u = (n: number) => n * scale;
  const abs = (r: Rect) => ({ position: 'absolute' as const, left: u(r.x), top: u(r.y), width: u(r.w), height: u(r.h) });
  const panel = (r: Rect) => ({ ...abs(r), backgroundColor: p.panel, borderColor: p.line, borderWidth: 1, borderRadius: u(28) });
  const font = (size: number, color: string, bold = false) => ({ ...FAMILY, fontSize: u(size), lineHeight: u(size * LINE), color, fontWeight: bold ? weight.strong : weight.regular });
  /** 一行字:左边 x、基线 y、最大宽 w;align=right 时 x 是右边。坐标相对 origin(面板)。 */
  const line = (text: string, x: number, base: number, size: number, color: string, opt: { w: number; bold?: boolean; right?: boolean; origin?: Rect; testID?: string }) => {
    const ox = opt.origin?.x ?? 0, oy = opt.origin?.y ?? 0;
    return (
      <Text fixedSize numberOfLines={1} testID={opt.testID}
        style={[font(size, color, opt.bold), { position: 'absolute', top: u(base - oy - BASELINE_AT * size), width: u(opt.w), left: u((opt.right ? x - opt.w : x) - ox), textAlign: opt.right ? 'right' : 'left' }]}>
        {text}
      </Text>
    );
  };
  const head = (r: Rect, left: string, right: string) => (
    <>
      {line(left, r.x + PANEL_X, r.y + HEAD_BASE, TYPE.head, p.text, { w: (r.w - PANEL_X * 2) * 0.6, bold: true, origin: r })}
      {right ? line(right, r.x + r.w - PANEL_X, r.y + HEAD_BASE, TYPE.headRight, p.sub, { w: (r.w - PANEL_X * 2) * 0.4, right: true, origin: r }) : null}
    </>
  );
  const hd = L.header;
  const sb = statBase(L);
  const titleSize = TYPE.title[o.size], whoSize = TYPE.titleWho[o.size];
  const heatCols = m.heat ? Math.max(1, ...m.heat.cells.map(c => c.col + 1)) : 1;
  return (
    <View style={{ width: u(SHARE_W), height: u(SHARE_H[o.size]), backgroundColor: p.bg, overflow: 'hidden' }} testID={testID}>
      {/* 头 */}
      <Image source={require('../assets/icon-ios.png')} style={{ position: 'absolute', left: u(hd.x), top: u(hd.y), width: u(88), height: u(88), borderRadius: u(22) }} />
      {line(m.brand, hd.x + 110, hd.y + 44, TYPE.brand, p.text, { w: 420, bold: true })}
      {line(m.brandSub, hd.x + 110, hd.y + 78, TYPE.brandSub, p.sub, { w: 420 })}
      <View style={{ position: 'absolute', right: u(SHARE_W - hd.x - hd.w), top: u(hd.y + 4), height: u(40), paddingHorizontal: u(18), borderRadius: radius.pill, backgroundColor: p.soft, justifyContent: 'center' }}>
        <Text fixedSize numberOfLines={1} style={[font(TYPE.report, p.strong, true), { lineHeight: u(40) }]}>{m.reportLabel}</Text>
      </View>
      {line(m.dateLabel, hd.x + hd.w, hd.y + 80, TYPE.date, p.sub, { w: 360, right: true })}

      {/* 引子 + 大数字 + 单位 + Agent 那句 */}
      {line(m.kicker, L.kicker.x, L.kicker.y + L.kicker.h - 12, TYPE.kicker[o.size], p.sub, { w: L.kicker.w, testID: 'share-card-kicker' })}
      <View style={{ position: 'absolute', left: u(L.big.x), top: u(L.big.y + L.big.h - BIG_BASE * L.bigFont), flexDirection: 'row', alignItems: 'baseline' }} testID="share-card-big">
        <Text fixedSize style={{ ...FAMILY, fontSize: u(L.bigFont), lineHeight: u(L.bigFont), letterSpacing: u(-Math.round(L.bigFont * 0.03)), color: p.accent, fontWeight: weight.strong }}>{String(m.big)}</Text>
        <Text fixedSize style={[font(TYPE.unit[o.size], p.text, true), { marginLeft: u(16) }]}>{m.unit}</Text>
      </View>
      {m.agentLine && L.agent ? line(m.agentLine, L.agent.x, L.agent.y + L.agent.h - 12, TYPE.agent[o.size], p.accent, { w: L.agent.w, bold: true, testID: 'share-card-agent' }) : null}

      {/* 三格数 */}
      <View style={panel(L.stats)} testID="share-card-panel">
        {statColumns(L).map((col, i) => {
          const s = m.stats[i];
          if (!s) return null;
          const x = col.x + 34, w = col.w - 68;
          return (
            <View key={i}>
              {i ? <View style={{ position: 'absolute', left: u(col.x - L.stats.x), top: u(28), width: 1, height: u(col.h - 56), backgroundColor: p.line }} /> : null}
              {line(s.label, x, sb.label, TYPE.statLabel, p.sub, { w, origin: L.stats })}
              <View style={{ position: 'absolute', left: u(x - L.stats.x), width: u(w), top: u(sb.value - L.stats.y - BASELINE_AT * TYPE.statValue[o.size]), flexDirection: 'row', alignItems: 'baseline', overflow: 'hidden' }}>
                <Text fixedSize numberOfLines={1} style={[font(TYPE.statValue[o.size], p.text, true), { flexShrink: 0 }]}>{s.value}</Text>
                {s.unit ? <Text fixedSize numberOfLines={1} style={[font(TYPE.statUnit, p.sub), { marginLeft: u(8), flexShrink: 1 }]}>{s.unit}</Text> : null}
              </View>
            </View>
          );
        })}
      </View>

      {/* 完成的任务 */}
      {L.titles ? (
        <View style={panel(L.titles)} testID="share-card-titles">
          {head(L.titles, m.titlesHeading, m.titlesRight)}
          {Array.from({ length: L.titleRows }, (_, i) => {
            const more = i >= L.titlesShown;
            const t = more ? null : m.titles[i];
            return (
              <View key={i} style={{ position: 'absolute', left: u(PANEL_X), right: u(PANEL_X), top: u(titleRowTop(L, i) - L.titles!.y), height: u(L.rowH), borderTopWidth: 1, borderColor: p.line, flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: u(TITLE_ICON), height: u(TITLE_ICON), borderRadius: radius.pill, backgroundColor: p.soft, alignItems: 'center', justifyContent: 'center', marginRight: u(18) }}>
                  <Ionicons name="checkmark" size={u(17)} color={p.accent} />
                </View>
                <Text fixedSize style={[font(titleSize, more ? p.sub : p.text), { flex: 1, minWidth: 0 }]} numberOfLines={1} testID="share-card-title">{more ? m.moreTitlesLabel(L.moreCount) : t!.text}</Text>
                {t?.who ? <Text fixedSize style={[font(whoSize, p.sub), { marginLeft: u(24), maxWidth: u(WHO_MAX_W), flexShrink: 0 }]} numberOfLines={1} testID="share-card-who">{t.who}</Text> : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {/* 柱图 */}
      {L.chart && m.chart ? (() => {
        const r = L.chart, cg = chartGeom(L), c = m.chart;
        const max = Math.max(1, ...c.bars.map(b => b.n));
        const bw = (cg.right - cg.left) / Math.max(1, c.bars.length);
        return (
          <View style={panel(r)} testID="share-card-panel">
            {head(r, c.heading, c.right)}
            {c.bars.map((b, i) => {
              const h = b.n ? Math.max(6, ((cg.bottom - cg.top) * b.n) / max) : 3;
              const x = cg.left + i * bw + bw * 0.18, last = i === c.bars.length - 1;
              return (
                <View key={i}>
                  <View style={{ position: 'absolute', left: u(x - r.x), top: u(cg.bottom - h - r.y), width: u(bw * 0.64), height: u(h), borderTopLeftRadius: u(6), borderTopRightRadius: u(6), backgroundColor: b.n ? p.accent : p.line, opacity: b.n && !last ? 0.55 : 1 }} />
                  {b.label ? line(b.label, last ? cg.right : i === 0 ? cg.left : x + bw * 0.32 - 40, cg.labelBase, TYPE.axis, p.sub, { w: 80, right: last, origin: r }) : null}
                </View>
              );
            })}
          </View>
        );
      })() : null}

      {/* 热力图 */}
      {L.heat && m.heat ? (() => {
        const r = L.heat, hg = heatGeom(L, heatCols);
        return (
          <View style={panel(r)} testID="share-card-panel">
            {head(r, m.heat.heading, m.heat.right)}
            {m.heat.cells.map(c => <View key={`${c.col}-${c.row}`} style={{ position: 'absolute', left: u(hg.x0 + c.col * hg.cell - r.x), top: u(hg.y0 + c.row * hg.cell - r.y), width: u(hg.size), height: u(hg.size), borderRadius: u(3), backgroundColor: p.heat[c.level] ?? p.heat[0] }} />)}
          </View>
        );
      })() : null}

      {/* 谁完成的 */}
      {L.who && m.who ? (() => {
        const r = L.who, wg = whoGeom(L), w = m.who;
        const bw = r.w - PANEL_X * 2, total = Math.max(1, w.agent + w.user);
        const aw = w.user ? Math.max(wg.barH, (bw - 4) * (w.agent / total)) : bw;
        return (
          <View style={panel(r)} testID="share-card-panel">
            {L.whoFull ? head(r, w.heading, w.right) : null}
            <View style={{ position: 'absolute', left: u(PANEL_X), top: u(wg.barY - r.y), width: u(aw), height: u(wg.barH), borderRadius: radius.pill, backgroundColor: p.accent }} />
            {w.user ? <View style={{ position: 'absolute', left: u(PANEL_X + aw + 4), top: u(wg.barY - r.y), width: u(bw - aw - 4), height: u(wg.barH), borderRadius: radius.pill, backgroundColor: p.soft }} /> : null}
            {line(w.agentLabel, r.x + PANEL_X, wg.labelBase, TYPE.whoLabel, p.text, { w: bw / 2, bold: true, origin: r })}
            {line(w.userLabel, r.x + r.w - PANEL_X, wg.labelBase, TYPE.whoLabel, p.text, { w: bw / 2, bold: true, right: true, origin: r })}
            {L.whoFull ? w.top.slice(0, 3).map((t, i) => {
              const x = r.x + PANEL_X + i * (wg.colW + 20);
              return (
                <View key={i}>
                  <View style={{ position: 'absolute', left: u(x - r.x), top: u(wg.leaderCy - 28 - r.y), width: u(56), height: u(56), borderRadius: radius.pill, backgroundColor: i === 0 ? p.accent : p.soft, alignItems: 'center', justifyContent: 'center' }}>
                    <Text fixedSize style={font(26, i === 0 ? '#ffffff' : p.strong, true)}>{String(i + 1)}</Text>
                  </View>
                  {line(t.name, x + 72, wg.leaderCy - 6, TYPE.leaderName, p.text, { w: wg.colW - 72, bold: true, origin: r, testID: 'share-card-leader' })}
                  {line(t.sub, x + 72, wg.leaderCy + 26, TYPE.leaderSub, p.sub, { w: wg.colW - 72, origin: r })}
                </View>
              );
            }) : null}
          </View>
        );
      })() : null}

      {/* 页脚 */}
      {(() => {
        const r = L.footer, fb = footerBase(L);
        return (
          <>
            {line(m.link, r.x + r.w, fb.line, TYPE.footer, p.sub, { w: 440, right: true })}
            {line(m.footer, r.x, fb.line, TYPE.footer, p.faint, { w: r.w - 440 - 24 })}
            {m.approxNote ? line(m.approxNote, r.x, fb.note, TYPE.note, p.faint, { w: r.w }) : null}
          </>
        );
      })()}
    </View>
  );
}
