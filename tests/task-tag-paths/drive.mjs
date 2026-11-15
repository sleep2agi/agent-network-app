// 管理员 2026-11-15「这个地方是不是显示标签树比较好,TMWork/xxx/xxx 类似这样」:任务详情的「标签」。
//
// 渲染态 web export + 页内 Hub fixture。断言:
//   ① 一行一条路径(根 → 叶),例如「TMWork / TMWork客户端 / 飞书」
//   ② 卡上也挂着的祖先(TMWork、TMWork客户端)不再单独占一行
//   ③ 没有父子的标签照旧一行一个
//   ④ × 删掉的是这一行的叶子(PATCH 里少了「飞书」,祖先还在),之后祖先那条路径自己成一行
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const OUT = process.env.OUT_DIR || '/tmp/task-tag-paths';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--no-sandbox'] });

const fixture = () => {
  const common = { priority: 'high', assignee: '', due: '', column: 'pool', createdAt: '2026-11-14', owner: null, agent_owner: null, participants: [], description: '', checklist: [], project_id: null, parent_id: null, children: { total: 0, done: 0 }, issues: [] };
  const row = { ...common, id: 'r1', name: 'TMWork客户端 managed 开启', tags: ['TMWork客户端', 'TMWork', '安全', '飞书', '部署'] };
  const tags = ['TMWork', 'TMWork客户端', '飞书', '安全', '部署'];
  window.__patches = [];
  window.__routeOverride = (u, body, method) => {
    const p = u.pathname;
    if (p === '/api/requirements/tags') return { ok: true, tags, counts: { TMWork: 3, TMWork客户端: 2, 飞书: 1, 安全: 1, 部署: 1 }, parents: { TMWork客户端: 'TMWork', 飞书: 'TMWork客户端' } };
    if (p === '/api/requirements/r1' && method === 'PATCH') { const patch = JSON.parse(body || '{}'); window.__patches.push(patch); Object.assign(row, patch); return { ok: true, requirement: row }; }
    if (p === '/api/requirements/r1') return { ok: true, requirement: row };
    if (p === '/api/requirements') return { ok: true, requirements: [row], capabilities: ['tags', 'projects', 'sub_requirements', 'description', 'checklist'] };
    if (p === '/api/requirements/projects') return { ok: true, projects: [] };
    if (p === '/api/requirements/people') return { ok: true, people: [] };
    return undefined;
  };
};

const results = [];
const record = (name, ok, detail) => { results.push(ok); console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ' ' + JSON.stringify(detail)}`); };
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1200, height: 820 }, colorScheme: theme });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(initScript, { theme });
  await page.addInitScript(fixture);
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.locator('[data-testid="desktop-rail"]').waitFor({ timeout: 20000 });
  await page.getByRole('tab', { name: '任务', exact: true }).click();
  await page.getByText('TMWork客户端 managed 开启', { exact: true }).first().click();
  await page.locator('[data-testid="req-tag-paths"]').waitFor();
  await page.waitForTimeout(500);
  await page.locator('[data-testid="req-tags"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/tag-paths-${theme}.png` });
  const rows = await page.$$eval('[data-testid^="req-tag-path-"]', els => els.map(e => [e.getAttribute('data-testid').slice('req-tag-path-'.length), e.textContent]));
  if (theme === 'light') {
    const feishu = rows.find(r => r[0] === '飞书');
    record('① 一行一条路径:TMWork / TMWork客户端 / 飞书', !!feishu && feishu[1].includes('TMWork / TMWork客户端 / 飞书'), rows);
    record('② 卡上的祖先不再单独占一行', !rows.some(r => r[0] === 'TMWork' || r[0] === 'TMWork客户端'), rows);
    record('③ 没有父子的标签一行一个', rows.some(r => r[0] === '安全') && rows.some(r => r[0] === '部署') && rows.length === 3, rows);
    await page.locator('[data-testid="req-tag-remove-飞书"]').click();
    await page.waitForTimeout(600);
    const patches = await page.evaluate(() => window.__patches);
    const last = patches[patches.length - 1]?.tags ?? [];
    record('④ × 删的是叶子「飞书」,祖先还在', !last.includes('飞书') && last.includes('TMWork客户端') && last.includes('TMWork'), patches);
    const after = await page.$$eval('[data-testid^="req-tag-path-"]', els => els.map(e => e.getAttribute('data-testid').slice('req-tag-path-'.length)));
    record('④ 之后「TMWork / TMWork客户端」自己成一行', after.includes('TMWork客户端') && !after.includes('TMWork'), after);
  }
  record(`${theme}: 无页面报错`, errors.length === 0, errors);
  await ctx.close();
}
await browser.close();
web.close?.();
const p = results.filter(Boolean).length, t = results.length;
console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
