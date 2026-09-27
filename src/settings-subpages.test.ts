// 手机「设置」子页走 settings-kit(Vincent 2026-09-27「设置界面有点体验太差」)。ck-style:自执行,失败 exit 1。
//
//   守卫  子页文件(SettingsPhonePages.tsx / SettingsEditPages.tsx)只经 settings-kit 画:不直接用 TextInput、
//         不画单选圆点卡片(accessibilityRole="radio" 只许在 kit 里)、不从 react-native 拿 Switch / Pressable /
//         TextInput、不自建 StyleSheet。输入框(SettingsTextField)只许出现在三级编辑页文件里。
//         判据先喂已知阳性看它红(CLAUDE.md ③),取集再单独自检:每个设置分类都有一个子页分支(⑤)。
//   接线  子页开着时 App 收起底部 tab 栏(onPhoneSubPageChange → phoneInPageLeaf → navChromeFor)。
//   积木  行高 ≥48、左右 16、› 与 ✓ 同一列、分隔线从标签左边缘开始、文字走 ui-text、颜色走 token。
//   模型  返回先退三级页再退子页。
// 读文件一律 CRLF→LF、路径 POSIX 化(Windows 检出)。
import { readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SETTINGS_CATEGORIES, SETTINGS_DETAIL_PARENT, SETTINGS_DETAIL_TITLE, settingsBackTarget, type SettingsDetailKey } from './settings-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}${extra ? ` (${extra})` : ''}`); };
const here = dirname(fileURLToPath(import.meta.url));
const posix = (f: string) => f.split(sep).join('/');
const read = (rel: string) => readFileSync(join(here, rel), 'utf8').replace(/\r\n?/g, '\n');
const code = (src: string) => src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n'); // 去掉整行注释(注释里会提到被禁的名字)

