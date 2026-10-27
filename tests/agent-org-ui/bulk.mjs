import { run, cases } from './harness.mjs';

const matrix = [...cases, ...['light', 'dark'].map(theme => ({ name: `desktop-${theme}-scale150`, theme, width: 1280, height: 900, scale: 1.5 }))];

await run(new URL('./artifacts/bulk/', import.meta.url).pathname, async ({ c, page, test, shot, navigate, state, mode }) => {
  if (!(await state()).bulkConfirmExported) throw new Error('Current dist entry lacks agent-org-bulk-confirm; not waiting or building.');
  const el = id => page.getByTestId(`agent-org-${id}`);
  const rows = () => page.locator('[data-testid^="agent-org-agent-original-"]:not([data-testid$="-label"])');
  const writes = async () => (await state()).writes;
  const ids = entries => entries.map(w => decodeURIComponent(w.path.split('/').at(-2))).sort();
  const expected = (start, length) => Array.from({ length }, (_, i) => `original-${String(start + i).padStart(3, '0')}`);
  const settled = async () => {
    await page.waitForFunction(() => document.querySelector('[data-testid="agent-org-demo-result"]')?.textContent.includes('失败'));
  };
  const select = async query => {
    await el('member-search').fill(query);
    await el('bulk-assign').click(); await el('selector').waitFor();
    await el('selector-search').fill('station-a'); await el('bulk-dept-station-a').click();
    await el('bulk-confirm').waitFor();
  };
  const bounded = async id => {
    const b = await el(id).boundingBox();
    return b && b.x >= 0 && b.y >= 0 && b.x + b.width <= c.width + 1 && b.y + b.height <= c.height + 1;
  };
  const toolbarShot = async name => {
    await el('page').evaluate(e => { for (let n = e.parentElement; n; n = n.parentElement) n.scrollTop = 0; });
    await shot(name);
  };
  await navigate('agentTeams'); await el('tree').waitFor();
  test('full App toolbar summary and new button', (await el('summary').innerText()).includes('329') && await el('new-department').isVisible() && await bounded('department-actions'));
  test('info disclosure initially closed', await el('independent-note').count() === 0);
  await el('info-toggle').click();
  test('info disclosure reveals independent Agent location', await el('independent-note').isVisible());
  await el('info-toggle').click();
  await toolbarShot('toolbar-tree');
  if (c.phone) await el('dept-unassigned').click();
  test('first60 cap does not change 329 bulk scope', await rows().count() === 60 && (await el('bulk-count').innerText()).includes('329') && (await el('more').innerText()).includes('269'));
  test('bulk count outside compact button', await el('bulk-assign').getByTestId('agent-org-bulk-count').count() === 0 && await bounded('bulk-assign'));
  if (!c.phone) {
    const nav = await el('navigation').boundingBox(), tree = await el('tree').boundingBox();
    test('sidebar at most240 and approximately32percent', nav.width <= 240 && nav.width / (tree.width - 2) <= .325, { nav, tree });
  }
  if (c.scale) test('actual App scale simulation survives Settings window navigation', new URL(page.url()).searchParams.get('osFontScale') === '1.5' && await el('member-search').evaluate(e => parseFloat(getComputedStyle(e).fontSize) >= 18));
  await toolbarShot('toolbar-unassigned329');
  await el('member-list').evaluate(e => { e.scrollTop = e.scrollHeight; });
  test('member list actually scrolls', await el('member-list').evaluate(e => e.scrollTop > 0));
  await el('member-search').fill('original-328');
  await page.waitForFunction(() => document.querySelector('[data-testid="agent-org-member-list"]').scrollTop === 0);
  test('query resets member scroll and searches beyond cap', await el('agent-original-328').count() === 1 && await rows().count() === 1);
  await select('original-32');
  test('picking target opens explicit confirmation before any writes', (await writes()).length === 0 && (await el('bulk-confirm').innerText()).includes('Station Alpha') && (await el('bulk-confirm').innerText()).includes('9'));
  test('confirmation and pinned apply bounded', await bounded('bulk-confirm') && await bounded('bulk-confirm-apply'));
  await shot('confirmation-cancel');
  await el('bulk-confirm-close').click();
  await page.waitForTimeout(450);
  test('cancel confirmation produces zero mutations', (await writes()).length === 0 && (await state()).agents.every(a => a.department_id === null));
  await el('bulk-assign').click(); await el('selector').waitFor(); await page.keyboard.press('Escape');
  test('cancel department picker produces zero mutations', (await writes()).length === 0 && await el('selector').count() === 0);
  await select('original-328'); await page.keyboard.press('Escape');
  await el('bulk-confirm').waitFor({ state: 'hidden' });
  test('Escape confirmation produces zero mutations', (await writes()).length === 0);
  await select('original-328');
  test('single matching agent still requires explicit confirm', (await writes()).length === 0);
  await el('bulk-confirm-apply').click(); await settled();
  let s = await state();
  test('single bulk success exactly one chosen PUT', s.writes.length === 1 && ids(s.writes)[0] === 'original-328' && s.writes[0].status === 200 && s.writes[0].body.department_id === 'station-a' && s.agents[328].department_id === 'station-a', s.writes);
  await shot('single-success');
  // Change only the underlying search while the modal is open. No handler or
  // component state is patched: this exercises the real input's React onChange.
  await select('original-32');
  const snapshot = await el('bulk-confirm').innerText();
  await el('member-search').evaluate(e => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, 'original-31');
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  test('underlying filter changes but confirmation retains snapshot', await el('member-search').inputValue() === 'original-31' && (await el('bulk-count').innerText()).includes('10') && await el('bulk-confirm').innerText() === snapshot);
  await mode('failNodes=original-322,original-325');
  const before = (await writes()).length;
  test('filter change before confirm performs no writes', before === 1);
  await shot('confirmation-snapshot');
  await el('bulk-confirm-apply').click();
  await page.waitForFunction(() => /6.*2/.test(document.querySelector('[data-testid="agent-org-demo-result"]')?.textContent || ''));
  s = await state(); const batch = s.writes.slice(before);
  test('filtered snapshot exact nodeIDs despite later query', JSON.stringify(ids(batch)) === JSON.stringify(expected(320, 8)) && batch.every(w => w.method === 'PUT' && w.body.department_id === 'station-a'), batch);
  test('partial failure keeps failed nodes unassigned', batch.filter(w => w.status === 200).length === 6 && batch.filter(w => w.status === 500).length === 2 && s.agents[322].department_id === null && s.agents[325].department_id === null && expected(310, 10).every(id => s.agents.find(a => a.node_id === id).department_id === null));
  await el('member-search').fill('original-32');
  test('partial failure UI retains only failed matches', await rows().count() === 2 && await el('agent-original-322').count() === 1 && await el('agent-original-325').count() === 1 && /6.*2/.test(await el('demo-result').innerText()));
  await shot('partial-failure');
  // More than the visible60 must be captured, not merely rendered rows.
  await mode(''); await select('original-1');
  const capStart = (await writes()).length;
  test('100 matches beyond first60 await confirmation', await rows().count() === 60 && (await el('bulk-confirm').innerText()).includes('100') && capStart === 9);
  await el('bulk-confirm-apply').click();
  await page.waitForFunction(() => /100.*0/.test(document.querySelector('[data-testid="agent-org-demo-result"]')?.textContent || ''), null, { timeout: 20000 });
  s = await state();
  test('bulk covers all100 filtered IDs not just first60', JSON.stringify(ids(s.writes.slice(capStart))) === JSON.stringify(expected(100, 100)) && s.writes.slice(capStart).every(w => w.status === 200));
  await el('member-search').fill('');
  await el('member-list').evaluate(e => { e.scrollTop = e.scrollHeight; });
  if (c.phone) await el('back').click();
  await el('dept-station-a').click();
  test('department change resets scroll and query', await el('member-list').evaluate(e => e.scrollTop === 0) && await el('member-search').inputValue() === '' && (await el('member-count').innerText()).includes('107'));
  await navigate('agentTeams'); await el('tree').waitFor();
  test('bulk persisted aggregate counts after reload', await el('dept-unassigned-value').innerText() === '222' && await el('dept-tmai-value').innerText() === '107');
  if (c.phone) await el('dept-unassigned').click();
  await select('original-322'); const deniedStart = (await writes()).length;
  await mode('restricted=1'); await el('bulk-confirm-apply').click();
  await page.waitForFunction(() => /0.*1/.test(document.querySelector('[data-testid="agent-org-demo-result"]')?.textContent || ''));
  s = await state();
  test('revoked permission bulk403 no false success or mutation', s.writes.length === deniedStart + 1 && s.writes.at(-1).status === 403 && s.agents[322].department_id === null && await el('agent-original-322').count() === 1);
  await shot('permission-denied');
  await navigate('agentTeams'); await el('tree').waitFor(); await el('dept-tmai').click();
  test('department permissions still hide manage actions', await el('new-child').count() === 0 && await el('rename-department').count() === 0 && await el('reparent-department').count() === 0);
  test('no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  test('no unexpected mutation endpoints', (await state()).unhandled.length === 0);
}, matrix);
