// 聊天右侧「日志」面板(admin 2026-11-26:「可以切换是否详细点，从最新的往前拉，不要占太多 Hub 资源」)。
// 不进 CI:要 Playwright + Chromium + expo web 导出。Hub 全是页内假数据(test-layout-sweep 的桩 + 这里的 __routeOverride):
// 节点有 500 行日志,tail_node_logs 按 lines 回「最新的 N 行」—— 和 agent-node 一样。不起 hub、不占端口。
//
//   WEB_DIR=<expo export 目录> [OUT=<截图目录>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-log-panel/drive.mjs
//
// 桌面 1440×900 · 浅色 + 深色:
//   newest   最上面一行是最新的一条(时间最大)
//   lines    第一次只要 150 行(请求里 lines=150)
//   concise  默认简洁:没有「[INFO ] [节点名]」前缀、没有调试行;「详细」打开后原文 + 调试行都回来
//   older    点「加载更早的」→ 请求 lines=450,行数变多、最旧那行在最下面;到全部 500 行后按钮消失
//   follow   跟随关着时 8 秒内不发新的 tail_node_logs(不占 hub)
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

let pass = 0, total = 0;
const ck = (name, cond, extra = '') => { total++; if (cond) { pass++; console.log('PASS:', name, extra ? `(${extra})` : ''); } else console.log('FAIL:', name, extra); };
const tid = id => `[data-testid="${id}"]`;

const fixture = () => {
  const ALL = [];
  const base = Date.UTC(2026, 10, 26, 6, 0, 0);
  for (let i = 0; i < 500; i++) {
    const ts = base + i * 1000;
    const d = new Date(ts);
    const hh = String(d.getUTCHours()).padStart(2, '0'), mm = String(d.getUTCMinutes()).padStart(2, '0'), ss = String(d.getUTCSeconds()).padStart(2, '0');
    const level = i % 10 === 3 ? 'debug' : i % 50 === 7 ? 'warn' : 'info';
    const tag = level === 'debug' ? 'DEBUG' : level === 'warn' ? 'WARN ' : 'INFO ';
    ALL.push({ ts, level, key: `node.log:${i * 100}`, text: `[${hh}:${mm}:${ss}] [${tag}] [示例-A] 第 ${i} 行 ${level === 'debug' ? '调试细节 cache=hit' : '正常运行'}` });
  }
  window.__logCalls = [];
  window.__routeOverride = (u, bodyText) => {
    if (u.pathname !== '/mcp') return undefined;
    let params = {};
    try { params = JSON.parse(bodyText || '{}')?.params ?? {}; } catch {}
    const a = params.arguments ?? {};
    const wrap = obj => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(obj) }] } });
    if (params.name === 'tail_node_logs') {
      window.__logCalls.push({ at: Date.now(), lines: a.lines, since_ts: a.since_ts ?? null });
      window.__lastTail = a;
      return wrap({ ok: true, request_id: `lg_${window.__logCalls.length}` });
    }
    if (params.name === 'get_rules_file_result' && String(a.request_id).startsWith('lg_')) {
      const q = window.__lastTail || {};
      const pool = q.since_ts ? ALL.filter(l => l.ts >= q.since_ts) : ALL;
      const n = Math.min(q.lines || 150, 2000);
      const lines = pool.slice(-n);
      return wrap({ ok: true, request_id: a.request_id, op: 'read', status: 'done', exists: true, error: null, age_ms: 5,
        content: JSON.stringify({ files: ['node.log'], lines, truncated: pool.length > n, matched: pool.length, now_ts: ALL[ALL.length - 1].ts }) });
    }
    return undefined;
  };
  // 示例-A 报 logs_capable(新节点)。
  window.__sessionsPatch = ss => { for (const x of ss) if (x.alias === '示例-A') x.logs_capable = true; };
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ executablePath: findChromium() });

