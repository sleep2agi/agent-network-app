// 服务器页「机器」水位(看板 #618)—— 真应用(expo web 导出 + Tauri 桥桩)里量真框、点真行。
// Hub 数据是页内假数据(host-a … host-e,示例-* 别名),不起 hub 进程、不占端口、不碰 HOME。
//
//   WEB_DIR=<expo export 目录> [OUT=<截图目录>] [BASELINE=1] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] \
//   node tests/test-server-host-levels/drive.mjs
//
// 夹具:5 台机器 + 1 个没报 hostname 的节点 ——
//   host-a 4 个节点全绿 · host-b 内存 94%(红)+ CPU 88%(黄)· host-c 心跳 17 分钟前(过期)·
//   host-d 没报磁盘字段 · host-e 磁盘 80%(黄)。
// 布局:桌面 1200×850(桌面 UA + Tauri 桩 = 桌面工作区)与窄屏 390×844(安卓 UA),浅色 / 深色各一遍。
// 检查:
//   order   红色机器(host-b)排第一;其余按在线节点数
//   tone    (看板「app 机器水位条配色太丑」)host-a 条 = 主题 accent(晴蓝),轨道 = tonalBg(强调色浅底);
//           host-b 内存条 = failed 向 card 淡 22%;host-b CPU / host-e 磁盘 = blocked 向 card 淡 22%;
//           没有任何一根条还是 running 绿
//   stale   host-c 有「数据 17 分钟前」,三根条都是灰(textMuted)、轨道是中性灰(subtleFill),不是任何告警色
//   name    每行机器名的字形左边缘(Range 量文字本身,不是元素框)在行的内边距以内、且不早于名字元素的左边缘 ——
//           截图里一台机器名「少了首字」要能和「被裁掉首字」区分开(实测是 Hub 上报的 hostname 本身就少那个字,不是渲染裁切)
//   back    点一台机器进节点列表再回到服务器页,没有任何一行停在按下的灰底(rowHover)
//   missing host-d 磁盘:没有填充条,文字「—」(不是 0%)
//   align   每一列(CPU / 内存 / 磁盘)的条左边缘逐行相等(±1px);窄屏三根条左边缘也相等
//   fit     窄屏:每行右边缘不超出视口(没有横向溢出)
//   more    11 台机器时只显示 8 行 +「全部 11 台」,点开显示 11 行
//   click   点 host-a → 节点列表出现「机器 host-a」筛选,列表只剩 host-a 的 4 个节点
// BASELINE=1:只截图(改动前的 before 列),不断言。任何一条没跑到 = FAIL(不是 skip)。
import { mkdirSync, writeFileSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA, TEST_LOCALE } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
const BASELINE = process.env.BASELINE === '1';
if (OUT) mkdirSync(OUT, { recursive: true });

