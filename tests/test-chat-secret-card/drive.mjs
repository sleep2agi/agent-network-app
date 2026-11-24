// admin 2026-11-24 —— 聊天里的密钥卡：真导出的 ChatScreen + 页内 HTTP 夹具，不连真 Hub。
// 钉住：AI 回执带 reply_secret_request ⇒ 回复气泡里出现加密输入卡、兜底文字不显示、
// 输入默认隐藏、小眼睛能切换；后面已有「已保存」那句话 ⇒ 卡片直接显示已保存。浅 / 深 × 桌面 / 手机各截一张。
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || findChromium() });
const out = process.env.OUT;
if (out) mkdirSync(out, { recursive: true });
let p = 0, n = 0;
const ck = (name, ok, detail = {}) => { n++; if (ok) p++; console.log(JSON.stringify({ name, ok, ...detail })); };
const A = '示例-A';
const FALLBACK = '请在下方卡片里填写「GitHub 密钥」';
for (const [view, theme, saved] of [['desktop', 'light', false], ['desktop', 'dark', false], ['phone', 'light', false], ['phone', 'dark', false], ['desktop', 'light', true]]) {
  const phone = view === 'phone';
  const context = await browser.newContext({ viewport: { width: phone ? 390 : 1440, height: phone ? 844 : 900 },
    ...(phone ? { hasTouch: true, userAgent: ANDROID_UA } : {}), locale: 'zh-CN', colorScheme: theme });
  const page = await context.newPage();
  const tag = `${view}-${theme}${saved ? '-saved' : ''}`;
  try {
    await page.addInitScript(initScript, { theme });
    await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
    await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 15000 });
    await page.evaluate(({ alias, fallback, saved }) => {
      const t0 = Date.now() - 120000;
      const rows = [{ task_id: 'task-secret', from_name: 'tester', to_name: alias, content: '我有一个新的 GITHUB 秘钥给我存一下',
        result: `🔑 ${fallback}，不要把它直接发在聊天里。（看不到卡片时：到这个 AI 的「设置 → 密钥」里添加 GITHUB_TOKEN）`,
        status: 'replied', created_at: new Date(t0).toISOString(), completed_at: new Date(t0 + 5000).toISOString(),
        meta_json: JSON.stringify({ reply_secret_request: { node_id: 'n_fixture', key: 'GITHUB_TOKEN', label: 'GitHub 密钥', hint: '粘贴新的 GitHub token，提交后我能用，但不会在聊天里显示。' } }) }];
      if (saved) rows.unshift({ task_id: 'task-saved', from_name: 'tester', to_name: alias,
        content: '🔑 已在卡片里保存「GitHub 密钥」（GITHUB_TOKEN），下次启动后作为环境变量 GITHUB_TOKEN 可用。',
        result: '好的，重启后我就能用 GITHUB_TOKEN 了。', status: 'replied', created_at: new Date(t0 + 60000).toISOString() });
      window.__chatTasksFixture = rows;
      window.__chatTasksPaged = true;
    }, { alias: A, fallback: FALLBACK, saved });
    await page.evaluate(alias => window.__anetLayoutSweep.setScreen({ name: 'chat', alias }), A);
    const card = page.getByTestId('chat-secret-GITHUB_TOKEN');
    const shown = await card.waitFor({ timeout: 8000 }).then(() => true, () => false);
    ck(`${tag}: card renders in the reply bubble`, shown);
    const fallbackVisible = await page.getByText(FALLBACK, { exact: false }).first().isVisible().catch(() => false);
    ck(`${tag}: fallback text hidden when the card renders`, shown && !fallbackVisible);
    if (saved) {
      ck(`${tag}: later 已保存 message ⇒ card shows saved`, await page.getByTestId('chat-secret-GITHUB_TOKEN-saved').isVisible().catch(() => false));
    } else {
      const input = page.getByTestId('chat-secret-GITHUB_TOKEN-input');
      await input.fill('ghp_fixture_value');
      ck(`${tag}: input masked by default`, (await input.getAttribute('type')) === 'password');
      await page.getByTestId('chat-secret-GITHUB_TOKEN-reveal').click();
      ck(`${tag}: eye reveals`, (await input.getAttribute('type')) !== 'password');
      await page.getByTestId('chat-secret-GITHUB_TOKEN-reveal').click();
      ck(`${tag}: value never rendered as text`, !(await page.getByText('ghp_fixture_value').first().isVisible().catch(() => false)));
    }
    if (out) await page.screenshot({ path: `${out}/${tag}.png` });
  } catch (e) {
    ck(`${tag}: drive error`, false, { error: String(e).slice(0, 300) });
  } finally { await context.close(); }
}
await browser.close(); web.close?.();
console.log(`chat-secret-card: ${p}/${n} passed`);
process.exit(p === n ? 0 : 1);