for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
  await page.addInitScript(initScript, { theme });
  await page.addInitScript(fixture);
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  try {
    await page.getByText('示例-A', { exact: true }).first().click({ timeout: 30000 });
    await page.locator(tid('chat-tool-logs')).click({ timeout: 15000 });
    await page.locator(tid('node-logs-text')).waitFor({ timeout: 15000 });
  } catch (e) { if (OUT) await page.screenshot({ path: `${OUT}/logs-open-fail-${theme}.png` }); ck(`${theme}: 打开日志面板`, false, String(e.message).split('\n')[0]); await ctx.close(); continue; }
  await page.waitForTimeout(400);

  const read = () => page.locator(tid('node-logs-text')).innerText();
  let text = await read();
  let rows = text.split('\n').filter(Boolean);
  const calls0 = await page.evaluate(() => window.__logCalls.slice());
  ck(`${theme} lines: 第一次只要 150 行`, calls0.length >= 1 && calls0[0].lines === 150, JSON.stringify(calls0));
  ck(`${theme} newest: 最上面是最新的一行(第 499 行)`, /第 499 行/.test(rows[0] ?? ''), rows[0]);
  ck(`${theme} concise: 没有「[INFO ] [示例-A]」前缀`, !/\[INFO\s*\]|\[示例-A\]/.test(text), rows[0]);
  ck(`${theme} concise: 没有调试行`, !/调试细节/.test(text));
  ck(`${theme} concise: 行首是时间`, /^\d{2}:\d{2}:\d{2} 第 499 行/.test(rows[0] ?? ''), rows[0]);
  if (OUT) await page.screenshot({ path: `${OUT}/logs-concise-${theme}.png` });

  await page.locator(tid('node-logs-detailed')).click();
  await page.waitForTimeout(200);
  text = await read();
  ck(`${theme} detailed: 原文前缀回来了`, /\[INFO \] \[示例-A\] 第 499 行/.test(text));
  ck(`${theme} detailed: 调试行回来了`, /调试细节/.test(text));
  if (OUT) await page.screenshot({ path: `${OUT}/logs-detailed-${theme}.png` });
  await page.locator(tid('node-logs-detailed')).click();

  // 跟随关着:8 秒内不再发 tail_node_logs
  const before = (await page.evaluate(() => window.__logCalls.length));
  await page.waitForTimeout(8000);
  const after = (await page.evaluate(() => window.__logCalls.length));
  ck(`${theme} follow: 跟随关着时不轮询`, after === before, `${before} → ${after}`);

  // 加载更早的
  await page.locator(tid('node-logs-older')).scrollIntoViewIfNeeded();
  await page.locator(tid('node-logs-older')).click();
  await page.waitForFunction(() => (window.__logCalls.at(-1)?.lines ?? 0) === 450, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  text = await read();
  rows = text.split('\n').filter(Boolean);
  const lastCall = await page.evaluate(() => window.__logCalls.at(-1));
  ck(`${theme} older: 请求 lines=450`, lastCall?.lines === 450, JSON.stringify(lastCall));
  ck(`${theme} older: 最上面仍是最新、最下面是更早的(第 50 行)`, /第 499 行/.test(rows[0] ?? '') && /第 50 行/.test(rows.at(-1) ?? ''), `${rows[0]} … ${rows.at(-1)}`);
  await page.locator(tid('node-logs-older')).click();
  await page.waitForTimeout(600);
  rows = (await read()).split('\n').filter(Boolean);
  ck(`${theme} older: 全部 500 行后按钮消失`, /第 0 行/.test(rows.at(-1) ?? '') && (await page.locator(tid('node-logs-older')).count()) === 0, rows.at(-1));
  const footer = await page.locator(tid('node-logs-footer')).innerText();
  ck(`${theme} footer: 说清行数与简洁藏了调试行`, /500 行/.test(footer) && /简洁模式藏了 50 行调试/.test(footer), footer);
  ck(`${theme}: 没有页面错误`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
web.close?.();
console.log(`\n${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
