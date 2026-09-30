// 规则文件「阅读 / 编辑 / 左右」—— 真应用(expo web 导出 + Tauri 桥桩)里点真按钮、拖真分隔条、量真框。
// 不进 CI:要 Playwright + Chromium。Hub 数据是 tests/test-layout-sweep/harness.mjs 的页内假数据(示例-A …),
// 规则文件是这里生成的合成 markdown(window.__rulesFixture),不起 hub、不占端口、不碰 HOME。
//
//   WEB_DIR=<expo export 目录> [OUT=<截图目录>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] \
//   node tests/test-rules-split-editor/drive.mjs
//
// 桌面 2048×807(Vincent 的窗口)和 1200×800,各一个干净的浏览器上下文(localStorage 空):
//   default   宽布局第一次打开 = 左右;tab = 阅读/编辑/左右
//   panes     两栏宽 + 边框 = 外框宽 ±2px;外框铺满内容区(目录右边 +16 到窗口右边 −16)±2px
//   center    全屏工具条里 tab / 文件名 / 🔗 / 重新读取 / 保存 / 退出全屏 同一中线 ±1px
//   divider   热区 ≥ 8px;拖 +200px ⇒ 比例 = 0.5 + 200/内宽(±0.005)、左栏宽跟着变(±2px);双击 ⇒ 0.5
//   persist   拖过的比例、选过的模式,重开页面还在
//   live      左边打字 ⇒ 右边预览出现那段字
//   sync      左边滚到某个标题 ⇒ 右边同一标题在预览视口里;关掉 🔗 再滚 ⇒ 右边不动
//   toc       点目录 ⇒ 右边标题进视口、左边光标到标题那一行
//   find      左右模式 Ctrl+F 查的是左边源码(选中落在编辑框里)
//   save/esc  保存把「未保存」清掉;Esc 退出全屏
//   width     编辑模式编辑框铺满内容区;阅读模式框铺满、正文列 ≤ 880
// 手机 390×844(安卓 UA):只有 阅读/编辑 两个 tab、默认阅读、没有左右 —— 截图证明不变。
// 任何一条没跑到 = FAIL(不是 skip)。
import { mkdirSync, writeFileSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA, paintedText } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

let pass = 0; const failures = []; const table = [];
const ck = (name, ok, extra = '') => { if (ok) pass++; else failures.push(name); console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`); };
const row = (vp, what, value, limit, ok) => table.push({ vp, what, value, limit, ok });
const r1 = (n) => Math.round(n * 10) / 10;

// 合成规则文件:14 节,每节几段 + 列表 + 偶尔一个代码块,足够长到两边都要滚。
const FIXTURE = (() => {
  const out = ['# 示例规则文件', '', '这是一份合成的规则文件,只用于布局和交互测量。'];
  for (let i = 1; i <= 14; i++) {
    out.push('', `## 第 ${i} 节 示例小节`, '');
    for (let j = 1; j <= 3; j++) out.push(`第 ${i} 节第 ${j} 段:${'占位句子,用来撑出一定的长度。'.repeat(3 + (i % 3))}`, '');
    out.push('- 条目甲', '- 条目乙', '- 条目丙');
    if (i % 4 === 0) out.push('', '```bash', '# 代码块里的注释不是标题', 'echo example', '```');
  }
  return out.join('\n') + '\n';
})();

const fixtureScript = (text) => { window.__rulesFixture = text; };

async function openRules(page) {
  await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
  await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'nodeDetail', alias: '示例-A' }));
  await page.getByText('规则文件', { exact: true }).first().click({ timeout: 10000 });
  await page.getByText('示例规则文件').first().waitFor({ timeout: 15000 }).catch(() => {});
}
const modal = (page) => page.locator('[aria-modal="true"]').last();
async function openFull(page) {
  await page.getByLabel('全屏阅读规则文件').first().click({ timeout: 15000 });
  await page.getByText(/退出全屏/).first().waitFor({ timeout: 5000 });
  await page.waitForTimeout(400);
}
// 规则区的 tab 条(节点页的分区 tab 也是 role=tab,要先圈到含「阅读」的那个 tablist)。
const rulesTablist = (scope) => scope.locator('[role="tablist"]:has(> [role="tab"])').filter({ hasText: /^阅读编辑/ }).first();
const tabs = async (scope) => (await rulesTablist(scope).getByRole('tab').allInnerTexts()).map((s) => s.trim());
const selectedTab = async (scope) => (await rulesTablist(scope).locator('[role="tab"][aria-selected="true"]').allInnerTexts()).map((s) => s.trim()).join();
const box = async (loc) => loc.boundingBox();

