// Actual exported App, synthetic Hub responses only. Not real Hub/native IPC acceptance.
// Runs in the existing user-avatar Docker suite, after its atomic and settings gates.
import assert from 'node:assert/strict';
import { serveExport, initScript, ANDROID_UA, TEST_LOCALE } from '../test-layout-sweep/harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
assert(process.env.WEB_DIR, 'WEB_DIR is required');
const web = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const humanUrl = 'http://avatar-fixture.invalid/human.png';
const nodeUrl = 'http://avatar-fixture.invalid/node.png';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1cAAAAASUVORK5CYII=', 'base64');
let count = 0;
const check = (name, ok) => { assert(ok, name); count++; console.log('PASS', name); };
try {
  for (const width of [390, 1320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: TEST_LOCALE,
      ...(width === 390 ? { userAgent: ANDROID_UA, isMobile: true, hasTouch: true } : {}) });
    await context.route('http://avatar-fixture.invalid/**', route => route.fulfill({ contentType: 'image/png', body: png }));
    await context.addInitScript(initScript, { theme: 'light' });
    await context.addInitScript(({ humanUrl, nodeUrl }) => {
      const person = { user_id: 'u-peer', username: '示例-A', display_name: 'Avatar peer', avatar_url: humanUrl };
      window.__routeOverride = (u) => {
        if (u.pathname.endsWith('/humans')) return { ok: true, humans: [person] };
        if (u.pathname === '/api/dm/threads') return { ok: true, threads: [] };
        if (u.pathname === '/api/dm') return { ok: true, messages: [{ message_id: 'dm-avatar-fixture', content: 'DM avatar fixture',
          direction: 'in', from_session: person.username, acked: 1, created_at: new Date().toISOString() }] };
        if (u.pathname === '/api/nodes') return { ok: true, nodes: [{ node_id: 'n_sweep_a', alias: person.username, avatar_url: nodeUrl }] };
      };
    }, { humanUrl, nodeUrl });
    const page = await context.newPage();
    await page.goto(web.url);
    const row = page.getByTestId('person-row-示例-A').first();
    await row.waitFor({ timeout: 30000 });
    const listImage = await row.locator('[style*="background-image"]').first().evaluate(el => el.style.backgroundImage);
    check(`${width}: person list renders Hub human avatar`, listImage.includes(humanUrl));
    await row.click();
    await page.getByTestId('dm-pane').waitFor();
    await page.getByText('DM avatar fixture', { exact: true }).waitFor();
    for (const id of ['dm-peer-avatar-image', 'dm-incoming-avatar-image']) {
      const picture = page.getByTestId(id).first();
      await picture.waitFor();
      const value = await picture.locator('[style*="background-image"]').first().evaluate(el => el.style.backgroundImage);
      const expected = process.env.TEST_DM_WRONG_AVATAR_EXPECTATION === '1' ? nodeUrl : humanUrl;
      check(`${width}: ${id} uses user avatar, not same-name Agent`, !!value && value.includes(expected) && !value.includes(nodeUrl));
      const loaded = await page.evaluate(url => new Promise(resolve => {
        const image = new Image(); image.onload = () => resolve(image.naturalWidth > 0); image.onerror = () => resolve(false); image.src = url;
      }), humanUrl);
      check(`${width}: ${id} actual image decodes`, loaded);
    }
    check(`${width}: DM layout has no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await context.close();
  }
  console.log(`${count}/${count} DM avatar checks passed`);
} finally {
  await browser.close(); web.close();
}
