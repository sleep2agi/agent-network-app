// 纯逻辑单测(bun/node 可跑·无 RN 依赖)。run: bun src/message-menu-model.test.ts
import fs from 'node:fs';
import path from 'node:path';
import { messageMenuGroups, messageMenuKeys, selectionBarActions } from './message-menu-model';
let p = 0, t = 0; const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

const full = { hasText: true, canForward: true };

// ── 分组边界:微信的形状是三组,不是一条流水账 ──────────────────
ck('有正文时三组', messageMenuGroups(full).length === 3);
ck('第一组 = 复制/引用', JSON.stringify(messageMenuGroups(full)[0].map(i => i.key)) === JSON.stringify(['copy', 'quote']));
ck('第二组 = 转发/多选/放大阅读', JSON.stringify(messageMenuGroups(full)[1].map(i => i.key)) === JSON.stringify(['forward', 'multiSelect', 'expand']));
ck('第三组只有删除', JSON.stringify(messageMenuGroups(full)[2].map(i => i.key)) === JSON.stringify(['delete']));
ck('转发带省略号(要选目标)', messageMenuGroups(full)[1][0].label === '转发…');

// ── danger 只落在删除上,且它和常用动作之间隔着组边界 ──────────
ck('只有删除是 danger', messageMenuGroups(full).flat().filter(i => i.danger).map(i => i.key).join() === 'delete');
ck('删除不与转发同组', messageMenuGroups(full).every(g => !(g.some(i => i.key === 'delete') && g.some(i => i.key === 'forward'))));
ck('删除是最后一组的唯一项', messageMenuGroups(full).at(-1)!.length === 1);

// ── 没有空组(一条分隔线下面什么都没有 = 渲染 bug) ──────────────
ck('任何输入都不产出空组', [full, { hasText: false }, { hasText: false, canForward: false }, { hasText: true, selectionMode: true }]
  .every(ctx => messageMenuGroups(ctx).every(g => g.length > 0)));

// ── 可用性 ────────────────────────────────────────────────
ck('无正文时没有复制/引用/转发/放大阅读', JSON.stringify(messageMenuKeys({ hasText: false })) === JSON.stringify(['multiSelect', 'delete']));
ck('无正文仍可删除', messageMenuKeys({ hasText: false }).includes('delete'));
ck('无正文时只剩两组', messageMenuGroups({ hasText: false }).length === 2);
ck('canForward=false 去掉转发但留其它', !messageMenuKeys({ hasText: true, canForward: false }).includes('forward')
  && messageMenuKeys({ hasText: true, canForward: false }).includes('expand'));
ck('已在多选里不再给多选', !messageMenuKeys({ ...full, selectionMode: true }).includes('multiSelect'));
ck('菜单里没有取消项(靠 Esc/点空白关)', !messageMenuKeys(full).some(k => String(k).includes('cancel')));

// ── 多选底栏 ──────────────────────────────────────────────
ck('底栏 0 选中 → 无动作', selectionBarActions(0, true).length === 0);
ck('底栏带计数', selectionBarActions(3, true)[0].label === '转发…（3）' && selectionBarActions(3, true)[1].label === '删除（3）');
ck('底栏删除是 danger', selectionBarActions(2, true).find(a => a.key === 'delete')!.danger === true);
ck('底栏 canForward=false 只剩删除', selectionBarActions(2, false).map(a => a.key).join() === 'delete');

// ── 源码契约:ChatScreen 真的按分组渲染,且没有取消行 ─────────────
const src = fs.readFileSync(path.join(__dirname, 'ChatScreen.tsx'), 'utf8').replace(/\r\n?/g, '\n');
ck('ChatScreen 用 messageMenuGroups 渲染', src.includes('messageMenuGroups(') && src.includes("from './message-menu-model'"));
ck('组之间渲染分隔(actionGroupGap)', src.includes('styles.actionGroupGap'));
ck('菜单不再有取消行(样式与旧间隔都删干净)', !src.includes('actionCancel') && !src.includes('actionSepGap'));
ck('删除项带 danger 样式', src.includes('item.danger && styles.actionDanger'));
ck('桌面端 Esc 关菜单', src.includes("'Escape'") && src.includes("addEventListener('keydown'") && src.includes('setMenuFor(null)'));
ck('放大阅读有独立 Modal', src.includes('expandFor') && src.includes('accessibilityLabel="放大阅读"'));
ck('多选模式有底栏和复选框', src.includes('selectionMode') && src.includes('selectionBarActions(') && src.includes('accessibilityLabel="选中"'));
ck('多选转发逐条 beginForward(失败即停)', src.includes('forwardBatch') && src.includes('已转发'));

console.log(`\n${p}/${t} passed`); process.exit(p === t ? 0 : 1);