let pass = 0; const failures = [];
const ck = (name, ok, extra = '') => {
  if (BASELINE) return;
  if (ok) pass++; else failures.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`);
};

// 页内夹具:全量 /api/status 带 host 对象 + 平铺字段(与 Hub 同形);light 只给 8 个字段(没有 host)。
const fixtureScript = ({ manyHosts }) => {
  const now = Date.now();
  const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString().replace('T', ' ').slice(0, 19);
  const host = (hostname, o = {}) => ({ hostname, ip: '192.0.2.1', cpu_load_1min: 3, cpu_cores: 16, mem_total_gb: 62.6, mem_used_gb: 20, mem_avail_gb: 42.6, disk_total_gb: 500, disk_used_gb: 120, disk_avail_gb: 380, ...o });
  const rows = [];
  const add = (alias, status, minAgo, h) => rows.push({ alias, status, agent: 'claude-code', runtime: 'agent-node', node_id: `n_${alias}`, updated_at: iso(minAgo), ...h, host: { ...h } });
  for (let i = 1; i <= 4; i++) add(`示例-A${i}`, i === 2 ? 'working' : 'idle', 1, host('host-a'));
  add('示例-B1', 'working', 1, host('host-b', { cpu_load_1min: 14, mem_used_gb: 58.9, mem_avail_gb: 3.7 }));
  add('示例-B2', 'idle', 2, host('host-b', { cpu_load_1min: 13, mem_used_gb: 58, mem_avail_gb: 4.6 }));
  add('示例-B3', 'offline', 40, host('host-b', { cpu_load_1min: 1, mem_used_gb: 10 }));
  add('示例-C1', 'idle', 17, host('host-c', { mem_used_gb: 60 }));
  add('示例-C2', 'offline', 25, host('host-c'));
  add('示例-D1', 'idle', 1, host('host-d', { disk_total_gb: null, disk_used_gb: null, disk_avail_gb: null }));
  add('示例-D2', 'idle', 1, host('host-d', { disk_total_gb: null, disk_used_gb: null, disk_avail_gb: null }));
  add('示例-E1', 'idle', 1, host('host-e', { disk_used_gb: 400, disk_avail_gb: 100 }));
  rows.push({ alias: '示例-X', status: 'idle', agent: 'codex', node_id: 'n_x', updated_at: iso(1), hostname: null, host: { hostname: null } });
  if (manyHosts) for (let i = 1; i <= 6; i++) add(`示例-M${i}`, 'idle', 1, host(`host-m${i}`));
  window.__routeOverride = (u) => {
    if (u.pathname !== '/api/status') return undefined;
    if (u.searchParams.get('light') === '1') return { ok: true, sessions: rows.map(s => ({ alias: s.alias, status: s.status, agent: s.agent, task: null, server: null, updated_at: s.updated_at, runtime: s.runtime ?? null, network_id: 'net-sweep' })) };
    return { ok: true, sessions: rows };
  };
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ executablePath: findChromium() });

// 主题 token(src/theme.ts 的原值)。告警色 = 原 token 向 card 线性混合 SOFTEN(与 theme.ts mixHex 同一公式,这里独立再算一遍)。
const TOKENS = {
  light: { accent: '#1b65db', tonalBg: '#edf3fe', subtleFill: '#f0f1f3', card: '#ffffff', running: '#15803d', failed: '#dc2626', blocked: '#d97706', muted: '#636a75', rowHover: '#f1f3f5' },
  dark: { accent: '#5e9bff', tonalBg: '#172a48', subtleFill: '#1e1e22', card: '#18181b', running: '#22c55e', failed: '#ef4444', blocked: '#f59e0b', muted: '#8b8b95', rowHover: '#1b1b1f' },
};
const SOFTEN = 0.22;
const hexRgb = (h) => [0, 2, 4].map(i => Number.parseInt(h.slice(1).slice(i, i + 2), 16));
const rgb = (h) => `rgb(${hexRgb(h).join(', ')})`;
const mixRgb = (a, b, t) => { const x = hexRgb(a), y = hexRgb(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(', ')})`; };
const COLORS = Object.fromEntries(Object.entries(TOKENS).map(([k, T]) => [k, {
  accent: rgb(T.accent), track: rgb(T.tonalBg), trackStale: rgb(T.subtleFill), running: rgb(T.running),
  failed: mixRgb(T.failed, T.card, SOFTEN), blocked: mixRgb(T.blocked, T.card, SOFTEN), muted: rgb(T.muted), rowHover: rgb(T.rowHover),
}]));

async function open({ layout, theme, manyHosts = false }) {
  const phone = layout === 'phone';
  const ctx = await browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1200, height: 850 },
    deviceScaleFactor: 1,
    colorScheme: theme,
    locale: TEST_LOCALE,
    ...(phone ? { userAgent: ANDROID_UA } : {}),
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(initScript, { theme });
  await page.addInitScript(fixtureScript, { manyHosts });
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
  await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'server' }));
  await page.locator('[data-testid="server-overview"]').waitFor({ timeout: 15000 });
  return { ctx, page, errors };
}

const fillOf = (page, id) => page.evaluate((sel) => {
  const track = document.querySelector(sel);
  if (!track) return { found: false };
  const fill = track.firstElementChild;
  return { found: true, fill: !!fill, color: fill ? getComputedStyle(fill).backgroundColor : null, track: getComputedStyle(track).backgroundColor, width: fill ? fill.getBoundingClientRect().width : 0 };
}, `[data-testid="${id}"]`);

