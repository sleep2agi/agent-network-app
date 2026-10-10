// 键盘语音输入(设置 → 快捷键 → 输入:按住说话 / 语音输入开关)—— 真应用(expo web 导出 + Tauri 桥桩)里按真键。
// 不进 CI:要 Playwright + Chromium。Hub 数据是 tests/test-layout-sweep/harness.mjs 的页内假数据(示例-A …),
// 不起 hub 进程、不占端口、不碰 HOME。麦克风 = Chromium 假设备(--use-fake-device-for-media-stream,一段正弦音),
// 识别 = 桩:plugin:http 发往 https://mock-asr.invalid 的请求在页内直接回 { result: { text } },并计数。
//
//   WEB_DIR=<expo export 目录> [OUT=<截图目录>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] \
//   node tests/test-voice-shortcuts/drive.mjs
//
// 检查(1200×800 桌面工作区;Linux 上 Mod = Ctrl,另开一个 navigator.platform=MacIntel 的上下文跑 ⌘):
//   设置是单独的 Tauri 窗口(src/desktop-settings-window.ts):点「设置」/ Ctrl+, 先断言请求了 'settings' 窗口,
//   再在 harness openStubWindow 打开的第二个页面(同源 → 同一份 localStorage)里做设置页的检查。
//   page     快捷键页:输入组有「按住说话」「语音输入开关」,默认 Ctrl Shift Space / Ctrl Shift M;导航标签全中文;
//            新行与原有行:标签左边缘、键帽右边缘、键帽垂直中心、行高 ≤1px(打印测量表);截图
//   rebind   按住说话 改 Ctrl+Shift+M → 与「语音输入开关」冲突提示;改 F8 保存;恢复默认
//   sync     设置窗改绑后,主窗口不用重开就按新组合(跨窗口同步)
//   nochat   没有打开的会话时按 Ctrl+Shift+Space →「先打开一个会话」;按住不放(自动重复)不重复提示、不录音
//   hold     「明天|去公司开会」按住 Ctrl+Shift+Space(另补 3 次自动重复)说「上午」→ 插到光标处,光标 = 4;
//            按住期间:输入框里的录音条(#463,电平 / 计时 / 提示 / 取消 / 完成)出现、没有手机浮层、输入框没被打进空格、焦点不丢;
//            识别只请求 1 次(重复没有重开录音)
//   esc      按住中 Esc → 取消:草稿不变、0 次识别、松开组合键不再插入
//   blur     按住中窗口失焦 → 当作松开:停止并插入;之后松开按键不再插入第二次
//   toggle   Ctrl+Shift+M 开始 → 松开不停 → 再按结束并插入
//   f8       改绑成 F8 后按住 F8 → 插入;旧组合不再录音
//   mac      ⌘⇧Space 按住 → 先松开 ⌘(mac 上按着 ⌘ 时松开 Space 没有 keyup)→ 插入
// 任何一条没跑到 = FAIL(不是 skip)。
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, paintedText, openStubWindow } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

