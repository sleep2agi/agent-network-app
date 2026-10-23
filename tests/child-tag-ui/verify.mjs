import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from './server.mjs';

const out = resolve(dirname(fileURLToPath(import.meta.url)), 'artifacts');
mkdirSync(out, { recursive: true });
const modulePath = process.env.PLAYWRIGHT_MODULE || '/Users/vansin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(modulePath).href);
const { server, url } = await startServer();
const browser = await chromium.launch({ headless: true, executablePath: existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined });
const results = [], screenshots = [], errors = [], blocked = [];
const state = async () => (await fetch(`${url}__fixture/state`)).json();
const control = async query => fetch(`${url}__fixture/${query}`, { method: 'POST' });
const matrix = [
  { name: 'desktop-light', width: 1440, height: 900, theme: 'light', language: 'zh-CN' },
  { name: 'mobile-light', width: 390, height: 844, theme: 'light', language: 'zh-CN', phone: true },
  { name: 'desktop-dark-en', width: 1440, height: 900, theme: 'dark', language: 'en' },
  { name: 'mobile-dark-en', width: 390, height: 844, theme: 'dark', language: 'en', phone: true },
];
try {
  for (const c of matrix) {
    await control('reset');
    const context = await browser.newContext({ viewport: { width: c.width, height: c.height }, colorScheme: c.theme, locale: c.language, serviceWorkers: 'block', ...(c.phone ? { hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36' } : {}) });
    await context.route('**/*', route => { if (new URL(route.request().url()).origin !== new URL(url).origin) { blocked.push(route.request().url()); return route.abort(); } return route.continue(); });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', e => errors.push({ case: c.name, message: e.message }));
    const el = id => page.getByTestId(id);
    const check = (name, ok, detail) => { results.push({ case: c.name, name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${c.name} ${name}`); assert(ok, name); };
    const shot = async name => { await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(200); const path = resolve(out, `${c.name}-${name}.png`); await page.screenshot({ path }); screenshots.push(path); };
    const navigate = async () => {
      await page.goto(`${url}?theme=${c.theme}&language=${c.language}&safeAreaSim=${c.phone ? '32,0,24,0' : '0,0,0,0'}`);
      if (c.phone) await page.getByText(c.language === 'en' ? 'Tasks' : '任务', { exact: true }).last().click();
      else await page.locator(`[data-testid="desktop-rail"] [aria-label="${c.language === 'en' ? 'Tasks' : '任务'}"]`).click();
      await el('requirement-board').waitFor();
      await el('req-new').waitFor();
      check('full App task navigation and local Hub data', (await state()).requests.some(r => r.path === '/api/requirements'));
    };
    const menu = async (expectCreation = true) => {
      if (c.phone) {
        await el('task-tags-filter').click();
        const box = await el('task-tags-pick-ANet').boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
      } else await el('task-filter-tag-ANet').click({ button: 'right' });
      await el('side-menu').waitFor();
      if (expectCreation) await el('side-menu-createChild').waitFor();
    };
    const open = async () => { await menu(); await el('side-menu-createChild').click(); await el('tag-create-dialog').waitFor(); };
    const manager = async () => {
      if (c.phone) { await el('task-tags-filter').click(); await el('task-tags-manage').click(); }
      else await el('task-side-manage-tags').click();
      await el('tag-manager').waitFor();
    };
    const filter = async tag => {
      if (c.phone) { await el('task-tags-filter').click(); await el(`task-tags-pick-${tag}`).click(); }
      else await el(`task-filter-tag-${tag}`).click();
    };
    const verifyParentFilter = async tree => {
      await el('tasks-view-list').click();
      await el('req-row-unrelated-task').waitFor();
      await filter('ANet');
      await el('req-row-unrelated-task').waitFor({ state: 'hidden' });
      await el('req-row-fixture-task').waitFor();
      if (tree) { await el('req-row-child-task').waitFor(); await el('req-row-grandchild-task').waitFor(); }
      else { await el('req-row-child-task').waitFor({ state: 'hidden' }); await el('req-row-grandchild-task').waitFor({ state: 'hidden' }); }
      check(tree ? 'parent filter includes child and grandchild, excludes unrelated task' : 'legacy flat parent filter matches only its direct task', await el('req-row-fixture-task').isVisible() && await el('req-row-child-task').count() === (tree ? 1 : 0) && await el('req-row-grandchild-task').count() === (tree ? 1 : 0) && await el('req-row-unrelated-task').count() === 0);
      await shot(tree ? 'parent-descendant-filter' : 'legacy-flat-filter');
      await filter('all'); await el('req-row-unrelated-task').waitFor();
      check('clearing parent filter restores all four tasks without writes', await el('req-row-fixture-task').isVisible() && await el('req-row-child-task').isVisible() && await el('req-row-grandchild-task').isVisible() && (await state()).writes.length === 0 && (await state()).unhandled.length === 0);
    };
    try {
      await navigate(); await verifyParentFilter(true); await open();
      check('menu opens child dialog with parent preselected', await el('tag-create-parent-ANet').getAttribute('aria-pressed') === 'true');
      check('localized title', await el('tag-create-dialog-title').innerText() === (c.language === 'en' ? 'Create child tag' : '新建子标签'));
      const geometry = await el('tag-create-dialog').evaluate(e => {
        const box = n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, height: r.height }; };
        const list = document.querySelector('[data-testid="tag-create-parents"]');
        return { dialog: box(e), footer: box(document.querySelector('[data-testid="tag-create-dialog-footer"]')), list: box(list), scroll: list.scrollHeight > list.clientHeight + 10, overflow: getComputedStyle(list).overflowY };
      });
      check('bounded dialog, scrolling parent list, pinned visible footer', geometry.dialog.x >= 0 && geometry.dialog.y >= 0 && geometry.dialog.right <= c.width && geometry.dialog.bottom <= c.height && geometry.list.height <= 217 && geometry.scroll && /auto|scroll/.test(geometry.overflow) && geometry.footer.y >= geometry.list.bottom && geometry.footer.bottom <= geometry.dialog.bottom, geometry);
      await shot('preselected-parent');
      await el('tag-create-parent-search').fill('pArEnT-39');
      check('case-insensitive bounded parent search', await el('tag-create-parent-Parent-39').count() === 1 && await el('tag-create-parent-ANet').count() === 0 && await el('tag-create-parent-root').count() === 1);
      await el('tag-create-parent-Parent-39').click();
      check('parent search selection', await el('tag-create-parent-Parent-39').getAttribute('aria-pressed') === 'true');
      await el('tag-create-name').fill('Cancelled child'); await el('tag-create-cancel').click();
      await el('tag-create-dialog').waitFor({ state: 'hidden' });
      check('cancel and parent selection make zero writes', (await state()).writes.length === 0);
      await open(); await el('tag-create-name').fill('  Exact Child  '); await el('tag-create-submit').click();
      await el('tag-create-dialog').waitFor({ state: 'hidden' });
      let s = await state();
      check('exactly one scoped atomic name/parent POST', s.writes.length === 1 && s.writes[0].method === 'POST' && s.writes[0].path === '/api/requirements/tags/create' && s.writes[0].query === '?network_id=net-fixture' && JSON.stringify(s.writes[0].body) === JSON.stringify({ name: 'Exact Child', parent_id: 'ANet' }) && s.writes[0].status === 201, s.writes);
      check('child has zero tasks and parent attachment', s.nodes.some(n => n.name === 'Exact Child' && n.count === 0 && n.parent_id === 'ANet' && n.depth === 2) && s.requirements.every(r => !r.tags.includes('Exact Child')));
      if (!c.phone) { await el('task-filter-tag-Exact Child').waitFor(); check('zero-task child immediately discoverable in sidebar', true); }
      await navigate(); await manager();
      await el('tag-usage-Exact Child').waitFor();
      check('zero-task child discoverable after full reload in manager', (await el('tag-usage-Exact Child').innerText()).startsWith('0'));
       await shot('zero-task-child');
       if (c.phone) { await el('tag-row-ANet').click(); await el('tag-action-createChild').click(); }
       else await el('tag-create-child-ANet').click();
       await el('tag-create-dialog').waitFor();
       check('manager child action opens with source parent preselected', await el('tag-create-parent-ANet').getAttribute('aria-pressed') === 'true');
       await el('tag-create-cancel').click();
      for (const status of [403, 404, 409]) {
        await control(`mode?status=${status}`); await open();
        const name = `Error child ${status}`;
        await el('tag-create-name').fill(name); await el('tag-create-submit').click();
        await el('tag-create-error').waitFor();
        const expected = c.language === 'en' ? ({ 403: "You don't have permission to manage tags.", 404: 'The parent tag is missing or unavailable. Refresh the catalog.', 409: 'A tag with this name already exists. Choose another name.' })[status] : ({ 403: '你没有管理标签的权限。', 404: '父标签不存在或不可用，请刷新目录。', 409: '已存在同名标签，请使用其他名称。' })[status];
        s = await state();
        check(`${status} localized inline error retains input and makes no catalog change`, await el('tag-create-error').innerText() === expected && await el('tag-create-name').inputValue() === name && s.writes.at(-1).status === status && s.nodes.every(n => n.name !== name), s.writes.at(-1));
        await shot(`error-${status}`); await el('tag-create-cancel').click();
      }
      check('one success plus exactly three failed attempts; no other writes', (await state()).writes.length === 4 && (await state()).unhandled.length === 0);
      await control('reset?old=1'); await navigate(); await verifyParentFilter(false);
      if (!c.phone) {
        const padding = await Promise.all(['ANet', 'Seed Child', 'Seed Grandchild'].map(tag => el(`task-filter-tag-${tag}`).evaluate(e => getComputedStyle(e).paddingLeft)));
        check('legacy tags retain equal flat indentation', new Set(padding).size === 1, padding);
      }
      await menu(false);
      check('old Hub hides child creation but preserves rename/color/delete', await el('side-menu-createChild').count() === 0 && await el('side-menu-rename').isVisible() && await el('side-menu-color').isVisible() && await el('side-menu-delete').isVisible());
      await shot('old-hub-menu'); await el('side-menu-scrim').click({ position: { x: 1, y: 1 } });
      await el('side-menu').waitFor({ state: 'hidden' }); await manager();
      check('old Hub manager hides creation and retains flat tag entries', await el('tag-manager-create').count() === 0 && await el('tag-name-ANet').count() === 1 && await el('tag-name-Seed Child').count() === 1 && await el('tag-name-Seed Grandchild').count() === 1);
      check('old Hub browsing makes zero writes and opens no create dialog', (await state()).writes.length === 0 && (await state()).unhandled.length === 0 && await el('tag-create-dialog').count() === 0);
      await shot('old-hub-flat-manager');
      check('no horizontal document overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    } catch (e) {
      results.push({ case: c.name, name: 'scenario completed', ok: false, detail: e.stack }); console.error(e.stack);
      await shot('failure'); writeFileSync(resolve(out, `${c.name}-failure.txt`), await page.locator('body').innerText());
    } finally { writeFileSync(resolve(out, `${c.name}-state.json`), JSON.stringify(await state(), null, 2)); await context.close(); }
  }
  results.push({ name: 'No uncaught App errors', ok: errors.length === 0, detail: errors }, { name: 'No external browser requests', ok: blocked.length === 0, detail: blocked });
} finally {
  const s = await state(); await browser.close(); await new Promise(r => server.close(r));
  writeFileSync(resolve(out, 'report.json'), JSON.stringify({ results, errors, blocked, screenshots, assets: s.assets, indexSha256: s.indexSha256 }, null, 2));
}
console.log(`${results.filter(r => r.ok).length}/${results.length} checks passed; ${screenshots.length} screenshots`);
process.exitCode = results.some(r => !r.ok) ? 1 : 0;