const measurements = [];
for (const layout of ['desktop', 'phone']) {
  for (const theme of ['light', 'dark']) {
    const tag = `${layout}-${theme}`;
    const { ctx, page, errors } = await open({ layout, theme });
    const hostsPanel = page.locator('[data-testid="server-hosts"]');
    const hasPanel = await hostsPanel.waitFor({ timeout: 15000 }).then(() => true, () => false);
    if (hasPanel) await hostsPanel.scrollIntoViewIfNeeded();
    else await page.locator('[data-testid="server-overview"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    if (OUT) await page.screenshot({ path: `${OUT}/${tag}.png` });
    if (BASELINE) { console.log(`baseline ${tag}: 机器分区 ${hasPanel ? '有' : '没有'}`); await ctx.close(); continue; }

    ck(`${tag}: 「机器」分区出现`, hasPanel);
    const C = COLORS[theme];
    // order
    const order = await page.$$eval('[data-testid^="server-host-name-"]', els => els.map(e => e.textContent));
    ck(`${tag}: 5 台机器,没有「未知」行`, order.length === 5 && !order.some(n => !n || n === 'null'), order.join());
    ck(`${tag}: 红色机器 host-b 排第一`, order[0] === 'host-b', order.join());
    // host-a 4 在线 > host-d 2 > host-c 1(心跳旧但 Hub 还没标离线)= host-e 1,同在线数按总数(c 2 > e 1)。
    ck(`${tag}: 其余按在线节点数、再按总数`, order.join() === 'host-b,host-a,host-d,host-c,host-e', order.join());
    // tone
    const bMem = await fillOf(page, 'server-host-bar-mem-host-b');
    ck(`${tag}: host-b 内存条 = failed(淡)色`, bMem.color === C.failed, JSON.stringify(bMem));
    const bCpu = await fillOf(page, 'server-host-bar-cpu-host-b');
    ck(`${tag}: host-b CPU 88% = blocked(淡)色`, bCpu.color === C.blocked, JSON.stringify(bCpu));
    const eDisk = await fillOf(page, 'server-host-bar-disk-host-e');
    ck(`${tag}: host-e 磁盘 80% = blocked(淡)色`, eDisk.color === C.blocked, JSON.stringify(eDisk));
    const aCpu = await fillOf(page, 'server-host-bar-cpu-host-a');
    ck(`${tag}: host-a CPU = accent 晴蓝`, aCpu.color === C.accent, JSON.stringify(aCpu));
    ck(`${tag}: host-a 轨道 = tonalBg(强调色浅底)`, aCpu.track === C.track, JSON.stringify(aCpu));
    const fills = await page.$$eval('[data-testid^="server-host-bar-"]', els => els.map(e => e.firstElementChild ? getComputedStyle(e.firstElementChild).backgroundColor : null));
    ck(`${tag}: 没有一根条还是 running 绿`, fills.length === 15 && !fills.includes(C.running), JSON.stringify(fills));
    // stale
    // 标记里还有一个图标字形(icon font 的私有区字符),按可见文字段比。
    const staleText = await page.locator('[data-testid="server-host-stale-host-c"]').innerText({ timeout: 3000 }).catch(() => null);
    ck(`${tag}: host-c 写「数据 17 分钟前」`, !!staleText && staleText.replace(/[\uE000-\uF8FF\s]/g, '') === '数据17分钟前', JSON.stringify(staleText));
    for (const k of ['cpu', 'mem', 'disk']) {
      const f = await fillOf(page, `server-host-bar-${k}-host-c`);
      ck(`${tag}: host-c ${k} 条是灰色(过期)`, f.fill && f.color === C.muted, JSON.stringify(f));
      ck(`${tag}: host-c ${k} 轨道是中性灰(过期)`, f.track === C.trackStale, JSON.stringify(f));
    }
    ck(`${tag}: 新鲜的机器没有过期标记`, !(await page.locator('[data-testid="server-host-stale-host-a"]').count()));
    // missing
    const dDisk = await fillOf(page, 'server-host-bar-disk-host-d');
    ck(`${tag}: host-d 磁盘没有填充条(不是 0%)`, dDisk.found && !dDisk.fill, JSON.stringify(dDisk));
    const dLabel = await page.locator('[data-testid="server-host-host-d"]').getAttribute('aria-label');
    ck(`${tag}: host-d 读作「磁盘 —」`, /磁盘 —/.test(dLabel ?? '') && !/磁盘 0%/.test(dLabel ?? ''), String(dLabel));
    // align
    const boxes = await page.$$eval('[data-testid^="server-host-bar-"]', els => els.map(e => { const r = e.getBoundingClientRect(); const id = e.getAttribute('data-testid'); const [, , , k, ...h] = id.split('-'); return { k, host: h.join('-'), x: r.left, w: r.width, right: r.right }; }));
    const row = { tag };
    for (const k of ['cpu', 'mem', 'disk']) {
      const xs = boxes.filter(b => b.k === k).map(b => b.x);
      const spread = xs.length ? Math.max(...xs) - Math.min(...xs) : NaN;
      row[k] = { left: xs.length ? Math.round(Math.min(...xs) * 10) / 10 : null, spread: Math.round(spread * 100) / 100, rows: xs.length };
      ck(`${tag}: ${k} 条左边缘逐行对齐 ±1px`, xs.length === 5 && spread <= 1, `spread=${spread.toFixed(2)} n=${xs.length}`);
    }
    if (layout === 'phone') {
      const xs = boxes.map(b => b.x);
      const spread = Math.max(...xs) - Math.min(...xs);
      row.allThree = Math.round(spread * 100) / 100;
      ck(`${tag}: 窄屏三根条左边缘也相等 ±1px`, spread <= 1, `spread=${spread.toFixed(2)}`);
      const rights = await page.$$eval('[data-testid^="server-host-host-"]', els => els.map(e => e.getBoundingClientRect().right));
      ck(`${tag}: 每行不超出视口宽度`, rights.length === 5 && rights.every(r => r <= 390), JSON.stringify(rights));
      const widths = boxes.map(b => b.w);
      ck(`${tag}: 条宽 ≥ 80px(读得出差别)`, widths.every(w => w >= 80), JSON.stringify(widths.map(w => Math.round(w))));
    } else {
      const widths = [...new Set(boxes.map(b => Math.round(b.w)))];
      row.widths = widths;
      ck(`${tag}: 三列条等宽(±1px)`, Math.max(...widths) - Math.min(...widths) <= 1, JSON.stringify(widths));
    }
    // name:字形左边缘在行内边距以内(量 Range,不是元素框 —— 元素框不动、字被 overflow 裁掉时只有 Range 会露出来)
    const names = await page.$$eval('[data-testid^="server-host-name-"]', els => els.map(el => {
      const rowEl = el.closest('[data-testid^="server-host-host-"]');
      const r = rowEl.getBoundingClientRect();
      const padL = parseFloat(getComputedStyle(rowEl).paddingLeft) || 0;
      const range = document.createRange(); range.selectNodeContents(el);
      const g = range.getBoundingClientRect();
      const e = el.getBoundingClientRect();
      return { name: el.textContent, glyphLeft: g.left, elLeft: e.left, contentLeft: r.left + padL, rowLeft: r.left, padL };
    }));
    row.names = names.map(n => ({ name: n.name, glyphLeft: Math.round(n.glyphLeft * 10) / 10, contentLeft: Math.round(n.contentLeft * 10) / 10 }));
    ck(`${tag}: 机器名字形左边缘在行内边距以内(${names.length} 行)`,
      names.length === 5 && names.every(n => n.padL > 0 && n.glyphLeft >= n.contentLeft - 0.5 && n.glyphLeft >= n.elLeft - 0.5 && n.glyphLeft <= n.contentLeft + 2),
      JSON.stringify(row.names));
    measurements.push(row);
    ck(`${tag}: 没有页面错误`, errors.length === 0, errors.join(' | ').slice(0, 300));

    // click(每种布局浅色跑一次)
    if (theme === 'light') {
      await page.locator('[data-testid="server-host-host-a"]').click();
      const chip = await page.locator('[data-testid="agent-filter-host"]').textContent({ timeout: 8000 }).catch(() => null);
      ck(`${tag}: 点 host-a → 节点列表筛选「机器 host-a」`, chip === '机器 host-a', String(chip));
      const count = await page.locator('[data-testid="agent-filter-clear"]').textContent({ timeout: 3000 }).catch(() => null);
      ck(`${tag}: 列表只剩 host-a 的 4 个节点`, !!count && count.replace(/[\uE000-\uF8FF\s]/g, '') === '4个', JSON.stringify(count));
      const otherShown = await page.getByText('示例-B1', { exact: true }).count();
      ck(`${tag}: 别的机器的节点不在列表里`, otherShown === 0, String(otherShown));
      if (OUT) await page.screenshot({ path: `${OUT}/${tag}-click-host-a.png` });
      // back:回到服务器页,没有一行留着按下态的灰底
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'server' }));
      await page.locator('[data-testid="server-hosts"]').waitFor({ timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(300);
      const bgs = await page.$$eval('[data-testid^="server-host-host-"]', els => els.map(e => getComputedStyle(e).backgroundColor));
      ck(`${tag}: 返回服务器页后没有行停在按下的灰底`, bgs.length === 5 && !bgs.includes(C.rowHover), JSON.stringify(bgs));
    }
    await ctx.close();
  }
}

