// 设置页重新设计 v1(#427,Vincent 原话「设置页面的账号挺丑的，设置页面其他也挺丑的」)—— 真应用里量真框。
// Hub 数据是 tests/test-layout-sweep/harness.mjs 的页内假数据;这里另桩三个账号(当前 / 本地工作区 / 另一个)、
// 本地 Hub 状态(占位端口 19299)和数据目录。不起 hub、不占端口、不碰 HOME。不进 CI:要 Playwright + Chromium。
//
//   WEB_DIR=<expo export 目录> [OUT=<截图目录>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-settings-redesign/drive.mjs
//
// 桌面 1440×900(设置窗口)和手机 390×844(安卓 UA),浅色 + 深色:
//   账号   当前账号一张卡、排第一、有「当前」小标和头像;其他账号每行头像 + ⋯;行里没有「复制 / 编辑 / 新窗口 / 移除」
//          文字按钮;危险操作(移除当前账号)单独在最下面;卡片左右边缘相等、行首(头像 / 图标)左边缘 = 卡片 + 16、
//          文字左边缘相等、› / ⋯ 右边缘相等且 = 卡片右边 − 16、行高 ≥ 48
//   ⋯      桌面:锚在 ⋯ 下面的菜单(右边缘对齐、上沿 = ⋯ 下沿 + 4),非当前账号第一项是「切换到这个账号」,移除在最后;
//          Esc 只关菜单。手机:底部动作面板(贴屏幕底)
//   其他页 桌面每个分类的内容都在卡片里,卡片左右边缘和账号页一致
//   v2     (#427 v2)本地 Hub / 外观 / 通知 / 语音输入 / 关于 的行是设置积木:每类至少 N 行;标签左边缘 = 卡片 + 16、
//          右侧控件(› / 值 / 开关 / 按钮 / 分段)右边缘 = 卡片右边 − 16、行高 ≥ 52;快捷键的分组标题也在卡片 + 16。
//          手机设置首页:每个分类一行(图标在卡片 + 16、文字左边缘相等、› 右边缘相等)、行高 ≥ 52、卡片左右 16。
// 打印测量表。任何一项不过 exit 1。对着改动前的导出跑应当红。
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA, openStubWindow } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