// ── 判据 ────────────────────────────────────────────────────────────────────────────────────
/** 子页文件里的违规;空 = 干净。editPage = 三级编辑页文件(允许 SettingsTextField)。 */
export function subPageViolations(source: string, editPage: boolean): string[] {
  const src = code(source);
  const out: string[] = [];
  if (/<TextInput\b|\bTextInput\s*[,}]/.test(src)) out.push('raw TextInput');
  if (/accessibilityRole=["{]'?radio/.test(src)) out.push('radio role outside the kit');
  if (/styles\.(radio|option|chip)\b/.test(src)) out.push('radio / option card styles');
  if (/StyleSheet\.create\(/.test(src)) out.push('own StyleSheet (use settings-kit)');
  const rn = src.match(/import\s*\{([^}]*)\}\s*from\s*'react-native'/);
  if (rn) {
    const names = rn[1].split(',').map(s => s.trim()).filter(Boolean);
    const bad = names.filter(n => !['Platform'].includes(n));
    if (bad.length) out.push(`react-native import: ${bad.join(', ')}`);
  }
  if (!editPage && /<SettingsTextField\b/.test(src)) out.push('input field on a sub-page (put it on an edit page)');
  return out;
}

{
  // 已知阳性:判据要红。
  const bad: [string, string, boolean][] = [
    ['raw TextInput', "import { Text, TextInput } from './ui-text';\nconst x = <TextInput value={a} />;", true],
    ['radio card', "const x = <Pressable accessibilityRole=\"radio\" style={[styles.option]} />;", false],
    ['Switch from react-native', "import { Platform, Switch } from 'react-native';", false],
    ['own StyleSheet', "const s = StyleSheet.create({ a: {} });", false],
    ['field on a sub-page', "const x = <SettingsTextField value={a} />;", false],
  ];
  for (const [name, src, edit] of bad) ck(`判据:${name} 会被抓`, subPageViolations(src, edit).length > 0);
  ck('判据:编辑页里的 SettingsTextField 放行', subPageViolations("const x = <SettingsTextField value={a} />;", true).length === 0);
  ck('判据:注释里提到 TextInput 不算', subPageViolations('// 不许直接用 TextInput\nconst a = 1;', false).length === 0);
  ck('判据:只 import Platform 放行', subPageViolations("import { Platform } from 'react-native';", false).length === 0);
}

// ── 取集 + 真仓 ──────────────────────────────────────────────────────────────────────────────
const SUB_PAGE_FILES = ['SettingsPhonePages.tsx', 'SettingsEditPages.tsx'];
{
  const pages = read('SettingsPhonePages.tsx');
  // 取集自检:每个设置分类在 SettingsPhonePage 的 switch 里都有一支(新分类忘了加 = 手机上点进去是空页)。
  for (const c of SETTINGS_CATEGORIES) ck(`取集:分类「${c.label}」有手机子页分支`, pages.includes(`case '${c.key}':`));
  // 三级页都有人渲染。
  for (const k of Object.keys(SETTINGS_DETAIL_TITLE) as SettingsDetailKey[]) ck(`取集:三级页 ${k} 有渲染分支`, pages.includes(`'${k}'`));
  for (const f of SUB_PAGE_FILES) {
    const v = subPageViolations(read(f), f === 'SettingsEditPages.tsx');
    ck(`${posix(join('src', f))}:只经 settings-kit 画`, v.length === 0, v.join('; '));
    ck(`${posix(join('src', f))}:从 settings-kit 取积木`, /from '\.\/settings-kit'/.test(read(f)));
  }
  const settings = read('SettingsScreen.tsx');
  ck('SettingsScreen:手机子页只渲染 SettingsPhonePage(不再复用宽屏右栏)', settings.includes('{compact ? (subPage ? phoneSubPage : phoneList) : (') && settings.includes('<SettingsPhonePage page={subPage} ctx={phoneCtx} />'));
  ck('SettingsScreen:子页滚动区用 kit 的页面样式', settings.includes('contentContainerStyle={settingsPageContentStyle()}'));
  ck('SettingsScreen:没有残留的「子页 = 右栏白块」样式', !/contentPhone|phoneSection/.test(settings));
  const edit = read('SettingsEditPages.tsx');
  ck('API Key / Access Token 都是 secureTextEntry', (code(edit).match(/secureTextEntry/g) ?? []).length === 2);
  ck('编辑页不回显密钥(不把 creds 渲染出来)', !/creds\??\.(accessToken|apiKey)/.test(edit) && !/value=\{v\.creds/.test(edit));
  ck('API Key 页:保存整宽主按钮 + 清除红字 + 只存本机一句', edit.includes('testID="voice-save"') && /variant="destructive" label="清除"/.test(edit) && edit.includes('凭据只保存在本机('));
  ck('语音子页:API Key 行值 = 已配置 …xxxx / 未配置,点进三级页', pages.includes("statusLabel(status).replace(' ✓', '')") && pages.includes("'未配置'") && pages.includes("ctx.openDetail('voiceApiKey')"));
  ck('语音子页:火山引擎控制台走 open-external', pages.includes('openExternal(VOLC_CONSOLE_URL)') && !/Linking\.openURL|window\.open/.test(pages));
  ck('语音子页:识别模型是 ✓ 单选行', /<SettingsChoiceRow key=\{m\} testID=\{`voice-mode-\$\{m\}`\}/.test(pages));
  ck('语音:宽屏与手机共用 useVoiceSettings(行为一处)', pages.includes('useVoiceSettings()') && read('VoiceSettingsSection.tsx').includes('} = useVoiceSettings();'));
}

// ── 接线:子页开着时收起 tab 栏 ───────────────────────────────────────────────────────────────
{
  const app = read('../App.tsx');
  const settings = read('SettingsScreen.tsx');
  ck('App:手机设置把子页状态报上来', app.includes('onPhoneSubPageChange={setSettingsSubPage}'));
  ck('App:tab 栏的判定带上子页(phoneInPageLeaf → navChromeFor)', app.includes('const inPageLeaf = phoneInPageLeaf(screen.name, settingsSubPage);') && app.includes('const navChrome = navChromeFor(layout, screen.name, inPageLeaf);'));
  ck('App:底部安全区跟着 tab 栏走(tab 栏收起时内容自己垫)', app.includes('navChromeFor(layout, screen.name, inPageLeaf) === \'none\''));
  ck('SettingsScreen:子页变化时上报,卸载时还原', settings.includes('onPhoneSubPageChange?.(!!subPage);') && settings.includes('useEffect(() => () => onPhoneSubPageChange?.(false), []);'));
  ck('tab 栏可被验收脚本定位', app.includes('testID="mobile-tab-bar"'));
}

// ── 积木 ──────────────────────────────────────────────────────────────────────────────────────
{
  const kit = read('settings-kit.tsx');
  ck('kit:文字走 ui-text(字体大小生效)', kit.includes("import { Text, TextInput } from './ui-text';") && !/import[^;]*\bText\b[^;]*from 'react-native'/.test(kit));
  ck('kit:行高下限 max(48, ds(52))(界面密度生效)', kit.includes('Math.max(48, ds(52))'));
  ck('kit:左右 16、标签内边距 16', kit.includes('export const SETTINGS_GUTTER = 16;') && kit.includes('export const SETTINGS_ROW_PAD_X = 16;') && kit.includes('marginHorizontal: SETTINGS_GUTTER'));
  ck('kit:› 与 ✓ 共用同一个 accessory 格子', (kit.match(/style=\{styles\.accessory\}/g) ?? []).length === 2 && kit.includes("name=\"checkmark\"") && kit.includes("'chevron-forward'"));
  ck('kit:分隔线从标签左边缘开始', kit.includes('separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: SETTINGS_ROW_PAD_X }'));
  ck('kit:颜色只用主题 token(没有写死的色值)', !/#[0-9a-fA-F]{3,8}\b/.test(code(kit)));
  ck('kit:样式随主题重建', kit.includes('onThemeChange(() => { styles = makeStyles(); });'));
}

// ── 模型:返回顺序 ─────────────────────────────────────────────────────────────────────────────
{
  ck('列表页上没有返回', settingsBackTarget(null, null) === 'none');
  ck('子页上返回 = 回列表', settingsBackTarget('voice', null) === 'page');
  ck('三级页上返回 = 回子页', settingsBackTarget('voice', 'voiceApiKey') === 'detail');
  ck('别的子页的三级页记忆不拦返回', settingsBackTarget('about', 'voiceApiKey') === 'page');
  ck('每个三级页都有标题和所属子页', (Object.keys(SETTINGS_DETAIL_TITLE) as SettingsDetailKey[]).every(k => !!SETTINGS_DETAIL_TITLE[k] && !!SETTINGS_DETAIL_PARENT[k]));
}

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