// more:11 台机器 → 8 行 +「全部 11 台」
if (!BASELINE) {
  const { ctx, page } = await open({ layout: 'desktop', theme: 'light', manyHosts: true });
  await page.locator('[data-testid="server-hosts"]').waitFor({ timeout: 15000 }).catch(() => {});
  const shown = await page.locator('[data-testid^="server-host-name-"]').count();
  const toggle = await page.locator('[data-testid="server-hosts-toggle"]').textContent({ timeout: 3000 }).catch(() => null);
  ck('more: 11 台时默认只显示 8 行', shown === 8, String(shown));
  ck('more: 折叠按钮写「全部 11 台」', toggle === '全部 11 台', String(toggle));
  await page.locator('[data-testid="server-hosts-toggle"]').click().catch(() => {});
  await page.waitForTimeout(200);
  ck('more: 点开后 11 行', (await page.locator('[data-testid^="server-host-name-"]').count()) === 11);
  await ctx.close();
}

await browser.close();
web.close();
if (OUT && !BASELINE) writeFileSync(`${OUT}/measurements.json`, JSON.stringify(measurements, null, 2));
if (!BASELINE) console.log('\nmeasurements:', JSON.stringify(measurements));
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { console.log('FAILED:\n  ' + failures.join('\n  ')); process.exit(1); }
