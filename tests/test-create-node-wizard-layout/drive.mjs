// 新建节点向导的版式(看板 #614,Vincent 10-06「这个界面感觉也有点丑」)。
// web export + tests/test-layout-sweep 的页内 Tauri 桩,不起 hub、不占端口、不碰 HOME;nothing touches 127.0.0.1:9200。
// 占位数据:守护 daemon-example / host-example,节点名 demo_agent。
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] \
//     node tests/test-create-node-wizard-layout/drive.mjs
//
// 视口 桌面 1200×850 / 手机 390×844 × 主题 浅 / 深 × runtime「Codex（TUI 共存）」/「Claude Agent SDK」,逐步走完:
//   (1) 🔴 没有空页:每一页的步骤区在标题+说明之后的内容块总高 ≥ 40px(不算内边距);共存 runtime 只走 名字 → Runtime → 确认
//       (模型 / 参数没有可选项,不出现),确认页有一行写出被跳过的两步;Claude 走满五步
//   (2) 步骤条:编号圆 = 显示的步数,编号连续 1..n,完成 / 当前 / 未到 三态的个数与所在步一致
//   (3) 上一步只回到显示过的步(共存:确认 → Runtime)
//   (4) 主机 chip:daemon 名 + 主机名 + 在线点
//   (5) 桌面:卡片最宽 720 且在内容区里水平居中(左右留白差 ≤ 2px);按钮在卡片底部(按钮底到卡片底 0..32px)
//       手机:没有卡片,按钮仍钉在窗口底部(±2px)
// 任一断言失败或页面打不开 → exit 1。先对改动前的 export 跑:必须红。
// MEASURE=1 额外打印每一页的测量表(PR 里那张表从这里来)。
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA, TEST_LOCALE } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const DAEMON = { daemon_node_id: 'd_example_1', alias: 'daemon-example', hostname: 'host-example', online: true, runtimes_supported: ['claude-agent-sdk', 'codex-app-server', 'grok-build-acp'], can_create_nodes: true };
const VIEWPORTS = [{ name: 'desktop-1200x850', w: 1200, h: 850, desktop: true }, { name: 'phone-390x844', w: 390, h: 844, mobile: true }];
const THEMES = ['light', 'dark'];
const RUNS = [
  { slug: 'codex-copresence', label: 'Codex（TUI 共存）', want: ['名字', 'Runtime', '确认'] },
  { slug: 'claude-agent-sdk', label: 'Claude Agent SDK', want: ['名字', 'Runtime', '模型', '参数', '确认'] },
];