let pass = 0; const failures = [];
const ck = (name, ok, extra = '') => { if (ok) pass++; else failures.push(name); console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`); };

// harness 的桩外面再包一层:语音凭据 + 假识别(只认 mock-asr.invalid,其余照旧交给 harness)。
const asrScript = ({ mac }) => {
  if (mac) Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' });
  window.__asr = { calls: 0, next: '' };
  const inner = window.__TAURI_INTERNALS__;
  const invoke = inner.invoke;
  const mine = new Map(); let rid = 1e6;
  inner.invoke = async (cmd, args) => {
    if (cmd === 'load_voice_credentials') return JSON.stringify({ appId: '', accessToken: 'placeholder-api-key-0000', endpoint: 'https://mock-asr.invalid/flash' });
    if (cmd === 'plugin:http|fetch' && String(args?.clientConfig?.url ?? '').startsWith('https://mock-asr.invalid')) {
      const id = ++rid; mine.set(id, { req: true }); window.__asr.calls++; return id;
    }
    if (cmd === 'plugin:http|fetch_send' && mine.has(args?.rid)) {
      const id = ++rid;
      mine.set(id, { buf: new TextEncoder().encode(JSON.stringify({ result: { text: window.__asr.next } })), sent: false });
      return { status: 200, statusText: 'OK', url: 'https://mock-asr.invalid/flash', headers: [['content-type', 'application/json'], ['x-api-status-code', '20000000']], rid: id };
    }
    if (cmd === 'plugin:http|fetch_read_body' && mine.has(args?.rid)) {
      const b = mine.get(args.rid);
      if (!b.sent) { b.sent = true; return [...b.buf, 0]; }
      return [1];
    }
    return invoke(cmd, args);
  };
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

async function openApp({ mac = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
  const scripts = [[initScript, { theme: 'light' }], [asrScript, { mac }]];
  for (const [fn, arg] of scripts) await page.addInitScript(fn, arg);
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.locator('[data-testid="desktop-rail"]').waitFor({ timeout: 20000 });
  // 设置窗:`open` 做完真动作(点「设置」/ Ctrl+,)之后调,断言主窗口请求了 'settings' 窗口,打开它、进「快捷键」。
  let sp = null;
  const settingsWindow = async (via) => {
    const req = await page.waitForFunction(() => (window.__openedWindows || []).find(w => w.label === 'settings') || null, null, { timeout: 5000 }).then(h => h.jsonValue(), () => null);
    ck(`${via} → 请求打开「设置」窗口`, !!req && new URL(req.url, page.url()).searchParams.get('settings') === '1', JSON.stringify(req));
    sp = await openStubWindow(page, 'settings', scripts);
    if (!sp) throw new Error(`${via}: no settings window was requested`);
    sp.on('pageerror', e => errors.push(`[settings] ${String(e).split('\n')[0]}`));
    await sp.locator('[data-testid="dedicated-settings-window"]').waitFor({ timeout: 20000 });
    await sp.getByRole('button', { name: '设置分类 快捷键' }).click();
    await sp.locator('[data-testid="shortcuts-settings"]').waitFor({ timeout: 10000 });
    return sp;
  };
  // 用户关掉设置窗:关页面,并从桩的窗口表里去掉(真窗口关了 getByLabel 就找不到,下一次 Ctrl+, 会重新建窗)。
  const closeSettingsWindow = async () => {
    if (sp) await sp.close();
    sp = null;
    await page.evaluate(() => { window.__openedWindows = (window.__openedWindows || []).filter(w => w.label !== 'settings'); });
  };
  return { ctx, page, errors, settingsWindow, closeSettingsWindow };
}

const norm = (s) => s.replace(/\s+/g, ' ').trim();
// 文字对 ≠ 看得见:title-blank 那次 textContent 一直对,元素却被 flex 0 1 0% + overflow:hidden 压成 0px 宽。
// 文字判据旁边再量同一个元素画出来的框(被 overflow 祖先裁剪后 ≥ 8px 宽)。先滚进视口:设置页是滚动容器,
// 首屏外的行被它裁成 0 高,那是「没滚到」不是「没画」。只让真正的滚动容器(overflow auto/scroll)动 ——
// scrollIntoView 也会滚 overflow:hidden 的盒子,把被裁掉的字滚回来,正好掩盖要量的缺陷。
const painted = async (page, id) => {
  const sel = `[data-testid="${id}"]`;
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return;
    const scrolls = (v) => v === 'auto' || v === 'scroll';
    const pinned = [];
    for (let a = el.parentElement; a; a = a.parentElement) if (a !== document.scrollingElement) pinned.push([a, a.scrollTop, a.scrollLeft]);
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    for (const [a, top, left] of pinned) {
      const cs = getComputedStyle(a);
      if (!scrolls(cs.overflowY)) a.scrollTop = top;
      if (!scrolls(cs.overflowX)) a.scrollLeft = left;
    }
  }, sel);
  return paintedText(page, sel);
};
const seen = (p) => !!p?.painted && p.w >= 8;
const pd = (p) => p ? `painted ${Math.round(p.w)}×${Math.round(p.h)}${p.painted ? '' : ' UNPAINTED'}` : 'not rendered';

{
  const { ctx, page: main, errors, settingsWindow, closeSettingsWindow } = await openApp();
  let page = main; // 设置部分在设置窗里跑,聊天部分回到主窗口
  const shot = async (name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png` }); };
  // 主窗口从存储重读快捷键:shortcuts-store.ts 把偏好缓存在本窗口内存里,既不听 storage 事件也不听 Tauri 事件,
  // 所以设置窗里改的组合主窗口要重开才生效(sync 检查量的就是这个)。重开后再接着测新组合本身的行为。
  const reloadMain = async () => {
    await main.reload();
    await main.locator('[data-testid="desktop-rail"]').waitFor({ timeout: 20000 });
  };
  try {
    // 主窗口先按一次默认组合:真用户的主窗口早就处理过按键,快捷键已读进本窗口内存(shortcuts-store.ts 懒加载,
    // 第一次按键才读存储)。不先按,sync 那条会因为「主窗口还没读过」而碰巧绿。等这条提示消失再往下。
    await main.keyboard.press('Control+Shift+Space');
    ck('sync: 主窗口默认 Ctrl+Shift+Space(没有会话)→「先打开一个会话」', await main.locator('[data-testid="shortcut-toast"]').waitFor({ timeout: 3000 }).then(() => true, () => false));
    await main.waitForFunction(() => !document.querySelector('[data-testid="shortcut-toast"]'), null, { timeout: 10000 });

    // ── page ─────────────────────────────────────────────────────────────────
    await main.getByRole('tab', { name: '设置', exact: true }).click();
    page = await settingsWindow('page: 点「设置」');
    await shot('shortcuts-1200x800-top');
    const labels = await page.locator('[data-testid^="shortcut-label-nav.tab."]').allInnerTexts();
    ck('page: 导航标签使用一致产品名称', JSON.stringify(labels) === JSON.stringify(['切换到 会话', '切换到 任务', '切换到 定时任务', '切换到 消息', '切换到 Hub']), labels.join(','));
    const allLabels = await page.locator('[data-testid^="shortcut-label-"]').allInnerTexts();
    const english = allLabels.filter(l => /[A-Za-z]{2,}/.test(l));
    ck('page: 页面上所有行标签没有英文单词', english.length === 0, english.join(' | '));
    const holdP = await painted(page, 'shortcut-chips-input.voiceHold');
    ck('page: 按键说话 = Ctrl Shift Space', norm(await page.locator('[data-testid="shortcut-chips-input.voiceHold"]').innerText()) === 'Ctrl Shift Space' && seen(holdP), pd(holdP));
    const toggleP = await painted(page, 'shortcut-chips-input.voiceToggle');
    ck('page: 语音输入开关 = Ctrl Shift M', norm(await page.locator('[data-testid="shortcut-chips-input.voiceToggle"]').innerText()) === 'Ctrl Shift M' && seen(toggleP), pd(toggleP));
    await page.locator('[data-testid="shortcut-row-input.voiceHold"]').scrollIntoViewIfNeeded();
    await shot('shortcuts-1200x800-input-group');
    const rowIds = await page.locator('[data-testid^="shortcut-row-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid').replace('shortcut-row-', '')));
    const rows = [];
    for (const id of rowIds) {
      const row = await page.locator(`[data-testid="shortcut-row-${id}"]`).boundingBox();
      const label = await page.locator(`[data-testid="shortcut-label-${id}"]`).boundingBox();
      const right = id === 'send' ? await page.locator('[role="radiogroup"][aria-label="发送消息"]').boundingBox() : await page.locator(`[data-testid="shortcut-chips-${id}"]`).boundingBox();
      rows.push({ id, rowH: row.height, labelX: label.x, rowMid: row.y + row.height / 2, rightMid: right.y + right.height / 2, rightEnd: right.x + right.width });
    }
    console.log('\n| row | row h | label x | chips right | chips mid − row mid |');
    console.log('|---|---:|---:|---:|---:|');
    for (const r of rows) console.log(`| ${r.id} | ${r.rowH.toFixed(1)} | ${r.labelX.toFixed(1)} | ${r.rightEnd.toFixed(1)} | ${(r.rightMid - r.rowMid).toFixed(2)} |`);
    console.log('');
    const fresh = rows.filter(r => r.id.startsWith('input.voice'));
    const old = rows.filter(r => !r.id.startsWith('input.voice'));
    ck('page: 两条新行都在', fresh.length === 2, String(fresh.length));
    const span = (xs) => Math.max(...xs) - Math.min(...xs);
    ck('page: 键帽右边缘所有行一致 ±1px', span(rows.map(r => r.rightEnd)) <= 1, `span=${span(rows.map(r => r.rightEnd)).toFixed(2)}`);
    ck('page: 新行标签左边缘 = 原有行 ±1px', fresh.every(f => Math.abs(f.labelX - old[0].labelX) <= 1) && span(old.map(r => r.labelX)) <= 1);
    const navH = rows.find(r => r.id === 'nav.search').rowH;
    ck('page: 新行行高 = 原有可改行 ±1px', fresh.every(f => Math.abs(f.rowH - navH) <= 1), fresh.map(f => f.rowH).join(','));
    ck('page: 新行键帽垂直居中于行 ≤1px', fresh.every(f => Math.abs(f.rightMid - f.rowMid) <= 1));

    // ── rebind ───────────────────────────────────────────────────────────────
    await page.locator('[data-testid="shortcut-row-input.voiceHold"]').click();
    ck('rebind: 点行进入录入', await page.locator('[data-testid="shortcut-capturing-input.voiceHold"]').isVisible());
    await page.keyboard.press('Control+Shift+KeyM');
    const warn = await page.locator('[data-testid="shortcut-warning-input.voiceHold"]').innerText();
    const warnP = await painted(page, 'shortcut-warning-input.voiceHold');
    ck('rebind: Ctrl+Shift+M → 与「语音输入开关」冲突', warn.includes('语音输入开关') && seen(warnP), `${warn} ${pd(warnP)}`);
    await page.keyboard.press('Control+Space');
    const warn2 = await page.locator('[data-testid="shortcut-warning-input.voiceHold"]').innerText();
    const warn2P = await painted(page, 'shortcut-warning-input.voiceHold');
    ck('rebind: Ctrl+Space → 系统输入法切换,拒绝', warn2.includes('输入法') && seen(warn2P), `${warn2} ${pd(warn2P)}`);
    await shot('shortcuts-voice-conflict');
    await page.keyboard.press('F8');
    const f8P = await painted(page, 'shortcut-chips-input.voiceHold');
    ck('rebind: F8 保存并显示', norm(await page.locator('[data-testid="shortcut-chips-input.voiceHold"]').innerText()) === 'F8' && seen(f8P), pd(f8P));
    ck('rebind: 改过出现「恢复默认」', await page.locator('[data-testid="shortcut-reset-input.voiceHold"]').isVisible());
    await shot('shortcuts-voice-rebound-f8');

    // ── sync:主窗口(没有打开的会话)按新组合 F8 → 该出「先打开一个会话」──────────
    page = main;
    await closeSettingsWindow();
    {
      const stored = await main.evaluate(() => localStorage.getItem('keyboard_shortcuts_v1'));
      await main.keyboard.press('F8');
      const synced = await main.locator('[data-testid="shortcut-toast"]').waitFor({ timeout: 2000 }).then(() => true, () => false);
      ck('sync: 设置窗改成 F8 后,主窗口不重开就认 F8', synced, `main localStorage=${stored} toast=${synced}`);
    }
    await reloadMain();
    await main.waitForFunction(() => !document.querySelector('[data-testid="shortcut-toast"]'), null, { timeout: 10000 }).catch(() => {});

    // ── nochat(主窗口,没有打开的会话 → 没有输入框;设置窗里快捷键不生效)──────────
    await page.keyboard.down('F8');
    for (let i = 0; i < 3; i++) await page.keyboard.down('F8'); // 自动重复
    await page.keyboard.up('F8');
    const toast = page.locator('[data-testid="shortcut-toast"]');
    const toastUp = await toast.waitFor({ timeout: 3000 }).then(() => true, () => false);
    const toastP = await painted(page, 'shortcut-toast');
    ck('nochat: 没有打开的会话时按住说话 →「先打开一个会话」', toastUp && (await toast.innerText()) === '先打开一个会话' && seen(toastP), pd(toastP));
    ck('nochat: 自动重复不叠提示(只有 1 个)', (await toast.count()) === 1);
    await shot('nochat-toast');
    ck('nochat: 没有录音、没有识别请求', (await page.evaluate(() => window.__asr.calls)) === 0 && !(await page.locator('[data-testid="voice-bar"]').count()));

    // ── f8(改绑后的组合)与旧组合 ──────────────────────────────────────────────
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'chat', alias: '示例-A' }));
    const input = page.locator('textarea[placeholder*="示例-A"]').first();
    await input.waitFor({ timeout: 10000 });
    await page.locator('[data-testid="voice-mic"]').waitFor({ timeout: 10000 });
    await page.waitForTimeout(400);
    const state = () => input.evaluate(el => ({ value: el.value, start: el.selectionStart, end: el.selectionEnd, focused: el === document.activeElement }));
    const caretTo = async (i) => { await input.click(); await input.evaluate((el, a) => el.setSelectionRange(a, a), i); await page.waitForTimeout(100); };
    const settle = async () => {
      await page.waitForFunction(() => !document.querySelector('[data-testid="voice-bar"]'), null, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(250);
    };
    const asrCalls = () => page.evaluate(() => window.__asr.calls);
    const say = (text) => page.evaluate(t => { window.__asr.next = t; }, text);

    await input.fill('明天去公司开会');
    await caretTo(2);
    await say('早上');
    let calls0 = await asrCalls();
    await page.keyboard.down('F8');
    await page.waitForTimeout(1300);
    await page.keyboard.up('F8');
    await settle();
    let s = await state();
    ck('f8: 改绑后按住 F8 → 插到光标处', s.value === '明天早上去公司开会' && s.start === 4, `${s.value} @${s.start}`);
    ck('f8: 识别 1 次', (await asrCalls()) - calls0 === 1);
    calls0 = await asrCalls();
    await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.down('Space');
    await page.waitForTimeout(800);
    const oldCombo = await page.locator('[data-testid="voice-bar"]').count();
    await page.keyboard.up('Space'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');
    await settle();
    ck('f8: 旧组合 Ctrl+Shift+Space 不再录音', oldCombo === 0 && (await asrCalls()) === calls0);
    // 恢复默认
    await page.keyboard.press('Control+Comma');
    page = await settingsWindow('rebind: Ctrl+,');
    await page.locator('[data-testid="shortcut-reset-input.voiceHold"]').click();
    const resetP = await painted(page, 'shortcut-chips-input.voiceHold');
    ck('rebind: 恢复默认 → Ctrl Shift Space', norm(await page.locator('[data-testid="shortcut-chips-input.voiceHold"]').innerText()) === 'Ctrl Shift Space' && seen(resetP), pd(resetP));
    page = main;
    await closeSettingsWindow();
    await reloadMain(); // 同 sync:主窗口不会自己重读
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'chat', alias: '示例-A' }));
    await input.waitFor({ timeout: 10000 });
    await page.waitForTimeout(400);

    // ── hold ─────────────────────────────────────────────────────────────────
    await input.fill('明天去公司开会');
    await caretTo(2);
    await say('上午');
    calls0 = await asrCalls();
    await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.down('Space');
    for (let i = 0; i < 3; i++) { await page.waitForTimeout(150); await page.keyboard.down('Space'); } // 自动重复(repeat=true)
    await page.waitForTimeout(900);
    const ind = page.locator('[data-testid="voice-bar"]');
    ck('hold: 按住期间输入框底部换成录音条', await ind.isVisible());
    const elapsed = await page.locator('[data-testid="voice-bar-elapsed"]').innerText().catch(() => '');
    const bars = await page.locator('[data-testid="voice-bar-level"] > div').evaluateAll(els => els.map(e => e.getBoundingClientRect().height)); // 先采电平:假麦克风是间歇的,晚采会落进静音
    const elapsedP = await painted(page, 'voice-bar-elapsed');
    ck('hold: 录音条有计时', /^00:0[1-9]$/.test(elapsed) && seen(elapsedP), `${elapsed} ${pd(elapsedP)}`);
    ck('hold: 录音条有电平条(假麦克风有声音 → 不全是最低)', bars.length === 7 && Math.max(...bars) > 4, bars.join(','));
    const hint = await page.locator('[data-testid="voice-bar-hint"]').innerText();
    const hintP = await painted(page, 'voice-bar-hint');
    ck('hold: 提示「松开 Ctrl+Shift+Space 完成 · Esc 取消」', hint === '松开 Ctrl+Shift+Space 完成 · Esc 取消' && seen(hintP), `${hint} ${pd(hintP)}`);
    ck('hold: 麦克风那张大浮层不出现', !(await page.locator('[data-testid="voice-overlay"]').count()));
    ck('hold: 发送键提示暂时让位', !(await page.locator('[data-testid="composer-shortcut-hint"]').count()));
    const during = await state();
    ck('hold: 按住期间输入框没被打进空格、焦点不丢', during.value === '明天去公司开会' && during.focused, JSON.stringify(during));
    const indBox = await ind.boundingBox();
    const boxOf = await input.locator('xpath=..').boundingBox();
    ck('hold: 快捷键录音用的是输入框里那条录音条(在输入框盒子里、＋/发送让位)', indBox.y >= boxOf.y - 0.5 && indBox.y + indBox.height <= boxOf.y + boxOf.height + 0.5 && !(await page.locator('[data-testid="composer-desktop-plus"]').count()), `bar=${JSON.stringify(indBox)} composer=${JSON.stringify(boxOf)}`);
    await shot('hold-recording-indicator');
    await page.keyboard.up('Space');
    await settle();
    await page.keyboard.up('Shift'); await page.keyboard.up('Control');
    await page.waitForTimeout(200);
    s = await state();
    ck('hold: 松开 → 「明天|去公司开会」+「上午」插到光标处', s.value === '明天上午去公司开会', s.value);
    ck('hold: 光标紧跟插入文字(4)、焦点在输入框', s.start === 4 && s.end === 4 && s.focused, `${s.start},${s.end} focused=${s.focused}`);
    ck('hold: 识别只请求 1 次(自动重复没有重开录音;先松 Space 再松 Ctrl/Shift 没有第二次)', (await asrCalls()) - calls0 === 1, String((await asrCalls()) - calls0));
    await shot('hold-inserted');
    await page.keyboard.type('9');
    s = await state();
    ck('hold: 接着打字落在光标处', s.value === '明天上午9去公司开会', s.value);

    // ── esc ──────────────────────────────────────────────────────────────────
    await input.fill('明天去公司开会');
    await caretTo(2);
    await say('不该出现');
    calls0 = await asrCalls();
    await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.down('Space');
    await page.waitForTimeout(1000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const cancelledNotice = await page.getByText('已取消', { exact: true }).isVisible().catch(() => false);
    await page.keyboard.up('Space'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');
    await settle();
    s = await state();
    ck('esc: 按住中 Esc → 取消,草稿不变、没有识别', s.value === '明天去公司开会' && (await asrCalls()) === calls0, `${s.value} calls+${(await asrCalls()) - calls0}`);
    ck('esc: 提示「已取消」', cancelledNotice);

    // ── blur ─────────────────────────────────────────────────────────────────
    await input.fill('明天去公司开会');
    await caretTo(5);
    await say('三楼');
    calls0 = await asrCalls();
    await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.down('Space');
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await settle();
    s = await state();
    ck('blur: 按住中窗口失焦 → 当作松开,插入', s.value === '明天去公司三楼开会', s.value);
    await page.keyboard.up('Space'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');
    await page.waitForTimeout(600);
    s = await state();
    ck('blur: 之后松开按键不再插第二次', s.value === '明天去公司三楼开会' && (await asrCalls()) - calls0 === 1, `${s.value} calls+${(await asrCalls()) - calls0}`);

    // ── toggle ───────────────────────────────────────────────────────────────
    await input.fill('hello world');
    await caretTo(5);
    await say('big');
    calls0 = await asrCalls();
    await page.keyboard.press('Control+Shift+KeyM');
    await page.waitForTimeout(1300);
    ck('toggle: 按一下开始、松开后仍在录', await ind.isVisible());
    const thint = await page.locator('[data-testid="voice-bar-hint"]').innerText();
    const thintP = await painted(page, 'voice-bar-hint');
    ck('toggle: 提示「再按 Ctrl+Shift+M 完成 · Esc 取消」', thint === '再按 Ctrl+Shift+M 完成 · Esc 取消' && seen(thintP), `${thint} ${pd(thintP)}`);
    await shot('toggle-recording-indicator');
    await page.keyboard.press('Control+Shift+KeyM');
    await settle();
    s = await state();
    ck('toggle: 再按一下 → 结束并插到光标处(拉丁补空格)', s.value === 'hello big world' && s.start === 9, `${JSON.stringify(s.value)} @${s.start}`);
    ck('toggle: 识别 1 次', (await asrCalls()) - calls0 === 1);
    ck('toggle: 输入框里没有被打进 M', !/[Mm]$/.test(s.value.slice(0, s.start)));
  } catch (e) {
    ck(`driver threw: ${String(e?.message ?? e).split('\n')[0]}`, false);
  }
  ck('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ── mac:⌘⇧Space,先松 ⌘ ───────────────────────────────────────────────────────
{
  const { ctx, page, errors, settingsWindow, closeSettingsWindow } = await openApp({ mac: true });
  try {
    await page.getByRole('tab', { name: '设置', exact: true }).click();
    const sp = await settingsWindow('mac: 点「设置」');
    const macHoldP = await painted(sp, 'shortcut-chips-input.voiceHold');
    const macToggleP = await painted(sp, 'shortcut-chips-input.voiceToggle');
    ck('mac: 默认显示 ⌘ ⇧ Space / ⌘ ⇧ M', norm(await sp.locator('[data-testid="shortcut-chips-input.voiceHold"]').innerText()) === '⌘ ⇧ Space' && norm(await sp.locator('[data-testid="shortcut-chips-input.voiceToggle"]').innerText()) === '⌘ ⇧ M' && seen(macHoldP) && seen(macToggleP), `${pd(macHoldP)} / ${pd(macToggleP)}`);
    if (OUT) { await sp.locator('[data-testid="shortcut-row-input.voiceHold"]').scrollIntoViewIfNeeded(); await sp.screenshot({ path: `${OUT}/shortcuts-1200x800-mac-input-group.png` }); }
    await closeSettingsWindow();
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'chat', alias: '示例-A' }));
    const input = page.locator('textarea[placeholder*="示例-A"]').first();
    await input.waitFor({ timeout: 10000 });
    await page.locator('[data-testid="voice-mic"]').waitFor({ timeout: 10000 });
    await page.waitForTimeout(400);
    await input.fill('明天去公司开会');
    await input.click();
    await input.evaluate(el => el.setSelectionRange(2, 2));
    await page.evaluate(() => { window.__asr.next = '上午'; });
    await page.keyboard.down('Meta'); await page.keyboard.down('Shift'); await page.keyboard.down('Space');
    await page.waitForTimeout(1300);
    const hint = await page.locator('[data-testid="voice-bar-hint"]').innerText().catch(() => '');
    const macHintP = await painted(page, 'voice-bar-hint');
    ck('mac: 提示「松开 ⌘⇧Space 完成 · Esc 取消」', hint === '松开 ⌘⇧Space 完成 · Esc 取消' && seen(macHintP), `${hint} ${pd(macHintP)}`);
    await page.keyboard.up('Meta'); // 先松 ⌘:真 mac 上此时 Space 的 keyup 不会来
    await page.waitForFunction(() => !document.querySelector('[data-testid="voice-bar"]'), null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(250);
    const s = await input.evaluate(el => ({ value: el.value, start: el.selectionStart }));
    ck('mac: 松开 ⌘ 就结束并插入', s.value === '明天上午去公司开会' && s.start === 4, `${s.value} @${s.start}`);
    await page.keyboard.up('Space'); await page.keyboard.up('Shift');
    await page.waitForTimeout(400);
    ck('mac: 之后松开 Space / Shift 不再插第二次', (await input.inputValue()) === '明天上午去公司开会' && (await page.evaluate(() => window.__asr.calls)) === 1);
  } catch (e) {
    ck(`mac driver threw: ${String(e?.message ?? e).split('\n')[0]}`, false);
  }
  ck('mac: no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
web.close();
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { console.log('FAILED:\n  ' + failures.join('\n  ')); process.exit(1); }
