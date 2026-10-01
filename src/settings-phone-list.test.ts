// 手机窄屏的「设置」= 微信式单列分组列表(Vincent 2026-09-27)。ck-style:自执行,失败 exit 1。
//   模型:每个分类恰好落在一组里(新增分类忘了登记 → 红,而不是在手机上悄悄消失);
//        本平台没有的分类不出行、空组连标题一起不出;子页记忆随选分类写入、返回时清掉。
//   接线:子页的返回走 BackHandler(安卓)+ Esc(网页),弹窗开着时让给弹窗;退出登录要确认。
//   颜色:分组地面/行是独立 token,深浅两套都满足文字对比度(深色不是反色)。
import { readFileSync } from 'node:fs';
import {
  PHONE_SETTINGS_GROUPS,
  SETTINGS_CATEGORIES,
  closeSettingsPage,
  filterSettings,
  phoneRowLabel,
  phoneSettingsGroups,
  rememberSettingsCategory,
  rememberSettingsScroll,
  rememberedSettingsView,
  resetSettingsViewMemory,
} from './settings-model';
import { colors, setThemeMode } from './theme';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}`); };
const norm = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf-8').replace(/\r\n?/g, '\n');

// —— 分组覆盖:每个分类恰好一次 ——
{
  const grouped = PHONE_SETTINGS_GROUPS.flatMap((g) => g.keys);
  for (const c of SETTINGS_CATEGORIES) {
    ck(`分类「${c.label}」在手机分组里恰好出现一次`, grouped.filter((k) => k === c.key).length === 1);
  }
  ck('分组里没有不存在的分类键', grouped.every((k) => SETTINGS_CATEGORIES.some((c) => c.key === k)));
  ck('组标题 = 账号块(无标题) / 通用 / 功能 / 帮助与关于',
    JSON.stringify(PHONE_SETTINGS_GROUPS.map((g) => g.title)) === JSON.stringify([null, '通用', '功能', '帮助与关于']));
  ck('账号块在最上面', PHONE_SETTINGS_GROUPS[0].keys.length === 1 && PHONE_SETTINGS_GROUPS[0].keys[0] === 'account');
  ck('关于行叫「关于 Agent Network」', phoneRowLabel({ key: 'about', label: '关于' }) === '关于 Agent Network');
  ck('其它行用分类名', phoneRowLabel({ key: 'notifications', label: '通知' }) === '通知');
}

// —— 按平台/本地 Hub 筛 ——
{
  const android = phoneSettingsGroups(filterSettings('', { localHub: false }, undefined, 'android'));
  const keys = android.flatMap((g) => g.rows.map((r) => r.key));
  ck('安卓(无本地 Hub):账号 通知 外观 语音输入 关于', JSON.stringify(keys) === JSON.stringify(['account', 'notifications', 'appearance', 'voice', 'about']));
  const withLocal = phoneSettingsGroups(filterSettings('', { localHub: true }, undefined, 'desktop')).flatMap((g) => g.rows.map((r) => r.key));
  ck('装了本地 Hub → 本地 Hub 行出现在「通用」里', withLocal.includes('localHub'));
  const web = phoneSettingsGroups(filterSettings('', {}, undefined, 'web'));
  ck('网页没有语音输入 → 「功能」整组连标题一起不出', !web.some((g) => g.title === '功能'));
  ck('网页仍有 通用 与 帮助与关于', web.some((g) => g.title === '通用') && web.some((g) => g.title === '帮助与关于'));
}

// —— 子页记忆 ——
{
  resetSettingsViewMemory();
  ck('默认在列表上(page=null)', rememberedSettingsView().page === null);
  rememberSettingsCategory('voice');
  ck('选分类(含从聊天「去设置语音」)= 推入该子页', rememberedSettingsView().page === 'voice');
  rememberSettingsScroll(120);
  closeSettingsPage();
  const v = rememberedSettingsView();
  ck('返回:page 清空、滚动归零、分类保留(宽屏仍停在它上面)', v.page === null && v.scrollY === 0 && v.category === 'voice');
  rememberSettingsCategory('voice');
  ck('再进同一分类仍推入子页', rememberedSettingsView().page === 'voice');
  resetSettingsViewMemory();
}

// —— 接线(源码) ——
{
  const src = norm('./SettingsScreen.tsx');
  ck('子页状态从模块级记忆初始化(切主题重挂后仍在子页)', src.includes('useState<SettingsCategoryKey | null>(() => rememberedSettingsView().page)'));
  ck('安卓返回键:BackHandler 返回(先三级页再子页)并消费事件', /BackHandler\.addEventListener\('hardwareBackPress', \(\) => \{ goBack\(\); return true; \}\)/.test(src));
  ck('网页:Esc 返回', /event\.key === 'Escape'\) \{ event\.preventDefault\(\); goBack\(\); \}/.test(src));
  // 三级页可以接管返回(成员页推入的「选择 Agent」/「授权的项目」先退回成员页,#417)。
  ck('goBack:三级页推入的页先退,再退三级页,否则关子页', src.includes("if (target === 'detail' && headerBackRef.current) headerBackRef.current();") && src.includes("else if (target === 'detail') closeDetail();") && /else closePage\(\);\n  \};/.test(src));
  ck('弹窗开着时不抢返回(让给弹窗的 onRequestClose)', /if \(!subPage \|\| dialogOpen\) return;/.test(src)
    // 切换账号面板(2026-09-29)、登录设备的退出确认(2026-09-30)也是弹窗。
    // 账号行的「编辑」弹窗、手机管理账号的底部动作面板(2026-09-30)也是;账号 ⋯ 菜单(#427)也是。
    && /const dialogOpen = !!removeTarget \|\| localDeleteVisible \|\| guideVisible \|\| logoutConfirm \|\| switcherOpen \|\| !!sessions\.confirm \|\| !!editTarget \|\| !!sheetTarget \|\| !!menuFor;/.test(src));
  ck('子页顶栏左上有返回箭头', src.includes('testID="settings-back"') && src.includes('name="chevron-back"'));
  ck('列表行带 › 箭头', src.includes('name="chevron-forward" size={18}'));
  ck('底部整宽「退出登录」要先确认', src.includes('testID="settings-logout-block"') && src.includes('onPress={() => setLogoutConfirm(true)}') && src.includes('<Modal visible={logoutConfirm}'));
  // 「移除当前账号」只画在宽屏右栏(compact 时走 phoneSubPage,根本不进那一段);手机子页文件里没有它。
  ck('手机账号子页不再重复「移除当前账号」(它的位置是底部退出登录)', src.includes("show('account', 'logout') && canLogout ?") && !readFileSync(new URL('./SettingsPhonePages.tsx', import.meta.url), 'utf8').includes("tr('settings.copy.22')"));
  ck('宽屏仍画左栏 + 右栏标题;手机子页走 SettingsPhonePage', src.includes('{compact ? (subPage ? phoneHeader : listHeader) : sidebar}') && src.includes('<Text style={styles.paneTitle}>{settingsText(paneTitle)}</Text>') && src.includes('{compact ? (subPage ? phoneSubPage : phoneList) : ('));
  // #427 v2:列表行是设置积木(settingsRowMinHeight = max(48, ds(52))),右栏旧样式的行也用同一个下限。
  ck('行高下限 48', readFileSync(new URL('./settings-kit.tsx', import.meta.url), 'utf8').includes('export const settingsRowMinHeight = (): number => Math.max(48, ds(52));') && src.includes('minHeight: settingsRowMinHeight()') && /<SettingsRow\s+key=\{cat\.key\}/.test(src));
  ck('文字走 ui-text 包装(字体大小设置生效)', src.includes("import { Text, TextInput } from './ui-text';"));
}

// —— 颜色 token ——
{
  const rgb = (hex: string) => [0, 2, 4].map((i) => Number.parseInt(hex.replace('#', '').slice(i, i + 2), 16));
  const lum = (hex: string) => {
    const [r, g, b] = rgb(hex).map((n) => { const s = n / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  for (const mode of ['light', 'dark'] as const) {
    setThemeMode(mode);
    ck(`${mode}: 行与地面是两档`, colors.groupedRow !== colors.groupedBg);
    ck(`${mode}: 按下态与行不同`, colors.groupedRowPressed !== colors.groupedRow);
    for (const surface of ['groupedBg', 'groupedRow', 'groupedRowPressed'] as const) {
      ck(`${mode}: text on ${surface} ≥ 7:1`, contrast(colors.text, colors[surface]) >= 7);
      ck(`${mode}: textMuted on ${surface} ≥ 4.5:1`, contrast(colors.textMuted, colors[surface]) >= 4.5);
    }
  }
  setThemeMode('light');
  ck('浅色:白行灰地(不是深色反过来)', colors.groupedRow === '#ffffff' && lum(colors.groupedBg) < lum(colors.groupedRow));
  setThemeMode('dark');
  ck('深色:行比地面亮一档', lum(colors.groupedRow) > lum(colors.groupedBg));
}

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
