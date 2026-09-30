// 分享图的 RN 版:和 task-share-card.ts 的 Canvas 版同一份排版(shareCardLayout)、同一套颜色、同一份内容
// (ShareCardModel),只是用 View / Text 画。手机原生端没有 Canvas —— 生成分享图时显示的就是它;
// 下一步(react-native-view-shot)把这个视图按 1080 宽原样截成 PNG。
//
// scale:1 = 1080 逻辑像素宽;预览时按容器缩小(所有尺寸乘 scale,不用 transform,文字排版随之缩放)。
// 与 Canvas 版的已知差别:大数字是纯色(RN 没有文字渐变),背景只有底色没有两团光和网格。
// 字一律 fixedSize:这是一张图,界面密度 / 系统字号不该把它撑变形。
// (web 上缩成预览时 Chromium 的最小字号会把 < 6px 的字放大、被 numberOfLines 切掉字头 —— 只影响 web 布局测试里的预览,
// 原生端没有最小字号,web 本身用的是 Canvas 版。)
import { Image, View } from 'react-native';
import { Text } from './ui-text';
import { radius, weight } from './theme';
import { GAP, PALETTE, SHARE_H, SHARE_W, TITLE_HEAD, TITLE_ROW, shareCardLayout, type Rect, type ShareCardModel, type ShareOptions } from './task-share-card';

