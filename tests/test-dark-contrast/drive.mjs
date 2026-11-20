// 深色 ≤12px 文字对比度复查（审计 2026-11-20 遗留项）。
// 真导出 + dark 主题，逐屏扫叶子文本：硬判据 3.5:1（低于即红），<4.5:1 只打印不红（体感类）。
// 不用真 hub / 真账号：harness 的 Tauri 桩 + fixture。
import { serveExport, initScript, findChromium } from '../test-layout-sweep/harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
let failures = 0;
const screens = ['agents', 'chat', 'tasks', 'scheduled', 'settings', 'org'];
try {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 850 }, locale: 'zh-CN', colorScheme: 'dark' });
  const page = await ctx.newPage();
  await ctx.addInitScript(initScript, { theme: 'dark' });
  await ctx.addInitScript(() => localStorage.setItem('theme_mode_v1', 'dark'));
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
  const scan = () => page.evaluate(() => {
    const parse = c => { const m = c.match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/); return m ? { r:+m[1], g:+m[2], b:+m[3], a: m[4]===undefined?1:+m[4] } : null; };
    const lum = ({r,g,b}) => { const f = v => { v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
    const blend = (fg, bg) => ({ r: fg.r*fg.a + bg.r*(1-fg.a), g: fg.g*fg.a + bg.g*(1-fg.a), b: fg.b*fg.a + bg.b*(1-fg.a), a: 1 });
    const effBg = el => {
      let n = el, stack = [];
      while (n && n !== document.documentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0) { stack.push(c); if (c.a >= 0.999) break; }
        n = n.parentElement;
      }
      let base = { r: 18, g: 18, b: 20, a: 1 };
      for (let i = stack.length - 1; i >= 0; i--) base = blend(stack[i], base);
      return base;
    };
    const out = [];
    for (const el of document.querySelectorAll('div,span')) {
      const txt = (el.textContent || '').trim();
      if (!txt || el.children.length > 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
      const fs = parseFloat(cs.fontSize); if (!(fs <= 12)) continue;
      const fg = parse(cs.color); if (!fg) continue;
      const bg = effBg(el); const c = blend(fg, bg);
      const l1 = lum(c), l2 = lum(bg);
      const ratio = (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
      if (ratio < 4.5) out.push({ t: txt.slice(0, 24), fs, ratio: Math.round(ratio*100)/100 });
    }
    return out;
  });
  for (const s of screens) {
    await page.evaluate(x => window.__anetLayoutSweep.setScreen(x === 'chat' ? { name: 'chat', alias: '示例-A' } : { name: x }), s);
    await page.waitForTimeout(1000);
    const rows = await scan();
    const hard = rows.filter(r => r.ratio < 3.5);
    if (hard.length) failures++;
    console.log(JSON.stringify({ screen: s, under45: rows.length, under35: hard.length, sample: rows.slice(0, 4) }));
  }
  await ctx.close();
} finally {
  await browser.close();
  web.close();
}
console.log(failures ? `✗ ${failures} 屏低于 3.5:1` : '✓ 全部屏 ≥3.5:1（<4.5 的只记录）');
process.exit(failures ? 1 : 0);
