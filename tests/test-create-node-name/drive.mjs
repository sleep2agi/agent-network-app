// 看板 #652 —— 新建节点向导第 1 步:名字可以是中文,文件夹(工作目录名)单独一行、英文、可改。
// web export + tests/test-layout-sweep 的页内 Tauri 桩,不起 hub、不占端口、不碰 HOME;nothing touches 127.0.0.1:9200。
// 占位数据:守护 示例-守护,根目录 /home/alice,节点名 测试 / 研发助手A。
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] \
//     node tests/test-create-node-name/drive.mjs
//
// 断言(手机 390×844 / 桌面 1280×800):
//   (1) 「测试」:不报错、下一步可点;名字下面一行「文件夹：ceshi」(拼音),画出来了
//   (2) 「文件夹：…」一行左边 == 名字输入框左边 ±1px;「改」右边 == 输入框右边 ±1px;在输入框下方
//   (3) 「a/b」:说明变成服务器同款报错(带「/」),红字画出来,下一步不可点
//   (4) 改文件夹:「my_Dir」→ 报错且下一步不可点(不悄悄改写);「my-dir」→ 通过,确认页工作目录 = /home/alice/my-dir
//   (5) 老 daemon(无 default_workdir_root):没有文件夹一行,「测试」照样可下一步
// 任一断言失败或页面打不开 → exit 1。
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA, paintedText } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const DAEMON = { daemon_node_id: 'd_sweep_1', alias: '示例-守护', hostname: 'host-d', online: true, runtimes_supported: ['claude-agent-sdk'], can_create_nodes: true, default_workdir_root: '/home/alice' };
const OLD_DAEMON = { ...DAEMON, default_workdir_root: undefined };
const VIEWPORTS = [{ name: 'phone-390x844', w: 390, h: 844, mobile: true }, { name: 'desktop-1280x800', w: 1280, h: 800 }];

