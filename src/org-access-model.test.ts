// 2026-11-14 设置 →「组织与权限」:页签只按权限出;选中的页签失效时回到第一个;搜索落到对应页;没人用的块不画。
import { readFileSync } from 'node:fs';
import { ORG_ACCESS_TAB_LABEL, orgAccessTabs, rememberedTab, resolveOrgAccessTab, showWhenUsed, tabForSettingsRow } from './org-access-model';
import { settingsPair } from './i18n-settings';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? '✓' : '✗'} ${name}`); };

ck('管理员:部门与 Agent、成员与权限 两个页签,部门在前', JSON.stringify(orgAccessTabs(true)) === JSON.stringify(['org', 'members']));
ck('普通成员:只有部门与 Agent(不画页签条)', JSON.stringify(orgAccessTabs(false)) === JSON.stringify(['org']));
ck('没选过 → 第一个', resolveOrgAccessTab(null, orgAccessTabs(true)) === 'org');
ck('选了成员 → 成员', resolveOrgAccessTab('members', orgAccessTabs(true)) === 'members');
ck('🔴 权限没了(或切了网络)还停在成员页 → 退回部门页,不把成员管理漏给非管理员', resolveOrgAccessTab('members', orgAccessTabs(false)) === 'org');
ck('搜索命中成员 / 新建用户 → 直接落在成员页', tabForSettingsRow('members') === 'members' && tabForSettingsRow('newUser') === 'members');
ck('搜索命中部门 → 部门页;其他行 → 不指定', tabForSettingsRow('org') === 'org' && tabForSettingsRow('theme') === null && tabForSettingsRow(undefined) === null);
ck('有数据才出现:空数组 / null / undefined 都不画', !showWhenUsed([]) && !showWhenUsed(null) && !showWhenUsed(undefined));
ck('有数据才出现:有一条就画', showWhenUsed([1]));
ck('页签名都有英文', Object.values(ORG_ACCESS_TAB_LABEL).every(l => !!settingsPair(l)?.[1]));
ck('入口名「组织与权限」有英文', settingsPair('组织与权限')?.[1] === 'Organization & access');

ck('同一账号 + 网络 → 沿用上次的页签', rememberedTab({ scope: 'hub|u1|n1', tab: 'members' }, 'hub|u1|n1') === 'members');
ck('🔴 换了账号(管理员 A 退出、B 登录)→ 不沿用', rememberedTab({ scope: 'hub|u1|n1', tab: 'members' }, 'hub|u2|n1') === null);
ck('换了网络 → 不沿用;没记过 → 不沿用', rememberedTab({ scope: 'hub|u1|n1', tab: 'members' }, 'hub|u1|n2') === null && rememberedTab(null, 'x') === null);

const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
const page = src('./OrgAccessPage.tsx');
ck('页签条只在多于一个页签时画', page.includes('tabs.length > 1 ?'));
ck('页签是 tab 角色并带选中态(读屏)', page.includes('accessibilityRole="tab"') && page.includes('accessibilityState={{ selected: tab === k }}'));
ck('从成员三级页返回后仍停在上次的页签', page.includes('let lastTab') && page.includes('lastTab = { scope, tab: k }') && page.includes('rememberedTab(lastTab, scope)'));
ck('🔴 桌面原地搜索:initialTab 变了页签跟着变(只跟非空值,不覆盖手动点的)', /useEffect\(\(\) => \{ if \(initialTab\) setWantState\(initialTab\); \}, \[initialTab\]\);/.test(page));
ck('记页签的 scope 来自账号 + 网络(桌面与手机都传)', src('./SettingsScreen.tsx').includes('scope={orgAccessScope}') && src('./SettingsPhonePages.tsx').includes('scope={ctx.orgAccessScope}') && src('./SettingsScreen.tsx').includes("authMe?.user?.user_id"));
ck('Agent 团队空着时整块不画,且不再留永远走不到的旧 Hub 分支', src('./AgentTeams.tsx').includes('if (!showWhenUsed(teams)) return null;') && !src('./AgentTeams.tsx').includes('team-old-hub'));
ck('Agent 分组空着时整块不画', src('./UserManagementPanel.tsx').includes('{showWhenUsed(agentGroups) ? ('));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
