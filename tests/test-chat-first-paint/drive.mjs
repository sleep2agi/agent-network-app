// #781: real exported ChatScreen, isolated in-page HTTP responses; never a live Hub.
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || findChromium() });
const out = process.env.OUT;
if (out) mkdirSync(out, { recursive: true });
let p = 0, n = 0;
const ck = (name, ok, detail = {}) => { n++; if (ok) p++; console.log(JSON.stringify({ name, ok, ...detail })); };
const A = '示例-A', B = '示例-B';
for (const phone of [false, true]) {
  const view = phone ? 'phone' : 'desktop';
  for (const slow of ['proactive', 'tasks']) {
    const context = await browser.newContext({ viewport: { width: phone ? 390 : 1200, height: phone ? 844 : 800 },
      ...(phone ? { hasTouch: true, userAgent: ANDROID_UA } : {}), locale: 'zh-CN' });
    const page = await context.newPage();
    try {
      await page.addInitScript(initScript, { theme: 'light' });
      await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
      await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 15000 });
      await page.evaluate(({ alias, other, slow }) => {
        const created = new Date(Date.now() - 60000).toISOString();
        window.__chatTasksFixture = [alias, other].map((a, i) => ({ task_id: `task-${i}`, from_name: 'tester', to_name: a,
          content: `TASK ${a}`, result: `REPLY ${a}`, status: 'replied', created_at: created }));
        window.__chatTasksPaged = true;
        window.__userMessagesFixture = [alias, other].map((a, i) => ({ message_id: `dm-${i}`, from_session: a,
          content: `PROACTIVE ${a}`, created_at: created, kind: 'text' }));
        const invoke = window.__TAURI_INTERNALS__.invoke;
        const requests = new Map();
        window.__paintReads = [];
        window.__paintSlow = slow;
        window.__paintFail = null;
        window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
          if (cmd === 'plugin:http|fetch') {
            const id = await invoke(cmd, args); requests.set(id, args.clientConfig); return id;
          }
          if (cmd === 'plugin:http|fetch_send') {
            const config = requests.get(args.rid);
            const u = config && new URL(config.url);
            const source = u?.pathname === '/api/tasks' && Number(u.searchParams.get('limit')) > 1 ? 'tasks'
              : u?.pathname === '/api/messages' && u.searchParams.get('scope') === 'user' ? 'proactive' : null;
            if (source) {
              const record = { source, start: performance.now(), end: null };
              window.__paintReads.push(record);
              await new Promise(r => setTimeout(r, source === window.__paintSlow ? 4000 : 100));
              record.end = performance.now();
              if (source === window.__paintFail) throw Error('fixture unavailable');
            }
          }
          return invoke(cmd, args);
        };
      }, { alias: A, other: B, slow });
      const start = Date.now();
      await page.evaluate(alias => window.__anetLayoutSweep.setScreen({ name: 'chat', alias }), A);
      const fastText = `${slow === 'tasks' ? 'PROACTIVE' : 'TASK'} ${A}`;
      const early = await page.getByText(fastText, { exact: true }).first().waitFor({ timeout: 1800 }).then(() => true, () => false);
      const elapsed = Date.now() - start;
      const slowPending = await page.evaluate(s => window.__paintReads.some(r => r.source === s && r.end === null), slow);
      ck(`${view}/${slow}: fast messages visible while slow request pending`, early && slowPending, { elapsedMs: elapsed, slowPending });
      await page.getByText(`TASK ${A}`, { exact: true }).first().waitFor({ timeout: 10000 });
      await page.getByText(`PROACTIVE ${A}`, { exact: true }).first().waitFor({ timeout: 10000 });
      ck(`${view}/${slow}: both sources retained without duplicate rows`,
        await page.locator('[data-testid="chat-item-task-0"]').count() === 1 && await page.locator('[data-testid="chat-item-dm-0"]').count() === 1);
      console.log(JSON.stringify({ view, slow, reads: await page.evaluate(() => window.__paintReads) }));
      if (out && slow === 'proactive') await page.screenshot({ path: `${out}/${view}-loaded.png` });
      // A failing refresh must not erase already displayed rows from the other source.
      await page.evaluate(s => { window.__paintSlow = null; window.__paintFail = s; }, slow);
      await page.waitForTimeout(5500);
      ck(`${view}/${slow}: partial failure retains both cached sources`,
        await page.getByText(`TASK ${A}`, { exact: true }).count() > 0 && await page.getByText(`PROACTIVE ${A}`, { exact: true }).count() > 0);
      // Leave while a slow request is in flight; late A response must not enter B.
      const before = await page.evaluate(s => { window.__paintFail = null; window.__paintSlow = s; return window.__paintReads.length; }, slow);
      await page.waitForFunction(({ before, slow }) => window.__paintReads.slice(before).some(r => r.source === slow && r.end === null), { before, slow }, { timeout: 9000 });
      await page.evaluate(alias => window.__anetLayoutSweep.setScreen({ name: 'chat', alias }), B);
      await page.getByText(`${slow === 'tasks' ? 'PROACTIVE' : 'TASK'} ${B}`, { exact: true }).first().waitFor({ timeout: 10000 });
      await page.waitForTimeout(4500);
      ck(`${view}/${slow}: switching conversation never shows previous messages`,
        await page.getByText(`TASK ${A}`, { exact: true }).count() === 0 && await page.getByText(`PROACTIVE ${A}`, { exact: true }).count() === 0);
    } catch (e) { ck(`${view}/${slow}: drive completed`, false, { error: String(e).slice(0, 280) }); }
    await context.close();
    if (process.env.PROBE_ONLY) break;
  }
  if (process.env.PROBE_ONLY) break;
}
await browser.close(); web.close();
console.log(`chat-first-paint: ${p}/${n} passed`);
process.exit(p === n ? 0 : 1);
