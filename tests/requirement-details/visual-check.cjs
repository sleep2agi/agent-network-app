const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const assert = require('node:assert/strict');

const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/app.js' ? readFileSync('/output/visual-entry.js') : '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;background:#111113}#root{display:flex;height:100vh}</style><div id="root"></div><script src="/app.js"></script></html>');
});
(async () => {
  await new Promise(resolve => server.listen(8080, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    for (const [name, width, height] of [['desktop', 1280, 800], ['mobile', 390, 844]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      page.on('pageerror', error => console.error('PAGE ERROR', error.message));
      page.setDefaultTimeout(10000);
      let writes = 0;
      const card = { id: 'r1', name: '上线前检查项目管理体验与多端协作', priority: 'high', assignee: '设计负责人', due: '2026-10-01', column: 'pool', createdAt: '2026-09-28' };
      await page.route('**/api/requirements**', async route => {
        if (route.request().method() === 'PATCH') {
          writes++;
          card.column = route.request().postDataJSON().column;
          await route.fulfill({ json: { requirement: card } });
        } else await route.fulfill({ json: { requirements: [card] } });
      });
      await page.goto('http://127.0.0.1:8080');
      await page.getByTestId('req-card-r1').click();
      await page.getByTestId('req-detail').waitFor();
      assert.equal(writes, 0, 'opening details must not write');
      const box = await page.getByTestId('req-detail').boundingBox();
      assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height, 'detail fits viewport');
      // RN Web's Modal uses a 300 ms entrance animation; inspect the settled UI.
      await page.waitForTimeout(350);
      await page.screenshot({ path: `/output/${name}-details.png` });
      await page.getByTestId('req-move-doing').click();
      await page.getByText('当前：进行中', { exact: true }).waitFor();
      assert.equal(writes, 1);
      await page.getByTestId('req-detail-close').click();
      await page.getByTestId('req-detail').waitFor({ state: 'hidden' });
      console.log(`PASS ${name}: open without write, dialog fits, explicit move, close`);
      await page.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