async function newPage(browser, vp, ua) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, colorScheme: 'light', deviceScaleFactor: 1, ...(ua ? { userAgent: ua } : {}) });
  const page = await ctx.newPage();
  await page.addInitScript(fixtureScript, FIXTURE);
  await page.addInitScript(initScript, { theme: 'light' });
  return { ctx, page };
}

// 编辑框里某行行首的 y(测试自己量:同宽同字体镜像 div,不借用被测代码)。
const lineTopInTextarea = (ta, needle) => {
  const v = ta.value; const off = v.indexOf(needle);
  const cs = getComputedStyle(ta); const d = document.createElement('div');
  for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) d.style[k] = cs[k];
  Object.assign(d.style, { position: 'absolute', visibility: 'hidden', left: '-99999px', top: '0', boxSizing: 'border-box', width: ta.clientWidth + 'px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'break-word' });
  d.textContent = v.slice(0, off); const m = document.createElement('span'); m.textContent = '​'; d.appendChild(m);
  document.body.appendChild(d); const top = m.offsetTop; d.remove(); return { off, top };
};

async function desktop(browser, web, vp) {
  const tag = `${vp.w}x${vp.h}`;
  const { ctx, page } = await newPage(browser, vp);
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await openRules(page);
  await page.locator('[data-testid="rules-split"]').first().waitFor({ timeout: 10000 }).catch(() => {});
  // 节点页里的卡片:放得下左右(卡片 ≥ 640)就给三个 tab 且默认左右;放不下就两个 tab、默认阅读。
  const inlineTabs = (await tabs(page.locator('body'))).join();
  const inlineSel = await selectedTab(page.locator('body'));
  const inlineOk = inlineTabs === '阅读,编辑,左右' ? inlineSel === '左右' : inlineTabs === '阅读,编辑' && inlineSel === '阅读';
  ck(`${tag} default(卡片): tabs=${inlineTabs} 选中=${inlineSel}`, inlineOk);
  if (OUT) await page.screenshot({ path: `${OUT}/${tag}-inline.png` });

  await openFull(page);
  const m = modal(page);
  const split = m.locator('[data-testid="rules-split"]');
  ck(`${tag} default(全屏): tabs 阅读/编辑/左右、第一次打开是左右`, (await split.count()) === 1 && (await tabs(m)).join() === '阅读,编辑,左右' && (await selectedTab(m)) === '左右');
  if (OUT) await page.screenshot({ path: `${OUT}/${tag}-full-split.png` });

  // panes
  const fb = await box(split); const sb = await box(m.locator('[data-testid="rules-split-source"]')); const pb = await box(m.locator('[data-testid="rules-split-preview"]'));
  const toc = await box(m.locator('[data-testid="rules-outline"]'));
  const sum = sb.width + pb.width + 2;
  row(tag, '源码宽 + 预览宽 + 2 边框 vs 外框宽', `${r1(sb.width)} + ${r1(pb.width)} + 2 = ${r1(sum)} / ${r1(fb.width)}`, '±2', Math.abs(sum - fb.width) <= 2);
  ck(`${tag} panes: 两栏加起来 = 外框 ±2`, Math.abs(sum - fb.width) <= 2, `${r1(sum)} vs ${r1(fb.width)}`);
  const areaL = toc.x + toc.width + 16; const areaR = vp.w - 16;
  const fillOk = Math.abs(fb.x - areaL) <= 2 && Math.abs(fb.x + fb.width - areaR) <= 2;
  row(tag, '外框左右边 vs 内容区(目录右+16 … 窗口−16)', `${r1(fb.x)}…${r1(fb.x + fb.width)} / ${r1(areaL)}…${areaR}`, '±2', fillOk);
  ck(`${tag} panes: 外框铺满内容区`, fillOk);

  // toolbar centre line
  const header = m.locator('[data-testid="screen-header"]');
  const items = [
    ...(await rulesTablist(header).getByRole('tab').all()),
    header.getByText('CLAUDE.md', { exact: true }),
    header.locator('[data-testid="rules-scroll-sync"]'),
    header.getByRole('button', { name: '重新读取' }),
    header.getByRole('button', { name: '保存' }),
    header.getByLabel('退出全屏(Esc)'),
  ];
  const cys = [];
  for (const it of items) { const b = await it.first().boundingBox({ timeout: 3000 }).catch(() => null); if (b) cys.push(b.y + b.height / 2); else console.log('  (toolbar item not found)', String(it)); }
  const spread = Math.max(...cys) - Math.min(...cys);
  row(tag, `工具条 ${cys.length} 个控件中线极差`, r1(spread), '≤1', cys.length === 8 && spread <= 1);
  ck(`${tag} center: 工具条同一中线 ±1`, cys.length === 8 && spread <= 1, `n=${cys.length} spread=${r1(spread)}`);

  // divider
  const div = m.locator('[data-testid="rules-split-divider"]');
  const db = await box(div);
  row(tag, '分隔条热区宽', r1(db.width), '≥8', db.width >= 8);
  ck(`${tag} divider: 热区 ≥ 8px`, db.width >= 8, r1(db.width));
  const inner = fb.width - 2;
  const cx = db.x + db.width / 2; const cy = db.y + db.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(cx + 20 * i, cy);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const ratio = Number(await div.getAttribute('data-ratio'));
  const want = 0.5 + 200 / inner;
  const sb2 = await box(m.locator('[data-testid="rules-split-source"]'));
  const ratioOk = Math.abs(ratio - want) <= 0.005 && Math.abs(sb2.width - Math.round(inner * ratio)) <= 2;
  row(tag, '拖 +200px 后比例 / 左栏宽', `${ratio.toFixed(4)} (期望 ${want.toFixed(4)}) / ${r1(sb2.width)} (期望 ${Math.round(inner * ratio)})`, '±0.005 / ±2', ratioOk);
  ck(`${tag} divider: 拖动改比例`, ratioOk, `ratio=${ratio.toFixed(4)} want=${want.toFixed(4)} left=${r1(sb2.width)}`);
  if (OUT) await page.screenshot({ path: `${OUT}/${tag}-full-split-dragged.png` });
  // 拖到最左 ⇒ 25%
  const db2 = await box(div);
  await page.mouse.move(db2.x + db2.width / 2, cy); await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(db2.x + db2.width / 2 - 200 * i, cy);
  await page.mouse.up(); await page.waitForTimeout(150);
  const clamped = Number(await div.getAttribute('data-ratio'));
  row(tag, '拖出左边界后比例', clamped.toFixed(4), '=0.25', clamped === 0.25);
  ck(`${tag} divider: 夹在 25%`, clamped === 0.25, clamped);
  // 拖回到 want 附近再测 persist
  const db3 = await box(div);
  await page.mouse.move(db3.x + db3.width / 2, cy); await page.mouse.down();
  const target = fb.x + 1 + inner * 0.6;
  for (let i = 1; i <= 10; i++) await page.mouse.move(db3.x + db3.width / 2 + (target - (db3.x + db3.width / 2)) * i / 10, cy);
  await page.mouse.up(); await page.waitForTimeout(150);
  const saved = Number(await div.getAttribute('data-ratio'));

  // live preview
  const ta = m.locator('[data-testid="rules-split-source"] textarea');
  await ta.click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('Control+Home');
  const marker = '新加的实时预览标记';
  await page.keyboard.type(`${marker}\n\n`);
  const t0 = Date.now();
  let seen = false;
  try { await m.locator('[data-testid="rules-split-preview"]').getByText(marker).first().waitFor({ timeout: 3000 }); seen = true; } catch {}
  const latency = Date.now() - t0;
  row(tag, '左边打字 → 右边预览出现', seen ? `${latency} ms` : '没出现', '≤3000 ms', seen);
  ck(`${tag} live: 预览跟着更新`, seen, `${latency}ms`);
  // 不只看有没有这段字:还要真的画出来(裁掉 overflow 祖先之后 ≥ 8px 宽)——0 宽的标签 textContent 照样对
  const dirty = await paintedText(page, '[aria-modal="true"] *', '未保存');
  ck(`${tag} live: 标「未保存」`, (await m.getByText('未保存', { exact: true }).count()) > 0 && !!dirty?.painted && dirty.w >= 8, dirty ? `painted ${r1(dirty.w)}×${r1(dirty.h)}` : 'painted none');

  // scroll sync:把左边滚到「第 9 节」那一行
  const scrollSrcTo = async (needle) => {
    await ta.evaluate((el, [fnSrc, n]) => { const f = new Function(`return (${fnSrc})`)(); const { top } = f(el, n); el.scrollTop = top - parseFloat(getComputedStyle(el).paddingTop); }, [lineTopInTextarea.toString(), needle]);
    await page.waitForTimeout(250);
  };
  const headingInView = async (text) => {
    const pv = await box(m.locator('[data-testid="rules-split-preview"]'));
    const h = await box(m.locator('[data-testid="rules-split-preview"] [data-md-line]').filter({ hasText: text }).first());
    return { ok: !!h && h.y >= pv.y - 1 && h.y + h.height <= pv.y + pv.height + 1, top: h ? r1(h.y - pv.y) : null, ph: r1(pv.height) };
  };
  await scrollSrcTo('## 第 9 节');
  const s9 = await headingInView('第 9 节 示例小节');
  row(tag, '源码滚到「第 9 节」→ 预览同一标题距预览顶', `${s9.top} px (预览高 ${s9.ph})`, '在视口内', s9.ok);
  ck(`${tag} sync: 预览标题在视口内`, s9.ok, JSON.stringify(s9));
  if (OUT) await page.screenshot({ path: `${OUT}/${tag}-full-split-synced.png` });
  const previewScroller = () => m.locator('[data-testid="rules-split-preview"] > div').first();
  await m.locator('[data-testid="rules-scroll-sync"]').click();
  const before = await previewScroller().evaluate((el) => el.scrollTop);
  await scrollSrcTo('## 第 2 节');
  const after = await previewScroller().evaluate((el) => el.scrollTop);
  ck(`${tag} sync off: 预览不动`, before === after && before > 0, `${before} → ${after}`);
  row(tag, '关掉 🔗 后滚源码,预览 scrollTop', `${before} → ${after}`, '不变', before === after && before > 0);
  await m.locator('[data-testid="rules-scroll-sync"]').click();

  // toc
  await m.locator('[data-testid="rules-outline"]').getByText('第 12 节 示例小节', { exact: true }).click();
  await page.waitForTimeout(400);
  const s12 = await headingInView('第 12 节 示例小节');
  const caret = await ta.evaluate((el) => ({ sel: el.selectionStart, want: el.value.indexOf('## 第 12 节'), top: el.scrollTop }));
  const lt = await ta.evaluate((el, fnSrc) => new Function(`return (${fnSrc})`)()(el, '## 第 12 节'), lineTopInTextarea.toString());
  const srcVisible = lt.top >= caret.top && lt.top <= caret.top + 200;
  ck(`${tag} toc: 预览标题进视口`, s12.ok, JSON.stringify(s12));
  ck(`${tag} toc: 源码光标在标题行、行在框顶附近`, caret.sel === caret.want && srcVisible, JSON.stringify({ ...caret, lineTop: lt.top }));
  row(tag, '点目录「第 12 节」:预览标题距顶 / 源码行距框顶', `${s12.top} px / ${r1(lt.top - caret.top)} px`, '视口内 / 0–200', s12.ok && srcVisible);

  // find (Ctrl+F) 在左右里查源码
  await ta.click({ position: { x: 30, y: 30 } });
  await page.keyboard.press('Control+f');
  await page.waitForTimeout(200);
  await page.keyboard.type('条目乙');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const fsel = await ta.evaluate((el) => el.value.slice(el.selectionStart, el.selectionEnd));
  ck(`${tag} find: 左右里 Ctrl+F 选中源码里的匹配`, fsel === '条目乙', JSON.stringify(fsel));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  if (OUT) await page.screenshot({ path: `${OUT}/${tag}-full-split-find.png` });

  // save
  await m.getByRole('button', { name: '保存' }).click();
  await m.getByText('未保存', { exact: true }).first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  ck(`${tag} save: 「未保存」清掉`, (await m.getByText('未保存', { exact: true }).count()) === 0);

  // width: 编辑 / 阅读
  await m.getByRole('tab', { name: '编辑' }).click(); await page.waitForTimeout(300);
  const eb = await box(m.locator('textarea').first());
  const eOk = Math.abs(eb.x - areaL) <= 2 && Math.abs(eb.x + eb.width - areaR) <= 2;
  row(tag, '编辑模式编辑框左右边 vs 内容区', `${r1(eb.x)}…${r1(eb.x + eb.width)} / ${r1(areaL)}…${areaR}`, '±2', eOk);
  ck(`${tag} width: 编辑框铺满内容区`, eOk);
  if (OUT) await page.screenshot({ path: `${OUT}/${tag}-full-edit.png` });
  await m.getByRole('tab', { name: '阅读' }).click(); await page.waitForTimeout(400);
  const col = await m.locator('[data-md-line]').first().evaluate((el) => { let p = el; while (p && !/^\d+px$/.test(getComputedStyle(p).maxWidth)) p = p.parentElement; const r = p?.getBoundingClientRect(); return p ? { w: r.width, x: r.left, max: getComputedStyle(p).maxWidth } : null; });
  const colOk = !!col && col.w <= 880 + 0.5 && col.max === '880px';
  row(tag, '阅读模式正文列宽 / max-width', col ? `${r1(col.w)} / ${col.max}` : '—', '≤880', colOk);
  ck(`${tag} width: 阅读正文列 ≤ 880`, colOk, JSON.stringify(col));
  if (OUT) await page.screenshot({ path: `${OUT}/${tag}-full-read.png` });

  // Esc
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  ck(`${tag} esc: 退出全屏`, (await page.getByText(/退出全屏/).count()) === 0);

  // persist: 选的是阅读 → 重开页面还是阅读;比例还在
  await page.reload();
  await openRules(page); await page.waitForTimeout(500);
  const afterReload = await selectedTab(page.locator('body'));
  ck(`${tag} persist: 模式(阅读)重开还在`, afterReload === '阅读', afterReload);
  // 卡片可能放不下左右(1200 宽时节点页右栏 < 640):到全屏里切左右,看存下来的比例。
  await openFull(page);
  await rulesTablist(modal(page)).getByRole('tab', { name: '左右' }).click(); await page.waitForTimeout(300);
  const r2 = Number(await modal(page).locator('[data-testid="rules-split-divider"]').getAttribute('data-ratio'));
  row(tag, '重开页面后比例', `${r2.toFixed(4)} (存的 ${saved.toFixed(4)})`, '相等', r2 === saved);
  ck(`${tag} persist: 比例重开还在`, r2 === saved, `${r2} vs ${saved}`);
  // 双击复位
  const d = modal(page).locator('[data-testid="rules-split-divider"]');
  const dbb = await box(d);
  await page.mouse.dblclick(dbb.x + dbb.width / 2, dbb.y + dbb.height / 2);
  await page.waitForTimeout(250);
  const reset = Number(await d.getAttribute('data-ratio'));
  row(tag, '双击分隔条后比例', reset.toFixed(4), '=0.5', reset === 0.5);
  ck(`${tag} divider: 双击回 50/50`, reset === 0.5, reset);
  await ctx.close();
}

async function phone(browser, web) {
  const { ctx, page } = await newPage(browser, { w: 390, h: 844 }, ANDROID_UA);
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await openRules(page); await page.waitForTimeout(500);
  const t = await tabs(page.locator('body'));
  ck('390x844 phone: 只有 阅读/编辑', t.join() === '阅读,编辑', t.join());
  ck('390x844 phone: 默认阅读', (await selectedTab(page.locator('body'))) === '阅读');
  ck('390x844 phone: 没有左右分栏', (await page.locator('[data-testid="rules-split"]').count()) === 0);
  if (OUT) await page.screenshot({ path: `${OUT}/390x844-phone-read.png` });
  await openFull(page);
  ck('390x844 phone 全屏: 只有 阅读/编辑', (await tabs(modal(page))).join() === '阅读,编辑');
  if (OUT) await page.screenshot({ path: `${OUT}/390x844-phone-full.png` });
  await ctx.close();
}

const web = await serveExport(WEB);
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--disable-web-security'] });
const ran = [];
for (const vp of [{ w: 2048, h: 807 }, { w: 1200, h: 800 }]) {
  try { await desktop(browser, web, vp); ran.push(`${vp.w}x${vp.h}`); } catch (e) { ck(`${vp.w}x${vp.h} ran to the end`, false, e.message.split('\n')[0]); }
}
try { await phone(browser, web); ran.push('390x844'); } catch (e) { ck('390x844 ran to the end', false, e.message.split('\n')[0]); }
await browser.close(); web.close();

if (OUT) {
  const md = ['| 视口 | 测量 | 值 | 判据 | 结果 |', '|---|---|---|---|---|', ...table.map((r) => `| ${r.vp} | ${r.what} | ${r.value} | ${r.limit} | ${r.ok ? 'PASS' : 'FAIL'} |`)].join('\n');
  writeFileSync(`${OUT}/measurements.md`, md + '\n');
}
console.log(`\nran: ${ran.join(', ')}`);
console.log(`${pass}/${pass + failures.length} passed`);
if (failures.length || ran.length !== 3) process.exit(1);