const DEFAULT_STEPS = 5;
let fails = 0;
const ck = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`); };
const r1 = (n) => Math.round(n * 10) / 10;
const measures = [];

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
const settle = (page) => page.waitForTimeout(250);

// 当前页的几何与文字。按 testID 取(改动前的 export 没有这些 testID → 断言如实变红)。
const snapshot = (page) => page.evaluate(() => {
  const q = (s) => document.querySelector(`[data-testid="${s}"]`);
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom } : null;
  };
  const head = q('create-step-head');
  const body = q('create-step-body');
  const card = q('create-wizard-card');
  const footer = q('create-wizard-footer');
  const btns = footer ? [...footer.querySelectorAll('[role="button"], [tabindex="0"]')].map(rect).filter(Boolean) : [];
  const btnBox = btns.length ? { y: Math.min(...btns.map(b => b.y)), b: Math.max(...btns.map(b => b.b)) } : null;
  const stepper = q('create-stepper');
  const dots = stepper ? [...stepper.querySelectorAll('[data-testid^="create-step-dot-"]')] : [];
  const chip = q('create-host-chip');
  const skipped = q('create-skipped-note');
  // 标题+说明之后的内容块(步骤区里 head 的后继兄弟)的总高 —— 不含内边距,空页 = 0
  let after = head?.nextElementSibling, contentH = 0;
  for (; after; after = after.nextElementSibling) contentH += after.getBoundingClientRect().height;
  return {
    contentH,
    title: head ? (head.firstElementChild?.textContent ?? '').trim() : null,
    head: rect(head), body: rect(body), card: rect(card), cardParent: rect(card?.parentElement), footer: rect(footer), btnBox,
    dots: dots.map(d => ({ state: d.getAttribute('data-testid').replace('create-step-dot-', ''), text: (d.textContent || '').trim() })),
    chip: chip ? { text: chip.textContent || '', dot: !!q('create-host-online'), box: rect(chip) } : null,
    skipped: skipped && rect(skipped) ? (skipped.textContent || '') : null,
    submit: !!rect(q('create-node-submit')),
  };
});

for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ locale: TEST_LOCALE, colorScheme: theme, viewport: { width: vp.w, height: vp.h }, ...(vp.mobile ? { userAgent: ANDROID_UA, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    const page = await ctx.newPage();
    await page.addInitScript(initScript, { theme });
    await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
    for (const run of RUNS) {
      const tag = `${vp.name}-${theme}-${run.slug}`;
      try {
        await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 15000 });
        await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'agents' }));
        await page.evaluate((d) => window.__anetLayoutSweep.setScreen({ name: 'wizard', daemon: d }), DAEMON);
        await page.getByPlaceholder('例如 my-agent-1').fill('demo_agent');
        await settle(page);
        const pages = [];
        for (let i = 0; i < 6; i++) {
          // 第 2 步(Runtime):先选 runtime 再量 —— 步骤条跟着选中的 runtime 变
          if (i === 1) { await page.getByText(run.label, { exact: true }).first().click(); await settle(page); }
          const s = await snapshot(page);
          pages.push(s);
          if (OUT) await page.screenshot({ path: `${OUT}/${tag}-step${i + 1}.png` });
          if (s.submit || !(await page.getByText('下一步', { exact: true }).count())) break;
          await page.getByText('下一步', { exact: true }).click();
          await settle(page);
        }
        const titles = pages.map(p => p.title);
        ck(`${tag}: walks ${run.want.join(' → ')}`, JSON.stringify(titles) === JSON.stringify(run.want), titles.join(' → '));
        pages.forEach((p, i) => {
          const name = `${tag} step ${i + 1} (${p.title ?? '?'})`;
          // (1) 没有空页:步骤区 = 标题+说明 + 内容;内容至少 40px
          const content = p.head ? p.contentH : 0;
          ck(`🔴 ${name}: page has content below its title (${r1(content)}px ≥ 40)`, content >= 40);
          // (2) 步骤条三态
          // 第 1 步时还没选 runtime:步骤条按默认 runtime(这台 daemon 支持的第一个 = Claude Agent SDK,五步)画
          const n = i === 0 ? DEFAULT_STEPS : run.want.length;
          const states = p.dots.map(d => d.state).join(',');
          const wantStates = Array.from({ length: n }, (_, k) => (k < i ? 'done' : k === i ? 'current' : 'upcoming')).join(',');
          ck(`${name}: stepper ${n} dots done/current/upcoming`, states === wantStates, states);
          const nums = p.dots.map((d, k) => (d.state === 'done' ? String(k + 1) : d.text));
          ck(`${name}: stepper numbers run 1..${n}`, nums.join() === Array.from({ length: n }, (_, k) => String(k + 1)).join(), nums.join());
          // (4) 主机 chip
          ck(`${name}: host chip shows daemon + host + online dot`, !!p.chip && p.chip.text.includes('daemon-example') && p.chip.text.includes('host-example') && p.chip.dot);
          // (5) 版式
          if (vp.desktop) {
            const c = p.card, par = p.cardParent;
            const left = c && par ? c.x - par.x : NaN, right = c && par ? par.r - c.r : NaN;
            const gap = c && p.btnBox ? c.b - p.btnBox.b : NaN;
            ck(`${name}: card ≤ 720 wide and centred (left ${r1(left)} / right ${r1(right)})`, !!c && c.w <= 720.5 && Math.abs(left - right) <= 2);
            ck(`${name}: buttons sit at the card's bottom (card bottom − buttons bottom = ${r1(gap)}px, 0..32)`, gap >= 0 && gap <= 32 && !!p.body && p.btnBox.y >= p.body.b - 1);
            measures.push({ tag, step: `${i + 1} ${p.title}`, cardW: c ? r1(c.w) : '—', left: r1(left), right: r1(right), diff: r1(Math.abs(left - right)), btnGap: r1(gap), btnBelowBody: p.body && p.btnBox ? r1(p.btnBox.y - p.body.b) : '—' });
          } else {
            ck(`${name}: phone has no card`, !p.card);
            ck(`${name}: phone buttons pinned to the window bottom`, !!p.footer && Math.abs(p.footer.b - vp.h) <= 2, p.footer ? `footer bottom ${r1(p.footer.b)} / ${vp.h}` : 'no footer');
          }
        });
        const last = pages[pages.length - 1];
        if (run.slug === 'codex-copresence') {
          ck(`🔴 ${tag}: confirm page has one line for the skipped 模型 / 参数`, !!last.skipped && last.skipped.includes('模型：跟随宿主 TUI 的会员登录态') && last.skipped.includes('参数：这个 runtime 没有额外参数'), String(last.skipped));
          // (3) 上一步只回到显示过的步
          await page.getByText('上一步', { exact: true }).click();
          await settle(page);
          const back = await snapshot(page);
          ck(`${tag}: 上一步 from 确认 returns to Runtime`, back.title === 'Runtime', String(back.title));
        } else {
          ck(`${tag}: nothing skipped → no skipped line`, last.skipped === null, String(last.skipped));
        }
      } catch (e) {
        ck(`${tag}: case ran`, false, String(e?.message || e).split('\n')[0]);
        if (OUT) await page.screenshot({ path: `${OUT}/${tag}-crash.png` }).catch(() => {});
      }
    }
    await ctx.close();
  }
}
await browser.close();
web.close();
if (process.env.MEASURE) console.table(measures);
console.log(`\n${fails ? 'FAIL' : 'PASS'}: ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