let fails = 0;
const ck = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`); };
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
const r1 = (n) => Math.round(n * 10) / 10;
const painted = async (page, text) => { const p = await paintedText(page, ':not(:has(*))', text); return [!!p?.painted && p.w >= 8, p ? `painted ${r1(p.w)}×${r1(p.h)}` : 'painted null']; };
const nextDisabled = async (page) => (await page.locator('[data-testid="create-node-next"]').getAttribute('aria-disabled')) === 'true';

// create_node 的请求原样记下(与 test-create-node-runtime-params 同一个桩),供 (6) 断言实际发出的 workdir。
const overrideScript = () => {
  window.__createCalls = [];
  window.__routeOverride = (u, bodyText) => {
    if (u.pathname === '/mcp') {
      let params = {};
      try { params = JSON.parse(bodyText || '{}')?.params ?? {}; } catch {}
      if (params.name !== 'create_node') return undefined;
      window.__createCalls.push(params.arguments);
      return { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, request_id: 'cr_drive_652' }) }] } };
    }
    if (u.pathname === '/api/node-create-requests') return { ok: true, request: { request_id: 'cr_drive_652', status: 'delivered' } };
    return undefined;
  };
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
const table = [];

// 当前步骤(stepper 里 dot=current 的那一格)。走步用它作「就绪信号」,不靠固定点击次数:
// CI 上模型列表等异步数据到得慢时,「下一步」会短暂禁用,盲点 4 次会有点击落空(#732 CI 红过一次)。
const currentStep = (page) => page.evaluate(() => {
  const dot = document.querySelector('[data-testid="create-step-dot-current"]');
  const item = dot?.parentElement?.closest('[data-testid^="create-step-"]:not([data-testid^="create-step-dot-"])');
  return item?.getAttribute('data-testid')?.replace(/^create-step-/, '') ?? null;
});
async function advanceToConfirm(page) {
  for (let i = 0; i < 8; i++) {
    if (await page.locator('[data-testid="create-node-submit"]').count()) return;
    const before = await currentStep(page);
    const nextBtn = page.locator('[data-testid="create-node-next"]');
    try {
      await page.waitForFunction(() => {
        const b = document.querySelector('[data-testid="create-node-next"]');
        return !!b && b.getAttribute('aria-disabled') !== 'true';
      }, null, { timeout: 15000 });
    } catch {
      const txt = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 300);
      throw new Error(`下一步 stayed disabled at step ${before}: ${txt}`);
    }
    await nextBtn.click();
    await page.waitForFunction((b) => {
      if (document.querySelector('[data-testid="create-node-submit"]')) return true;
      const dot = document.querySelector('[data-testid="create-step-dot-current"]');
      const k = dot?.parentElement?.closest('[data-testid^="create-step-"]:not([data-testid^="create-step-dot-"])')?.getAttribute('data-testid');
      return !!k && k !== `create-step-${b}`;
    }, before, { timeout: 15000 });
  }
  throw new Error(`never reached the confirm step (at ${await currentStep(page)})`);
}

async function openWizard(page, daemon) {
  await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 15000 });
  await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'agents' }));
  // 🔴 Wait for the previous wizard to actually unmount. Two setScreen calls back to back can
  //    commit as one render on a fast/slow-enough runner; the wizard instance then survives with
  //    its old state (still on the confirm step) and the name input never appears. That was the
  //    #732 CI red: green locally, `locator.waitFor: Timeout` in CI.
  await page.waitForFunction(() => !document.querySelector('[data-testid="create-stepper"]')
    && !document.querySelector('[data-testid="create-node-next"]')
    && !document.querySelector('[data-testid="create-node-submit"]'), null, { timeout: 15000 });
  await page.evaluate((d) => window.__anetLayoutSweep.setScreen({ name: 'wizard', daemon: d }), daemon);
  await page.locator('[data-testid="create-name-input"]').waitFor({ timeout: 15000 });
  // fresh wizard: step 1, empty name
  const fresh = await page.evaluate(() => (document.querySelector('[data-testid="create-name-input"]')?.value ?? null));
  if (fresh !== '') throw new Error(`wizard did not start fresh (name input = ${JSON.stringify(fresh)})`);
}

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, ...(vp.mobile ? { userAgent: ANDROID_UA, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const page = await ctx.newPage();
  // DRIVE_CPU_THROTTLE=4 reproduces a slow CI runner locally (CDP CPU throttling). Off by default.
  if (Number(process.env.DRIVE_CPU_THROTTLE) > 1) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.DRIVE_CPU_THROTTLE) });
  }
  await page.addInitScript(initScript, { theme: 'light' });
  await page.addInitScript(overrideScript);
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  try {
    await openWizard(page, DAEMON);
    const input = page.locator('[data-testid="create-name-input"]');
    await input.fill('测试');
    const folderVal = page.locator('[data-testid="create-folder-value"]');
    await folderVal.waitFor({ timeout: 15000 });
    const txt = await folderVal.textContent();
    ck(`${vp.name}: 测试 → 「文件夹：ceshi」`, txt === '文件夹：ceshi', txt);
    const [fp, fpInfo] = await painted(page, '文件夹：ceshi');
    ck(`${vp.name}: folder line is painted`, fp, fpInfo);
    ck(`${vp.name}: 测试 → hint is the plain rule (not an error)`, (await page.locator('[data-testid="create-name-hint"]').textContent()).includes('可以用中文'));
    ck(`${vp.name}: 测试 → 下一步 enabled`, !(await nextDisabled(page)));

    const ib = await input.boundingBox();
    const rb = await page.locator('[data-testid="create-folder-row"]').boundingBox();
    const fb = await folderVal.boundingBox();
    const eb = await page.locator('[data-testid="create-folder-edit"]').boundingBox();
    table.push({ vp: vp.name, inputX: r1(ib.x), inputRight: r1(ib.x + ib.width), rowX: r1(rb.x), textX: r1(fb.x), editRight: r1(eb.x + eb.width), editCY: r1(eb.y + eb.height / 2), textCY: r1(fb.y + fb.height / 2), gapBelowInput: r1(rb.y - (ib.y + ib.height)) });
    ck(`${vp.name}: folder text left == name input left`, near(fb.x, ib.x), `${r1(fb.x)} vs ${r1(ib.x)}`);
    ck(`${vp.name}: folder row left == name input left`, near(rb.x, ib.x), `${r1(rb.x)} vs ${r1(ib.x)}`);
    ck(`${vp.name}: 「改」 right == name input right`, near(eb.x + eb.width, ib.x + ib.width), `${r1(eb.x + eb.width)} vs ${r1(ib.x + ib.width)}`);
    ck(`${vp.name}: 「改」 shares the folder text's centre line`, near(eb.y + eb.height / 2, fb.y + fb.height / 2), `${r1(eb.y + eb.height / 2)} vs ${r1(fb.y + fb.height / 2)}`);
    ck(`${vp.name}: folder row sits below the input`, rb.y >= ib.y + ib.height);
    if (OUT) await page.screenshot({ path: `${OUT}/${vp.name}-name-chinese-ok.png` });

    await input.fill('a/b');
    const hint = await page.locator('[data-testid="create-name-hint"]').textContent();
    ck(`${vp.name}: a/b → server-equivalent error`, hint === '名字里不能有「/」：只能用文字、字母、数字、_ 和 -', hint);
    const [ep, epInfo] = await painted(page, hint);
    ck(`${vp.name}: a/b error is painted`, ep, epInfo);
    ck(`${vp.name}: a/b → 下一步 disabled`, await nextDisabled(page));
    if (OUT) await page.screenshot({ path: `${OUT}/${vp.name}-name-invalid.png` });

    // 改文件夹
    await input.fill('研发助手A');
    await page.locator('[data-testid="create-folder-edit"]').click();
    const fin = page.locator('[data-testid="create-folder-input"]');
    await fin.waitFor({ timeout: 15000 });
    const fib = await fin.boundingBox();
    ck(`${vp.name}: folder editor left/right == name input`, near(fib.x, ib.x) && near(fib.x + fib.width, ib.x + ib.width), `${r1(fib.x)}..${r1(fib.x + fib.width)} vs ${r1(ib.x)}..${r1(ib.x + ib.width)}`);
    await fin.fill('my_Dir');
    const fh = await page.locator('[data-testid="create-folder-hint"]').textContent();
    ck(`${vp.name}: folder my_Dir → error, kept as typed, 下一步 disabled`, fh === '文件夹名只能用小写英文字母、数字和 -' && (await fin.inputValue()) === 'my_Dir' && (await nextDisabled(page)), fh);
    if (OUT) await page.screenshot({ path: `${OUT}/${vp.name}-folder-invalid.png` });
    await fin.fill('my-dir');
    ck(`${vp.name}: folder my-dir → ok`, !(await nextDisabled(page)) && (await folderVal.textContent()) === '文件夹：my-dir');
    if (OUT) await page.screenshot({ path: `${OUT}/${vp.name}-folder-edited.png` });
    await advanceToConfirm(page);
    const wd = page.locator('[data-testid="create-workdir-value"]');
    await wd.waitFor({ timeout: 15000 });
    ck(`${vp.name}: confirm page workdir = <root>/<edited folder>`, (await wd.textContent()) === '/home/alice/my-dir', await wd.textContent());
    ck(`${vp.name}: confirm page shows the Chinese name`, (await page.getByText('研发助手A', { exact: true }).count()) >= 1);

    // (6) 端到端:向导「文件夹：…」显示的那个文件夹 == 实际发给 Hub 的 workdir 的最后一段。
    //     daemon 侧(sleep2agi/agent-network #652:node-name-652.test.ts + qa-rfc026 A.cn2)断言
    //     收到 `<root>/<folder>` 时盘上建的就是 <root>/<folder>/.anet/nodes/<folder>/ —— 两段接起来即「显示 == 落盘」。
    await openWizard(page, DAEMON);
    await page.locator('[data-testid="create-name-input"]').fill('测试');
    const shown = (await page.locator('[data-testid="create-folder-value"]').textContent()) || '';
    const shownFolder = shown.replace(/^文件夹：/, '');
    await advanceToConfirm(page);
    await page.evaluate(() => { window.__createCalls = []; });
    await page.waitForFunction(() => {
      const b = document.querySelector('[data-testid="create-node-submit"]');
      return !!b && b.getAttribute('aria-disabled') !== 'true';
    }, null, { timeout: 15000 });
    await page.locator('[data-testid="create-node-submit"]').click();
    await page.waitForFunction(() => (window.__createCalls || []).length > 0, null, { timeout: 15000 });
    const sent = await page.evaluate(() => window.__createCalls[0]);
    ck(`${vp.name}: submitted workdir == <root>/<folder shown in the wizard>`,
      shownFolder === 'ceshi' && sent?.node_spec?.workdir === `/home/alice/${shownFolder}` && sent?.node_spec?.name === '测试',
      `shown=${shownFolder} sent=${JSON.stringify(sent?.node_spec)}`);

    // 老 daemon
    await openWizard(page, OLD_DAEMON);
    await page.locator('[data-testid="create-name-input"]').fill('测试');
    ck(`${vp.name}: old daemon → no folder line`, (await page.locator('[data-testid="create-folder-row"]').count()) === 0);
    ck(`${vp.name}: old daemon → 测试 still passes step 1`, !(await nextDisabled(page)));
  } catch (e) {
    ck(`${vp.name}: case ran`, false, `${String(e?.message || e).split('\n')[0]} @step=${await currentStep(page).catch(() => '?')}`);
  }
  await ctx.close();
}
await browser.close();
web.close();

console.log('\n| viewport | input x | input right | folder row x | folder text x | 改 right | 改 centre y | text centre y | gap below input |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const t of table) console.log(`| ${t.vp} | ${t.inputX} | ${t.inputRight} | ${t.rowX} | ${t.textX} | ${t.editRight} | ${t.editCY} | ${t.textCY} | ${t.gapBelowInput} |`);
console.log(`\n${fails ? 'FAIL' : 'PASS'}: ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
