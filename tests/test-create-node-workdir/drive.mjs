// 新建节点向导「工作目录」一行的真浏览器测量(web export + tests/test-layout-sweep 的页内 Tauri 桩,
// 不起 hub、不占端口、不碰 HOME)。占位数据:守护 示例-守护,根目录 /home/alice。
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] \
//     node tests/test-create-node-workdir/drive.mjs
//
// 断言(每个视口):
//   (1) 新行与其余确认行:左边、右边、key 的 x、值的右边缘 各 ±1px;行高与单行确认行一致 ±1px
//   (2) 「改」按钮与值文字共一条中线 ±1px,且在卡片内
//   (3) 展开后输入框左右边与行内容区(key 左边 / 值右边)对齐 ±1px
//   (4) 老 daemon(无 default_workdir_root):没有这一行
// 任一断言失败或页面打不开 → exit 1。
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const DAEMON = { daemon_node_id: 'd_sweep_1', alias: '示例-守护', hostname: 'host-d', online: true, runtimes_supported: ['claude-agent-sdk'], can_create_nodes: true, default_workdir_root: '/home/alice' };
const OLD_DAEMON = { ...DAEMON, default_workdir_root: undefined };
const VIEWPORTS = [{ name: 'desktop-1200x800', w: 1200, h: 800 }, { name: 'phone-390x844', w: 390, h: 844, mobile: true }];

