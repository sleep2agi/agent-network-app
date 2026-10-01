// 设置页重新设计 v1(#427,Vincent「设置页面的账号挺丑的，设置页面其他也挺丑的」)的静态守卫。ck 风格,自执行。
// 量框的那一半在 tests/test-settings-redesign/drive.mjs。
//   1. 宽屏右栏每一段都画在设置积木的卡片里(SettingsGroup / WideCard),不再是整页细线;
//   2. 账号段:当前账号单独一组置顶(highlight)、账号行是 SettingsAccountRow(头像 · ⋯),行尾没有文字按钮;
//      危险操作(移除当前账号)在这一段最后;
//   3. 手机账号子页同一套(当前置顶、⋯ 交给 SettingsScreen 出底部动作面板);
//   4. ⋯ 菜单:Esc 走 escape-close,菜单项来自 accountRowActions(+ 切换)。
import { readFileSync } from 'node:fs';
import { accountMenuItems } from './account-row-actions';

let p = 0, n = 0;
const ck = (name: string, ok: boolean, extra = '') => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}${extra ? ` (${extra})` : ''}`); };
const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const code = (src: string) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const settings = code(read('./SettingsScreen.tsx'));
const phone = code(read('./SettingsPhonePages.tsx'));
const kit = code(read('./settings-kit.tsx'));
const actions = code(read('./AccountRowActions.tsx'));

console.log('# 1 宽屏右栏:每一段都在卡片里');
{
  // 取集:按 sectionsToRender.includes('<分类>') 切段 —— 先证明切到了全部分类,再判每段。
  const marks = [...settings.matchAll(/sectionsToRender\.includes\('(\w+)'\)/g)].map(m => ({ key: m[1], at: m.index! }));
  const keys = [...new Set(marks.map(m => m.key))];
  ck(`取集:切到 8 个分类(${keys.join(',')})`, ['account', 'users', 'localHub', 'appearance', 'notifications', 'voice', 'shortcuts', 'about'].every(k => keys.includes(k)));
  const bare: string[] = [];
  marks.forEach((m, i) => {
    const body = settings.slice(m.at, i + 1 < marks.length ? marks[i + 1].at : settings.indexOf('</ScrollView>', m.at));
    // 自己画成设置积木卡片的组件(VoiceSettingsSection / UserManagementPanel)直接放在段里,不再套 WideCard。
    if (!/<WideCard>|<SettingsGroup|<VoiceSettingsSection |<UserManagementPanel /.test(body)) bare.push(m.key);
  });
  ck('每一段都画在 WideCard / SettingsGroup 里', bare.length === 0, bare.join(','));
  ck('WideCard = SettingsGroup 卡片(不自带分隔,旧行自己画),空的不画', /function WideCard[\s\S]*?if \(!Children\.toArray\(children\)\.length\) return null;[\s\S]*?<SettingsGroup separators=\{false\}/.test(settings));
  ck('登录设备子页也在卡片里', /testID="settings-section-devices">\s*<WideCard>/.test(settings));
  ck('右栏内容收成居中一列(最宽 760)', /content: \{[^}]*maxWidth: 760, alignSelf: 'center'/.test(settings));
  ck('语言(本身就是一组卡片)不套进别的卡片', /<\/SettingsGroup>\s*\{show\('appearance', 'language'\) \? <LanguageSettings \/> : null\}\s*<WideCard>/.test(settings));
  ck('那两个组件确实自己画成积木卡片', /<SettingsGroup/.test(code(read('./VoiceSettingsSection.tsx'))) && /<SettingsGroup/.test(code(read('./UserManagementPanel.tsx'))));
}

console.log('# 2 宽屏账号段');
{
  const a = settings.slice(settings.indexOf("sectionsToRender.includes('account') && !showWideDevices"), settings.indexOf("sectionsToRender.includes('users')"));
  ck('当前账号单独一组、置顶、主色细边', /<SettingsGroup title=\{tr\('accounts\.groupCurrent'\)\} highlight/.test(a) && a.indexOf("accounts.groupCurrent") < a.indexOf("accounts.groupOthers"));
  ck('账号行 = SettingsAccountRow(头像 · 名字 · 当前 · ⋯)', /<SettingsAccountRow[\s\S]*?current=\{isCurrent \?[\s\S]*?onMore=\{el => openProfileMore\(profile, el\)\}/.test(settings));
  ck('行尾不再有文字按钮(复制 / 编辑 / 新窗口 / 移除)', !/tr\('accounts\.copy'\)|tr\('accounts\.edit'\)|tr\('settings\.copy\.16'\)|tr\('settings\.copy\.17'\)/.test(a) && !settings.includes('styles.inlineButton'));
  const danger = a.indexOf('testID="settings-account-danger"');
  ck('危险操作在这一段最后(在其他所有组后面)', danger > 0 && ['settings-account-current', 'settings-account-others', 'settings-account-security', 'settings-account-local-data'].every(id => a.indexOf(id) > 0 && a.indexOf(id) < danger));
  ck('移除当前账号是独立的整宽红字按钮', /<SettingsButton variant="destructive" label=\{tr\('settings\.copy\.22'\)\} onPress=\{onLogout\}/.test(a));
}

console.log('# 3 手机账号子页');
{
  const page = phone.slice(phone.indexOf('function AccountPage'), phone.indexOf('function LoginDevicesPage') > 0 ? phone.indexOf('function LoginDevicesPage') : undefined);
  ck('当前账号单独一组置顶', /<SettingsGroup title=\{tr\('accounts\.groupCurrent'\)\} highlight/.test(page));
  ck('其他账号每行 ⋯ → SettingsScreen(手指 = 底部动作面板)', page.includes('onMore={el => ctx.onProfileMore(profile, el)}') && /if \(!pointer \|\| !el\?\.measureInWindow\) \{ setSheetTarget\(profile\); return; \}/.test(settings));
  ck('「管理账号」三级页没了(动作都在 ⋯ 里)', !phone.includes('ManageAccountsPage') && !read('./settings-model.ts').includes('manageAccounts'));
}

console.log('# 4 积木与菜单');
{
  ck('SettingsAccountRow:头像 / 图标放进同一宽度的行首格子(文字左边缘对齐)', /export const SETTINGS_LEAD = 48;/.test(kit) && (kit.match(/styles\.lead, \{ width: ds\(SETTINGS_LEAD\) \}/g) ?? []).length === 2);
  ck('⋯ 和 › / ✓ 在同一列', /testID=\{`\$\{id\}-more`\}[\s\S]*?style=\{\(\{ pressed, hovered \}: any\) => \[styles\.accessory/.test(kit));
  ck('⋯ 菜单 Esc 走 escape-close', /export function AccountMoreMenu[\s\S]*?listenEscapeClose\(onClose\)/.test(actions));
  ck('菜单:别的账号 = 切换 · 新窗口 · 复制 · 编辑 · 移除', accountMenuItems(['copy', 'edit', 'openWindow', 'remove'], { current: false }).join() === 'switch,openWindow,copy,edit,remove');
  ck('菜单:当前账号没有「切换」', !accountMenuItems(['copy', 'edit', 'openWindow', 'remove'], { current: true }).includes('switch'));
  ck('菜单:要重新登录的账号没有「切换」(点行去验证)', !accountMenuItems(['copy', 'edit', 'remove'], { current: false, requiresReauth: true }).includes('switch'));
  ck('菜单:本地工作区只有切换 · 新窗口 · 复制', accountMenuItems(['copy', 'openWindow'], { current: false }).join() === 'switch,openWindow,copy');
}

console.log('# 5 v2:其他分类的行也是设置积木(#427 v2)');
{
  // 右栏不再有自画的「标签 + 值」「标签 + 按钮」「标签 + 开关」行:都换成 SettingsRow / SettingsActionRow / SettingsSwitchRow /
  // SettingsControlRow,标签列、右侧控件列、52 行高都由积木给。
  ck('ValueRow / ActionRow 已删除', !/function ValueRow|function ActionRow|<ValueRow|<ActionRow/.test(settings));
  ck('SettingsScreen 不再直接画 <Switch>(开关只在 SettingsSwitchRow 里)', !/<Switch\b/.test(settings));
  const kitRows = (body: string) => (body.match(/<Settings(Row|ActionRow|SwitchRow|ControlRow|ChoiceRow)\b/g) ?? []).length;
  const slice = (key: string) => { const a = settings.indexOf(`sectionsToRender.includes('${key}')`); const b = settings.indexOf('sectionsToRender.includes(', a + 10); return settings.slice(a, b > 0 ? b : settings.indexOf('</ScrollView>', a)); };
  for (const [key, min] of [['localHub', 8], ['notifications', 10], ['about', 5], ['appearance', 1]] as const) {
    ck(`${key}:至少 ${min} 个积木行`, kitRows(slice(key)) >= min, String(kitRows(slice(key))));
  }
  const voice = code(read('./VoiceSettingsSection.tsx'));
  ck('语音:识别模型是单选积木行(不再是大卡片单选)', voice.includes('<SettingsChoiceRow') && !/styles\.option\b/.test(voice));
  ck('语音:测试是 SettingsActionRow,按钮保留旧 id voice-test', /<SettingsActionRow[\s\S]*?buttonTestID="voice-test"/.test(voice));
  ck('右栏旧样式的行(快捷键 / 字体大小 / 登录设备)和积木同一套尺寸', /row: \{[^}]*paddingHorizontal: SETTINGS_ROW_PAD_X,[^}]*minHeight: settingsRowMinHeight\(\),/.test(settings) && /divider: \{ height: StyleSheet\.hairlineWidth, backgroundColor: colors\.border, marginLeft: SETTINGS_ROW_PAD_X \}/.test(settings));
  ck('积木:SettingsControlRow / SettingsActionRow 的控件都在右侧同一列(marginLeft auto)', /control: \{ marginLeft: 'auto'/.test(kit) && /styles\.control, styles\.actionButton/.test(kit));
  const list = settings.slice(settings.indexOf('const phoneList = ('), settings.indexOf('const listHeader = ('));
  ck('手机设置首页:每个分类一行 SettingsRow(带图标),分组 = SettingsGroup', /<SettingsGroup key=\{group\.title/.test(list) && /<SettingsRow\s+key=\{cat\.key\}[\s\S]*?icon=\{SETTINGS_CATEGORIES\.find/.test(list) && !/styles\.phoneRow\b/.test(list));
  ck('手机设置首页:切换账号 / 退出登录 = SettingsButton', (list.match(/<SettingsButton variant="plain"/g) ?? []).length === 2);
}

console.log(`\n${p}/${n} passed`);
if (p !== n) process.exit(1);