let pass = 0; const failures = [];
const ck = (name, ok, extra = '') => { if (ok) pass++; else failures.push(name); console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`); };
const table = [];
const r1 = (n) => Math.round(n * 10) / 10;
const span = (a) => a.length ? Math.max(...a) - Math.min(...a) : 0;
const rng = (a) => a.length ? `${r1(Math.min(...a))}..${r1(Math.max(...a))}` : '-';

const extraStub = () => {
  const inner = window.__TAURI_INTERNALS__;
  if (!inner) return;
  const invoke = inner.invoke;
  const profiles = {
    schema_version: 1,
    active_profile_id: 'p-sweep',
    profiles: [
      { profileId: 'p-sweep', serverUrl: 'http://mock-hub.invalid', username: 'tester', displayName: 'tester', networkId: 'net-sweep', createdAt: 0, updatedAt: 0 },
      { profileId: 'local-workspace', serverUrl: 'http://127.0.0.1:19299', username: 'local', displayName: '本地工作区', createdAt: 0, updatedAt: 0 },
      { profileId: 'p-demo-b', serverUrl: 'http://hub-b.invalid:9300', username: 'demo-b', displayName: '示例账号乙', networkId: 'net-demo-b', createdAt: 0, updatedAt: 0 },
    ],
  };
  const hub = { state: 'running', endpoint: 'http://127.0.0.1:19299', port: 19299, hubVersion: '0.0.0-fixture', logsPath: '/data/logs', requiresMigration: false, expectedHubVersion: '0.0.0-fixture' };
  inner.invoke = async (cmd, args) => {
    switch (cmd) {
      case 'list_desktop_profiles': return JSON.stringify(profiles);
      case 'desktop_storage_diagnostics': return JSON.stringify({ root: '/data/app', profile_count: 3, corrupt_backups: [] });
      case 'local_hub_status': return JSON.stringify(hub);
      default: return invoke(cmd, args);
    }
  };
};

// 账号区的几何:卡片、行首、文字、右侧 › / ⋯、行高;以及行里有没有旧的文字按钮。
const measureAccount = (root) => {
  const scope = document.querySelector(root);
  if (!scope) return null;
  const r = (el) => el.getBoundingClientRect();
  const vis = (el) => { const b = r(el); return b.width > 0 && b.height > 0; };
  const cards = [...scope.querySelectorAll('[data-testid="settings-kit-card"]')].filter(vis);
  const rows = [];
  for (const c of cards) {
    for (const label of c.querySelectorAll('[data-testid$="-label"]')) {
      const id = label.getAttribute('data-testid').slice(0, -'-label'.length);
      const row = [...c.querySelectorAll(`[data-testid="${id}"]`)].find(el => el.contains(label));
      if (!row || !vis(row)) continue;
      const lead = row.querySelector(`[data-testid="${id}-lead"]`);
      const acc = row.querySelector(`[data-testid="${id}-accessory"]`);
      rows.push({ id, cardL: r(c).left, cardR: r(c).right, leadL: lead ? r(lead).left : null, labelL: r(label).left, accR: acc ? r(acc).right : null, h: r(row).height });
    }
  }
  const firstCard = cards[0];
  const OLD = new Set(['复制', '编辑', '新窗口', '新窗口打开', '移除']);
  const oldButtons = [...scope.querySelectorAll('*')].filter(el => vis(el) && [...el.childNodes].some(n => n.nodeType === 3 && OLD.has(n.textContent.trim()))).map(el => el.textContent.trim());
  const profileRows = [...scope.querySelectorAll('[data-testid^="settings-profile-"]')].filter(el => el.querySelector(`[data-testid="${el.getAttribute('data-testid')}-label"]`));
  const danger = scope.querySelector('[data-testid="settings-account-danger"]') || [...scope.querySelectorAll('*')].find(el => el.textContent.trim() === '移除当前账号' && !el.children.length);
  const cardsBottom = Math.max(...cards.filter(c => !danger || !danger.contains(c)).map(c => r(c).bottom));
  return {
    cards: cards.length,
    cardL: cards.map(c => r(c).left), cardR: cards.map(c => r(c).right),
    rows,
    currentFirst: !!firstCard && !!firstCard.querySelector('[data-testid^="settings-profile-"][data-testid$="-current"]'),
    currentCount: scope.querySelectorAll('[data-testid^="settings-profile-"][data-testid$="-current"]').length,
    leads: profileRows.map(el => { const lead = el.querySelector('[data-testid$="-lead"]'); return lead ? r(lead).width : 0; }),
    more: scope.querySelectorAll('[data-testid^="settings-profile-"][data-testid$="-more"]').length,
    oldButtons,
    dangerLast: !!danger && r(danger).top >= cardsBottom - 0.5,
  };
};

// 积木行(有 `<id>-label` 的行)的几何:标签左边缘、行首、右侧控件右边缘、行高,各自相对所在卡片。
const measureKitRows = (root) => {
  const scope = document.querySelector(root);
  if (!scope) return null;
  const r = (el) => el.getBoundingClientRect();
  const vis = (el) => { const b = r(el); return b.width > 0 && b.height > 0; };
  const rows = [];
  for (const c of [...scope.querySelectorAll('[data-testid="settings-kit-card"]')].filter(vis)) {
    for (const label of c.querySelectorAll('[data-testid$="-label"]')) {
      const id = label.getAttribute('data-testid').slice(0, -'-label'.length);
      const row = [...c.querySelectorAll(`[data-testid="${id}"]`)].find(el => el.contains(label));
      if (!row || !vis(row)) continue;
      const lead = row.querySelector(`[data-testid="${id}-lead"]`);
      const trail = ['accessory', 'switch', 'control', 'button', 'value'].map(k => row.querySelector(`[data-testid="${id}-${k}"]`)).filter(el => el && vis(el));
      rows.push({ id, cardL: r(c).left, cardR: r(c).right, labelL: r(label).left, leadL: lead ? r(lead).left : null, trailR: trail.length ? Math.max(...trail.map(el => r(el).right)) : null, h: r(row).height });
    }
  }
  return rows;
};
const checkKitRows = (where, rows, min) => {
  const plain = rows.filter(x => x.leadL === null);
  const labelPad = plain.map(x => x.labelL - x.cardL);
  const trailed = rows.filter(x => x.trailR !== null);
  const trailPad = trailed.map(x => x.cardR - x.trailR);
  const minH = rows.length ? Math.min(...rows.map(x => x.h)) : 0;
  table.push({ where: `${where} v2`, rows: rows.length, labelPad: rng(labelPad), trailPad: rng(trailPad), minRowH: r1(minH) });
  ck(`${where} v2: 至少 ${min} 个积木行`, rows.length >= min, String(rows.length));
  ck(`${where} v2: 标签左边缘 = 卡片 + 16 ±1`, labelPad.every(v => Math.abs(v - 16) <= 1.5), rng(labelPad));
  ck(`${where} v2: 右侧控件右边缘 = 卡片右边 − 16 ±1`, trailed.length > 0 && trailPad.every(v => Math.abs(v - 16) <= 1.5), rng(trailPad));
  ck(`${where} v2: 行高 ≥ 52`, rows.length > 0 && minH >= 51.5, r1(minH));
};

const checkAccount = async (page, where, root, { danger = true } = {}) => {
  const m = await page.evaluate(measureAccount, root);
  if (!m) { ck(`${where}: 账号区存在`, false); return null; }
  const withLead = m.rows.filter(x => x.leadL !== null);
  const leadPad = withLead.map(x => x.leadL - x.cardL);
  const labels = withLead.map(x => x.labelL);
  const accs = m.rows.filter(x => x.accR !== null);
  const accPad = accs.map(x => x.cardR - x.accR);
  const minH = m.rows.length ? Math.min(...m.rows.map(x => x.h)) : 0;
  table.push({ where, cards: m.cards, rows: m.rows.length, cardL: rng(m.cardL), cardR: rng(m.cardR), leadPad: rng(leadPad), labelL: rng(labels), accR: rng(accs.map(x => x.accR)), accPad: rng(accPad), minRowH: r1(minH) });
  ck(`${where}: 当前账号单独一张卡、排第一、有「当前」`, m.currentFirst && m.currentCount === 1);
  ck(`${where}: 每个账号有头像(行首 ≥ 36 宽)`, m.leads.length === 3 && m.leads.every(w => w >= 36), JSON.stringify(m.leads.map(r1)));
  ck(`${where}: 每个账号一个 ⋯`, m.more === 3, String(m.more));
  ck(`${where}: 行里没有「复制 / 编辑 / 新窗口 / 移除」文字按钮`, m.oldButtons.length === 0, m.oldButtons.slice(0, 6).join(','));
  if (danger) ck(`${where}: 危险操作单独在最下面`, m.dangerLast);
  ck(`${where}: 卡片左右边缘相等 ±1`, m.cards >= 3 && span(m.cardL) <= 1 && span(m.cardR) <= 1, `${rng(m.cardL)} / ${rng(m.cardR)}`);
  ck(`${where}: 行首左边缘 = 卡片 + 16 ±1`, withLead.length >= 5 && leadPad.every(v => Math.abs(v - 16) <= 1), rng(leadPad));
  ck(`${where}: 文字左边缘相等 ±1`, span(labels) <= 1, rng(labels));
  ck(`${where}: › / ⋯ 右边缘相等、= 卡片右边 − 16 ±1`, accs.length >= 4 && span(accs.map(x => x.accR)) <= 1 && accPad.every(v => Math.abs(v - 16) <= 1), `${rng(accs.map(x => x.accR))} pad ${rng(accPad)}`);
  ck(`${where}: 行高 ≥ 48`, m.rows.length > 0 && minH >= 47.5, r1(minH));
  return m;
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });

// ── 桌面 1440×900 ────────────────────────────────────────────────────────────────────────────────
for (const theme of ['light', 'dark']) {
  const where = `desktop/${theme}`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme, deviceScaleFactor: 1, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const errors = [];
  try {
    await page.addInitScript(initScript, { theme });
    await page.addInitScript(extraStub);
    await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
    await page.locator('[data-testid="desktop-rail"]').waitFor({ timeout: 20000 });
    await page.getByRole('tab', { name: '设置', exact: true }).click();
    const win = await openStubWindow(page, 'settings', [[initScript, { theme }], [extraStub]]);
    ck(`${where}: 设置窗口打开`, !!win);
    if (!win) throw new Error('no settings window');
    win.on('pageerror', e => errors.push(String(e).split('\n')[0]));
    await win.setViewportSize({ width: 1440, height: 900 });
    await win.locator('[data-testid="dedicated-settings-window"]').waitFor({ timeout: 20000 });
    await win.getByRole('button', { name: '设置分类 账号' }).click();
    await win.locator('[data-testid="settings-section-account"]').waitFor({ timeout: 8000 });
    await win.waitForTimeout(700);
    if (OUT) await win.screenshot({ path: `${OUT}/desktop-${theme}-account.png` });
    const acc = await checkAccount(win, `${where} 账号`, '[data-testid="settings-section-account"]');

    // ⋯ 菜单
    try {
      const more = win.locator('[data-testid="settings-profile-p-demo-b-more"]');
      const mb = await more.boundingBox();
      await more.click();
      await win.locator('[data-testid="account-menu"]').waitFor({ timeout: 4000 });
      await win.waitForTimeout(200);
      const menu = await win.locator('[data-testid="account-menu"]').boundingBox();
      const items = await win.locator('[data-testid="account-menu"] [role="menuitem"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
      table.push({ where: `${where} ⋯`, more: mb && `${r1(mb.x)},${r1(mb.y)} ${r1(mb.width)}×${r1(mb.height)}`, menu: menu && `${r1(menu.x)},${r1(menu.y)} ${r1(menu.width)}×${r1(menu.height)}`, dRight: mb && menu ? r1(menu.x + menu.width - (mb.x + mb.width)) : null, dTop: mb && menu ? r1(menu.y - (mb.y + mb.height)) : null });
      if (OUT) await win.screenshot({ path: `${OUT}/desktop-${theme}-account-menu.png` });
      ck(`${where} ⋯: 菜单右边缘对齐 ⋯ ±1、上沿 = ⋯ 下沿 + 4 ±1`, !!(mb && menu) && Math.abs(menu.x + menu.width - (mb.x + mb.width)) <= 1 && Math.abs(menu.y - (mb.y + mb.height) - 4) <= 1);
      ck(`${where} ⋯: 切换 → … → 移除(最后)`, items[0] === 'settings-switch-to-p-demo-b' && items.at(-1) === 'settings-remove-p-demo-b' && items.includes('settings-copy-p-demo-b') && items.includes('settings-edit-p-demo-b'), items.join(','));
      await win.keyboard.press('Escape');
      await win.waitForTimeout(400);
      ck(`${where} ⋯: Esc 只关菜单(账号页还在)`, (await win.locator('[data-testid="account-menu"]').count()) === 0 && await win.locator('[data-testid="settings-section-account"]').isVisible());
      await win.locator('[data-testid="settings-profile-p-sweep-more"]').click();
      await win.locator('[data-testid="account-menu"]').waitFor({ timeout: 4000 });
      const cur = await win.locator('[data-testid="account-menu"] [role="menuitem"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
      ck(`${where} ⋯: 当前账号的菜单里没有「切换到这个账号」`, !cur.some(id => id.startsWith('settings-switch-to-')), cur.join(','));
      await win.keyboard.press('Escape');
      await win.waitForTimeout(300);
    } catch (e) { ck(`${where} ⋯: 菜单`, false, String(e.message || e).split('\n')[0]); }

    // 其他分类:内容在卡片里、和账号页同一列
    for (const label of ['本地 Hub', '外观', '通知', '语音输入', '快捷键', '关于']) {
      try {
        await win.getByRole('button', { name: `设置分类 ${label}` }).click({ timeout: 4000 });
        await win.waitForTimeout(600);
        if (OUT) await win.screenshot({ path: `${OUT}/desktop-${theme}-${label}.png` });
        const cards = await win.evaluate(() => [...document.querySelectorAll('[data-testid="settings-scroll"] [data-testid="settings-kit-card"]')].map(c => c.getBoundingClientRect()).filter(b => b.width > 0).map(b => [b.left, b.right]));
        const ls = cards.map(c => c[0]), rs = cards.map(c => c[1]);
        table.push({ where: `${where} ${label}`, cards: cards.length, cardL: rng(ls), cardR: rng(rs) });
        ck(`${where} ${label}: 内容在卡片里、和账号页卡片同一列 ±1`, cards.length >= 1 && !!acc && [...ls, ...acc.cardL].every(v => Math.abs(v - acc.cardL[0]) <= 1) && [...rs, ...acc.cardR].every(v => Math.abs(v - acc.cardR[0]) <= 1), `${cards.length} cards ${rng(ls)} / ${rng(rs)}`);
        const MIN = { '本地 Hub': 7, '外观': 4, '通知': 4, '语音输入': 3, '关于': 3 }; // #695：连接复用移进隐藏的诊断组，关于页可见行 4→3
        if (MIN[label]) checkKitRows(`${where} ${label}`, (await win.evaluate(measureKitRows, '[data-testid="settings-scroll"]')) ?? [], MIN[label]);
        if (label === '通知') {
          // 「把下面的信息复制给维护者」要在诊断卡片上面(caption),不能在卡片下面指空。
          const g = await win.evaluate(() => {
            const grp = document.querySelector('[data-testid="notify-diagnostics-group"]');
            const cap = grp?.querySelector('[data-testid="settings-kit-caption"]'), card = grp?.querySelector('[data-testid="settings-kit-card"]');
            const foot = grp?.querySelector('[data-testid="settings-kit-footer"]');
            return { cap: cap ? [cap.textContent, cap.getBoundingClientRect().bottom] : null, cardTop: card ? card.getBoundingClientRect().top : null, foot: foot?.textContent ?? null };
          });
          table.push({ where: `${where} 通知诊断说明`, caption: g.cap ? `${g.cap[0].slice(0, 14)}… bottom ${r1(g.cap[1])}` : 'none', cardTop: g.cardTop === null ? 'none' : r1(g.cardTop), footer: g.foot ?? '-' });
          ck(`${where} 通知: 「把下面的信息…」在诊断卡片上方`, !!g.cap && /下面/.test(g.cap[0]) && g.cardTop !== null && g.cap[1] <= g.cardTop + 0.5 && !/下面/.test(g.foot ?? ''), JSON.stringify(g));
        }
        if (label === '快捷键') {
          const pads = await win.evaluate(() => [...document.querySelectorAll('[data-testid^="shortcut-group-"]')].map(t => { const c = t.closest('[data-testid="settings-kit-card"]'); return c ? t.getBoundingClientRect().left + parseFloat(getComputedStyle(t).paddingLeft) - c.getBoundingClientRect().left : null; }));
          table.push({ where: `${where} 快捷键 v2`, groupTitlePad: pads.map(v => v === null ? 'none' : r1(v)).join(',') });
          ck(`${where} 快捷键 v2: 分组标题左边缘 = 卡片 + 16 ±1`, pads.length >= 2 && pads.every(v => v !== null && Math.abs(v - 16) <= 1), pads.map(v => v === null ? 'none' : r1(v)).join(','));
        }
      } catch (e) { ck(`${where} ${label}: 打开`, false, String(e.message || e).split('\n')[0]); }
    }
  } catch (e) { ck(`${where}: run`, false, String(e.message || e).split('\n')[0]); }
  ck(`${where}: 没有页面错误`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ── 手机 390×844 ─────────────────────────────────────────────────────────────────────────────────
for (const theme of ['light', 'dark']) {
  const where = `phone/${theme}`;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: ANDROID_UA, hasTouch: true, colorScheme: theme, deviceScaleFactor: 2, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
  try {
    await page.addInitScript(initScript, { theme });
    await page.addInitScript(extraStub);
    await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
    await page.getByText('示例-A', { exact: true }).first().waitFor({ timeout: 20000 });
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'settings' }));
    await page.locator('[data-testid="settings-row-account"]').click();
    await page.locator('[data-testid="settings-subpage-account"]').waitFor({ timeout: 8000 });
    await page.waitForTimeout(600);
    if (OUT) await page.screenshot({ path: `${OUT}/phone-${theme}-account.png` });
    // 手机的危险操作(退出登录)本来就单独在设置首页最下面一块(微信那样),账号子页不重复放一个。
    const m = await checkAccount(page, `${where} 账号`, '[data-testid="settings-subpage-account"]', { danger: false });
    if (m) ck(`${where} 账号: 卡片左右边距 16 ±1`, m.cardL.every(v => Math.abs(v - 16) <= 1) && m.cardR.every(v => Math.abs(390 - v - 16) <= 1), `${rng(m.cardL)} / ${rng(m.cardR)}`);
    try {
      await page.locator('[data-testid="settings-profile-p-demo-b-more"]').tap();
      await page.locator('[data-testid="account-sheet"]').waitFor({ timeout: 4000 });
      await page.waitForTimeout(500);
      const sheet = await page.locator('[data-testid="account-sheet"]').boundingBox();
      const acts = await page.locator('[data-testid^="account-sheet-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
      table.push({ where: `${where} ⋯ sheet`, sheet: sheet && `${r1(sheet.x)},${r1(sheet.y)} ${r1(sheet.width)}×${r1(sheet.height)}` });
      if (OUT) await page.screenshot({ path: `${OUT}/phone-${theme}-account-sheet.png` });
      ck(`${where} ⋯: 底部动作面板(贴屏幕底、整宽)`, !!sheet && Math.abs(sheet.y + sheet.height - 844) <= 1 && Math.abs(sheet.width - 390) <= 1, sheet ? `${r1(sheet.y)}+${r1(sheet.height)}` : 'none');
      ck(`${where} ⋯: 复制 / 编辑 / 移除`, ['account-sheet-copy', 'account-sheet-edit', 'account-sheet-remove'].every(id => acts.includes(id)), acts.join(','));
      await page.locator('[data-testid="account-sheet-cancel"]').tap();
      await page.waitForTimeout(400);
    } catch (e) { ck(`${where} ⋯: 动作面板`, false, String(e.message || e).split('\n')[0]); }
    await page.locator('[data-testid="settings-back"]').click();
    await page.locator('[data-testid="settings-phone-list"]').waitFor({ timeout: 5000 });
    await page.waitForTimeout(300);
    if (OUT) await page.screenshot({ path: `${OUT}/phone-${theme}-list.png`, fullPage: true });
    // v2:设置首页每个分类一行积木(图标 · 名字 · 值 · ›)
    const list = (await page.evaluate(measureKitRows, '[data-testid="settings-phone-list"]')) ?? [];
    const cats = list.filter(x => x.id.startsWith('settings-row-'));
    const leadPad = cats.map(x => x.leadL === null ? null : x.leadL - x.cardL);
    const labels = cats.map(x => x.labelL), trails = cats.map(x => x.trailR).filter(v => v !== null);
    const cardLs = cats.map(x => x.cardL), cardRs = cats.map(x => 390 - x.cardR);
    table.push({ where: `${where} 首页 v2`, rows: cats.length, leadPad: leadPad.map(v => v === null ? 'none' : r1(v)).join(','), labelL: rng(labels), accR: rng(trails), gutter: `${rng(cardLs)} / ${rng(cardRs)}`, minRowH: cats.length ? r1(Math.min(...cats.map(x => x.h))) : 0 });
    ck(`${where} 首页 v2: 每个分类一行积木(≥ 6)`, cats.length >= 6, String(cats.length));
    ck(`${where} 首页 v2: 图标在卡片 + 16 ±1`, leadPad.length > 0 && leadPad.every(v => v !== null && Math.abs(v - 16) <= 1.5), leadPad.join(','));
    ck(`${where} 首页 v2: 文字左边缘相等 ±1、› 右边缘相等 ±1`, span(labels) <= 1 && trails.length === cats.length && span(trails) <= 1, `${rng(labels)} / ${rng(trails)}`);
    ck(`${where} 首页 v2: 卡片左右 16 ±1、行高 ≥ 52`, cardLs.every(v => Math.abs(v - 16) <= 1) && cardRs.every(v => Math.abs(v - 16) <= 1) && cats.every(x => x.h >= 51.5));
    const last = await page.evaluate(() => {
      const list = document.querySelector('[data-testid="settings-phone-list"]');
      const blocks = [...list.querySelectorAll('[data-testid]')].filter(el => el.getBoundingClientRect().height > 30);
      const out = document.querySelector('[data-testid="settings-logout-block"]');
      return !!out && blocks.every(el => el === out || out.contains(el) || el.contains(out) || el.getBoundingClientRect().bottom <= out.getBoundingClientRect().top + 0.5);
    });
    ck(`${where}: 退出登录单独在设置首页最下面`, last);
  } catch (e) { ck(`${where}: run`, false, String(e.message || e).split('\n')[0]); }
  ck(`${where}: 没有页面错误`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}
await browser.close(); web.close();

console.log('\nmeasurements (CSS px):');
console.table(table);
console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) { console.log('FAILED:\n  ' + failures.join('\n  ')); process.exit(1); }