let fails = 0;
const ck = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`); };
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
const r1 = (n) => Math.round(n * 10) / 10;

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
const table = [];

async function openConfirm(page, daemon) {
  await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 15000 });
  // 先切到别的页,保证向导重新挂载、从第一步开始
  await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'agents' }));
  await page.evaluate((d) => window.__anetLayoutSweep.setScreen({ name: 'wizard', daemon: d }), daemon);
  await page.getByPlaceholder('例如 my-agent-1').fill('demo-agent');
  for (let i = 0; i < 4; i++) await page.getByText('下一步', { exact: true }).click();
  await page.getByText('确认', { exact: true }).first().waitFor({ timeout: 5000 });
}

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, ...(vp.mobile ? { userAgent: ANDROID_UA, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const page = await ctx.newPage();
  await page.addInitScript(initScript, { theme: 'light' });
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  try {
    await openConfirm(page, DAEMON);
    const row = page.locator('[data-testid="create-workdir-row"]');
    await row.waitFor({ timeout: 5000 });
    const val = await page.locator('[data-testid="create-workdir-value"]').textContent();
    ck(`${vp.name}: default = <root>/<name>`, val === '/home/alice/demo-agent', val);

    // 其余确认行:与新行同一个 summaryRow 样式;按 key 文字定位
    const cardLoc = row.locator('xpath=..');
    const geom = async (keyText, rowLoc) => {
      const key = cardLoc.getByText(keyText, { exact: true }).first();
      const kb = await key.boundingBox();
      const rb = await (rowLoc ?? key.locator('xpath=..')).boundingBox();
      const vb = await (rowLoc ? page.locator('[data-testid="create-workdir-value"]') : key.locator('xpath=following-sibling::*[1]')).boundingBox();
      return { row: rb, key: kb, val: vb };
    };
    const refs = { 服务器: await geom('服务器'), 名字: await geom('名字'), 模型: await geom('模型') };
    const mine = await geom('工作目录', row);
    const edit = await page.locator('[data-testid="create-workdir-edit"]').boundingBox();
    const card = await cardLoc.boundingBox();
    const ref = refs.名字;
    for (const [k, g] of Object.entries(refs)) {
      table.push({ vp: vp.name, row: k, rowX: r1(g.row.x), rowRight: r1(g.row.x + g.row.width), keyX: r1(g.key.x), valRight: r1(g.val.x + g.val.width), rowH: r1(g.row.height), keyCY: r1(g.key.y + g.key.height / 2 - g.row.y) });
    }
    table.push({ vp: vp.name, row: '工作目录', rowX: r1(mine.row.x), rowRight: r1(mine.row.x + mine.row.width), keyX: r1(mine.key.x), valRight: r1(mine.val.x + mine.val.width), rowH: r1(mine.row.height), keyCY: r1(mine.key.y + mine.key.height / 2 - mine.row.y), editRight: r1(edit.x + edit.width) });
    ck(`${vp.name}: row left edge == other rows`, near(mine.row.x, ref.row.x), `${r1(mine.row.x)} vs ${r1(ref.row.x)}`);
    ck(`${vp.name}: row right edge == other rows`, near(mine.row.x + mine.row.width, ref.row.x + ref.row.width));
    ck(`${vp.name}: key x == other rows' key x`, near(mine.key.x, ref.key.x), `${r1(mine.key.x)} vs ${r1(ref.key.x)}`);
    ck(`${vp.name}: key vertical offset in row == other rows`, near(mine.key.y - mine.row.y, ref.key.y - ref.row.y));
    ck(`${vp.name}: row height == single-line row height`, near(mine.row.height, ref.row.height), `${r1(mine.row.height)} vs ${r1(ref.row.height)}`);
    // 值列右边 + gap + 「改」 == 其他行的值右边缘(同一 padding):「改」的右边缘贴在同一条右线上
    ck(`${vp.name}: 「改」 right edge == other rows' value right edge`, near(edit.x + edit.width, ref.val.x + ref.val.width), `${r1(edit.x + edit.width)} vs ${r1(ref.val.x + ref.val.width)}`);
    ck(`${vp.name}: 「改」 shares the value's centre line`, near(edit.y + edit.height / 2, mine.val.y + mine.val.height / 2), `${r1(edit.y + edit.height / 2)} vs ${r1(mine.val.y + mine.val.height / 2)}`);
    ck(`${vp.name}: 「改」 inside the card`, edit.x >= card.x && edit.x + edit.width <= card.x + card.width + 0.5);
    ck(`${vp.name}: value does not overlap 「改」`, mine.val.x + mine.val.width <= edit.x + 0.5);
    if (OUT) await page.screenshot({ path: `${OUT}/${vp.name}-confirm.png` });

    await page.locator('[data-testid="create-workdir-edit"]').click();
    const input = page.locator('[data-testid="create-workdir-input"]');
    await input.waitFor({ timeout: 3000 });
    const ib = await input.boundingBox();
    ck(`${vp.name}: editor left == key left`, near(ib.x, mine.key.x), `${r1(ib.x)} vs ${r1(mine.key.x)}`);
    ck(`${vp.name}: editor right == row content right`, near(ib.x + ib.width, ref.val.x + ref.val.width), `${r1(ib.x + ib.width)} vs ${r1(ref.val.x + ref.val.width)}`);
    table.push({ vp: vp.name, row: '(输入框)', rowX: r1(ib.x), rowRight: r1(ib.x + ib.width), keyX: '', valRight: '', rowH: r1(ib.height), keyCY: '' });
    await input.fill('/home/alice');
    ck(`${vp.name}: root itself → inline error + submit disabled`,
      (await page.getByText('不能直接用家目录，请用它下面的子目录').count()) === 1
      && (await page.locator('[data-testid="create-node-submit"]').getAttribute('aria-disabled')) === 'true');
    if (OUT) await page.screenshot({ path: `${OUT}/${vp.name}-edit-error.png` });
    await input.fill('/home/alice/projects/demo');
    ck(`${vp.name}: custom path → value row follows, submit enabled`,
      (await page.locator('[data-testid="create-workdir-value"]').textContent()) === '/home/alice/projects/demo'
      && (await page.locator('[data-testid="create-node-submit"]').getAttribute('aria-disabled')) !== 'true');
    if (OUT) await page.screenshot({ path: `${OUT}/${vp.name}-edit.png` });

    // 老 daemon:整行隐藏
    await openConfirm(page, OLD_DAEMON);
    ck(`${vp.name}: old daemon → no 工作目录 row`, (await page.locator('[data-testid="create-workdir-row"]').count()) === 0);
  } catch (e) {
    ck(`${vp.name}: case ran`, false, String(e?.message || e).split('\n')[0]);
  }
  await ctx.close();
}
await browser.close();
web.close();

console.log('\n| viewport | row | row x | row right | key x | value right | row h | key centre (in row) | 改 right |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const t of table) console.log(`| ${t.vp} | ${t.row} | ${t.rowX} | ${t.rowRight} | ${t.keyX} | ${t.valRight} | ${t.rowH} | ${t.keyCY} | ${t.editRight ?? ''} |`);
console.log(`\n${fails ? 'FAIL' : 'PASS'}: ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
