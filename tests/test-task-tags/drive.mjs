import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = '/output'; mkdirSync(out, { recursive: true });
const common = { priority: 'normal', assignee: '', due: '', column: 'pool', createdAt: '2026-09-29', owner: null, agent_owner: null, participants: [], description: '', checklist: [], project_id: null, parent_id: null, children: { total: 0, done: 0 }, issues: [] };
let rows;
const reset = () => rows = [{ ...common, id: 'r1', name: 'Ship the onboarding improvements', tags: ['Design', '体验优化'] }, { ...common, id: 'r2', name: 'Review API documentation', tags: ['Docs'] }];
reset();
let reject = false;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://fixture').pathname;
  if (path.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'PATCH') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      if (reject) { res.statusCode = 400; res.end(JSON.stringify({ error: 'invalid_tags' })); return; }
      const row = rows.find(r => path.endsWith('/' + r.id));
      Object.assign(row, JSON.parse(raw)); res.end(JSON.stringify({ ok: true, requirement: row })); return;
    }
    res.end(JSON.stringify(path.endsWith('/tags') ? { tags: [...new Set(rows.flatMap(r => r.tags))] } : path.endsWith('/people') ? { people: [] } : path.endsWith('/projects') ? { projects: [] } : path === '/api/auth/me' ? { user: { id: 'u' } } : { requirements: rows, capabilities: ['tags', 'description', 'checklist', 'projects', 'sub_requirements'] })); return;
  }
  res.setHeader('Content-Type', path === '/app.js' ? 'text/javascript' : 'text/html');
  res.end(path === '/app.js' ? readFileSync('/output/task-language.js') : '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}#root{display:flex;height:100vh}</style><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const checks = []; const ck = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, detail || ''); };
// Painted box of a testID after clipping by every overflow ancestor — textContent survives a 0-wide element.
// Inline (not test-layout-sweep/harness.mjs) so this file still runs alone from a /spec mount.
const paintedBox = (page, id) => page.evaluate(id => {
  const el = document.querySelector(`[data-testid="${id}"]`); if (!el) return null;
  const b = el.getBoundingClientRect(); let w = b.width, h = b.height;
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    const c = getComputedStyle(a); if (c.overflowX === 'visible' && c.overflowY === 'visible') continue;
    const r = a.getBoundingClientRect();
    w = Math.min(w, Math.max(0, Math.min(b.right, r.right) - Math.max(b.left, r.left))); h = Math.min(h, Math.max(0, Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top)));
  }
  return { w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10, painted: w >= 8 && h >= 1 };
}, id);
try {
  for (const [name, width, height] of [['desktop', 1200, 800], ['phone', 390, 844]]) {
    reset();
    const page = await browser.newPage({ viewport: { width, height }, ...(name === 'phone' ? { isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36' } : {}) });
    page.setDefaultTimeout(10000);
    page.on('pageerror', e => console.error(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByText('Ship the onboarding improvements', { exact: true }).first().waitFor();
    const boxes = await page.getByTestId('task-tag-chips').evaluateAll(nodes => nodes.flatMap(n => [...n.children].map(ch => { const r = ch.getBoundingClientRect(); return { x: r.x, right: r.right, y: r.y, height: r.height }; })));
    ck(`${name} chips fit viewport`, boxes.length >= 3 && boxes.every(b => b.x >= 0 && b.right <= width && b.height >= 18), boxes);
    const pair = await page.getByTestId('task-tag-chips').filter({ hasText: 'Design' }).evaluate(n => [...n.children].map(ch => { const r = ch.getBoundingClientRect(); return { x: r.x, y: r.y, height: r.height }; }));
    ck(`${name} same card chips aligned`, pair.length === 2 && Math.abs(pair[0].y - pair[1].y) < 1 && pair[0].height === pair[1].height, pair);
    await page.screenshot({ path: `${out}/${name}-tags.png` });
    await page.getByText('Ship the onboarding improvements', { exact: true }).first().click();
    // #510: tags live inside the detail's collapsed 「更多」; the collapsed row names them, then it expands.
    const summary = (await page.getByTestId('req-more-summary').textContent()) || '';
    await page.getByTestId('req-more-summary').scrollIntoViewIfNeeded();
    const summaryBox = await paintedBox(page, 'req-more-summary');
    ck(`${name} collapsed 更多 summary counts the tags`, /\b2 tags\b|2 个标签/.test(summary) && !!summaryBox?.painted, { summary, painted: summaryBox });
    await page.getByTestId('req-more-toggle').click();
    await page.getByTestId('req-tag-input').fill('Release');
    await page.getByTestId('req-tag-input').press('Enter');
    await page.getByRole('button', { name: 'Remove tag Release', exact: true }).waitFor();
    ck(`${name} enter creates persisted tag`, rows[0].tags.includes('Release'));
    await page.getByTestId('req-tag-options').getByText('Docs', { exact: true }).click();
    await page.getByRole('button', { name: 'Remove tag Docs', exact: true }).waitFor();
    ck(`${name} chooses existing`, rows[0].tags.includes('Docs'));
    await page.getByRole('button', { name: 'Remove tag Docs', exact: true }).click();
    await page.getByRole('button', { name: 'Remove tag Docs', exact: true }).waitFor({ state: 'detached' });
    ck(`${name} removes tag`, !rows[0].tags.includes('Docs'));
    reject = true;
    await page.getByTestId('req-tag-input').fill('Rejected'); await page.getByTestId('req-tag-add').click();
    await page.getByRole('alert').filter({ hasText: 'Use up to 10 tags' }).waitFor();
    ck(`${name} rejected write not shown as saved`, !rows[0].tags.includes('Rejected'));
    reject = false;
    await page.getByTestId('req-tags').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/${name}-tag-editor.png` });
    await page.getByTestId('req-detail-close').click();
    if (name === 'desktop') await page.getByTestId('task-filter-tag-Docs').click();
    else { await page.getByTestId('task-tags-filter').click(); await page.getByTestId('task-tags-pick-Docs').click(); }
    ck(`${name} filters card`, await page.getByText('Ship the onboarding improvements', { exact: true }).count() === 0 && await page.getByText('Review API documentation', { exact: true }).count() === 1);
    await page.close();
  }
} finally {
  writeFileSync(`${out}/measurements.json`, JSON.stringify(checks, null, 2));
  await browser.close(); server.close();
}
console.log(`${checks.filter(c => c.ok).length}/${checks.length}`);
if (checks.some(c => !c.ok)) process.exit(1);