export default function ShareCardNative({ model: m, opts: o, scale, testID }: { model: ShareCardModel; opts: ShareOptions; scale: number; testID?: string }) {
  const L = shareCardLayout(o.size, o, m.titles.length);
  const p = PALETTE[o.theme];
  const u = (n: number) => n * scale;
  const abs = (r: Rect) => ({ position: 'absolute' as const, left: u(r.x), top: u(r.y), width: u(r.w), height: u(r.h) });
  const panel = (r: Rect) => ({ ...abs(r), backgroundColor: p.panel, borderColor: p.panelBorder, borderWidth: 1, borderRadius: u(28) });
  // 行高留足(1.45):预览缩到 0.18 倍时字只有 5px 上下,行高按 1.3 取整后 numberOfLines 的裁剪会切掉字头。
  const text = (size: number, color: string, bold = false, lh = 1.45) => ({ fontSize: u(size), lineHeight: u(size * lh), color, fontWeight: bold ? weight.strong : weight.regular });
  const head = (left: string, right: string) => (
    <View style={{ position: 'absolute', left: u(34), right: u(34), top: u(26), flexDirection: 'row' }}>
      <Text fixedSize style={[text(26, p.text, true), { flex: 1 }]} numberOfLines={1}>{left}</Text>
      {right ? <Text fixedSize style={text(24, p.sub)} numberOfLines={1}>{right}</Text> : null}
    </View>
  );
  const kw = (L.kpis.w - 2 * GAP) / 3;
  const maxDaily = Math.max(10, Math.ceil(Math.max(1, ...m.daily.map(d => d.n)) / 10) * 10);
  const heatCols = Math.max(1, ...m.heat.map(c => c.col + 1));
  const heatCell = L.heat ? Math.min(14, (L.heat.w - 68) / heatCols) : 0;
  const medal = ['#e0b43a', '#aab4bf', '#c9864a'];
  return (
    <View style={{ width: u(SHARE_W), height: u(SHARE_H[o.size]), backgroundColor: p.bg, overflow: 'hidden' }} testID={testID}>
      {/* 头 */}
      <View style={[abs(L.header), { flexDirection: 'row', alignItems: 'center' }]}>
        <Image source={require('../assets/icon-ios.png')} style={{ width: u(92), height: u(92), borderRadius: u(22) }} />
        <View style={{ marginLeft: u(22), flex: 1 }}>
          <Text fixedSize style={text(40, p.text, true)} numberOfLines={1}>{m.brand}</Text>
          <Text fixedSize style={text(24, p.sub)} numberOfLines={1}>{m.brandSub}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text fixedSize style={text(30, p.text, true)}>{m.reportLabel}</Text>
          <Text fixedSize style={text(24, p.sub)}>{m.dateLabel}</Text>
        </View>
      </View>
      {/* 大数字 */}
      <Text fixedSize style={[abs(L.kicker), text(34, p.sub)]} numberOfLines={1}>{m.kicker}</Text>
      <Text fixedSize style={[abs(L.big), { fontSize: u(L.bigFont), lineHeight: u(L.big.h), color: p.accent, fontWeight: weight.strong }]} numberOfLines={1}>{String(m.big)}</Text>
      <Text fixedSize style={[abs(L.unit), text(44, p.text, true)]} numberOfLines={1}>
        {m.unit}{m.agentLine ? <Text fixedSize style={{ color: p.accent }}>{` · ${m.agentLine}`}</Text> : null}
      </Text>
      {/* KPI */}
      {m.kpis.slice(0, 3).map((k, i) => (
        <View key={k.label} style={[panel({ x: L.kpis.x + i * (kw + GAP), y: L.kpis.y, w: kw, h: L.kpis.h }), { paddingHorizontal: u(30), paddingVertical: u(18), justifyContent: 'space-between' }]}>
          <Text fixedSize style={text(24, p.sub)} numberOfLines={1}>{k.label}</Text>
          <Text fixedSize style={text(o.size === 'portrait' ? 64 : 60, p.text, true, 1.15)} numberOfLines={1}>{k.value}</Text>
        </View>
      ))}
      {/* 完成的任务 */}
      {L.titles ? (
        <View style={panel(L.titles)} testID="share-card-titles">
          {head(m.titlesHeading, '')}
          {Array.from({ length: L.titleRows }, (_, i) => {
            const last = i === L.titleRows - 1 && L.titleOverflow > 0;
            return (
              <View key={i} style={{ position: 'absolute', left: u(36), right: u(34), top: u(TITLE_HEAD + i * TITLE_ROW - 16), flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: u(14), height: u(14), borderRadius: radius.pill, backgroundColor: p.accent, marginRight: u(18) }} />
                <Text fixedSize style={[text(28, last ? p.sub : p.text), { flex: 1 }]} numberOfLines={1} testID="share-card-title">{last ? m.moreTitlesLabel(L.titleOverflow + 1) : m.titles[i]}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
      {/* 近 30 天 */}
      <View style={panel(L.daily)}>
        {head(m.dailyHeading, m.dailyRight)}
        <View style={{ position: 'absolute', left: u(78), right: u(34), top: u(96), bottom: u(52), flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: 1, borderColor: p.axis }}>
          {m.daily.map((d, i) => (
            <View key={i} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
              <View style={{ width: '64%', height: `${(d.n / maxDaily) * 100}%` as any, backgroundColor: i === m.daily.length - 1 ? p.accent : p.accentB, borderTopLeftRadius: u(6), borderTopRightRadius: u(6) }} />
            </View>
          ))}
        </View>
        <View style={{ position: 'absolute', left: u(78), right: u(34), bottom: u(14), flexDirection: 'row' }}>
          {m.daily.map((d, i) => (
            <View key={i} style={{ flex: 1, height: u(26) }}>
              {d.label ? <Text fixedSize style={[text(20, p.sub), { position: 'absolute', width: u(80), textAlign: i === m.daily.length - 1 ? 'right' : 'center', ...(i === m.daily.length - 1 ? { right: 0 } : { left: '50%', marginLeft: -u(40) }) }]}>{d.label}</Text> : null}
            </View>
          ))}
        </View>
      </View>
      {/* 全年 */}
      {L.heat ? (
        <View style={panel(L.heat)}>
          {head(m.heatHeading, m.heatRight)}
          <View style={{ position: 'absolute', left: u((L.heat.w - heatCols * heatCell) / 2), top: u(78) }}>
            {m.heat.map(c => <View key={`${c.col}-${c.row}`} style={{ position: 'absolute', left: u(c.col * heatCell), top: u(c.row * heatCell), width: u(heatCell * 0.78), height: u(heatCell * 0.78), borderRadius: u(3), backgroundColor: p.heat[c.level] ?? p.heat[0] }} />)}
          </View>
        </View>
      ) : null}
      {/* 完成榜 */}
      {L.top ? (
        <View style={panel(L.top)}>
          {head(m.topHeading, '')}
          <View style={{ position: 'absolute', left: u(34), right: u(34), top: u(74), flexDirection: 'row' }}>
            {m.top.slice(0, 3).map((t, i) => (
              <View key={i} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 }}>
                <View style={{ width: u(60), height: u(60), borderRadius: radius.pill, backgroundColor: medal[i], alignItems: 'center', justifyContent: 'center' }}><Text fixedSize style={text(28, '#ffffff', true)}>{String(i + 1)}</Text></View>
                <View style={{ marginLeft: u(16), flex: 1, minWidth: 0 }}>
                  <Text fixedSize style={text(26, p.text, true)} numberOfLines={1}>{t.name}</Text>
                  <Text fixedSize style={text(22, p.sub)} numberOfLines={1}>{t.sub}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      {/* 页脚 */}
      <View style={[abs(L.footer), { flexDirection: 'row', alignItems: 'center' }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text fixedSize style={text(24, p.sub)} numberOfLines={1}>{m.footer}</Text>
          {m.approxNote ? <Text fixedSize style={text(20, p.sub)} numberOfLines={1}>{m.approxNote}</Text> : null}
        </View>
        <View style={{ borderWidth: 1.5, borderColor: p.sub, borderRadius: radius.pill, paddingHorizontal: u(26), paddingVertical: u(10) }}>
          <Text fixedSize style={text(22, p.sub)} numberOfLines={1}>{m.link}</Text>
        </View>
      </View>
    </View>
  );
}
