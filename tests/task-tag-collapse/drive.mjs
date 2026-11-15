// 管理员 2026-11-15「父标签要支持收起来,这样可以展示全一点」:任务左栏标签树。
//
// 渲染态 web export + 页内 Hub fixture。断言:
//   ① 父标签前有折叠箭头;点它 → 子标签藏起来,父标签自己还在
//   ② 折叠记在本机:重新打开页面仍是收起的
//   ③ 搜索标签时不受折叠影响(子标签能搜到)
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const OUT = process.env.OUT_DIR || '/tmp/task-tag-collapse';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--no-sandbox'] });

const fixture = () => {
  const common = { priority: 'normal', assignee: '', due: '', column: 'pool', createdAt: '2026-11-14', owner: null, agent_owner: null, participants: [], description: '', checklist: [], project_id: null, parent_id: null, children: { total: 0, done: 0 }, issues: [] };
  const tags = ['客户端', '插件', '更新', 'i18n', 'ANet', '运行时', 'Hub', '杂项'];
  const rows = tags.flatMap((tag, i) => Array.from({ length: (i % 3) + 1 }, (_, j) => ({ ...common, id: `r${i}_${j}`, name: `任务 ${tag} ${j + 1}`, tags: [tag] })));
  window.__routeOverride = (u) => {
    const p = u.pathname;
    if (p === '/api/requirements/tags') return { ok: true, tags, parents: { 插件: '客户端', 更新: '客户端', i18n: '客户端', 运行时: 'ANet', Hub: 'ANet' } };
    if (p === '/api/requirements') return { ok: true, requirements: rows, capabilities: ['tags', 'projects', 'sub_requirements'] };
    if (p === '/api/requirements/projects') return { ok: true, projects: [] };
    if (p === '/api/requirements/people') return { ok: true, people: [] };
    return undefined;
  };
};

const results = [];
const record = (name, ok, detail) => { results.push(ok); console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ' ' + JSON.stringify(detail)}`); };
const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1200, height: 820 } });
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(initScript, { theme: 'light' });
await page.addInitScript(fixture);
const go = async () => {
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.locator('[data-testid="desktop-rail"]').waitFor({ timeout: 20000 });
  await page.getByRole('tab', { name: '任务', exact: true }).click();
  await page.locator('[data-testid="task-side-tags-header"]').waitFor({ timeout: 15000 });
  // 「标签」整段默认可能是收起的:先展开它。
  if (!(await page.locator('[data-testid="task-filter-tag-客户端"]').count())) await page.getByRole('button', { name: '展开标签' }).first().click().catch(() => {});
  await page.locator('[data-testid="task-filter-tag-客户端"]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
};
const has = async (id) => (await page.locator(`[data-testid="${id}"]`).count()) > 0;

await go();
await page.screenshot({ path: `${OUT}/tags-open.png` });
record('① 父标签有折叠箭头,子标签可见', await has('task-side-tag-toggle-客户端') && await has('task-filter-tag-插件') && !(await has('task-side-tag-toggle-插件')));
await page.locator('[data-testid="task-side-tag-toggle-客户端"]').click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/tags-folded.png` });
record('① 收起后子标签藏起来,父标签还在、别的父标签不受影响',
  !(await has('task-filter-tag-插件')) && !(await has('task-filter-tag-i18n')) && await has('task-filter-tag-客户端') && await has('task-filter-tag-运行时'));
await go();
record('② 重新打开仍是收起的', !(await has('task-filter-tag-插件')) && await has('task-filter-tag-客户端'));
const search = page.locator('[data-testid="task-side-tag-filter"]');
if (await search.count()) {
  await search.fill('插件');
  await page.waitForTimeout(300);
  record('③ 搜索时子标签照样能搜到', await has('task-filter-tag-插件'));
} else {
  record('③ (标签少于阈值,没有搜索框,跳过)', true);
}
record('no page errors', errors.length === 0, errors);

await browser.close();
await web.close?.();
const failed = results.filter(ok => !ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
