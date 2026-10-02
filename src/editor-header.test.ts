// 编辑器全屏顶栏守卫(2026-10-02 #450 Vincent iPad 截图:规则文件全屏里「重新读取」「保存」「退出全屏」不在一条线上,
// 退出全屏低一截,三个按钮三种大小三种样子,保存禁用只是调淡)。ck 风格,自执行。
//
// 规则(SplitEditorParts.tsx EditorHeaderButton 顶上):
//   1. 顶栏里的按钮都用 EditorHeaderButton —— 同高(EDITOR_BTN_HEIGHT,或跟同行切换控件同高)、同圆角、同字号;
//   2. 保存 = primary;禁用时换浅灰底 + 灰字,不是 opacity;
//   3. 「阅读/编辑」切换(ModeToggle)也是 EDITOR_BTN_HEIGHT 高;
//   4. 退出全屏和其它按钮在同一行(规则文件全屏:header(exit) 把它交给顶栏自己摆)。
// 两层分开:
//   取集 —— src 下每个出现「退出全屏」/ exitFullscreen 或 ModeToggle 的 .tsx 都要登记在 HEADERS 里;新写的全屏编辑器
//           没登记 ⇒ 红:先照规则做顶栏再登记。
//   判据 —— 登记的每个顶栏:save / exit 的 testID 落在 <EditorHeaderButton …> 上;文件里没有按 disabled 调 opacity 的按钮。
// 几何(真渲染量 boundingBox,中线 ±1px、等高)在 tests/test-editor-header/drive.mjs:iPad 横屏 1366×1024、桌面 1440×900、
// 手机 390×844,浅色 + 深色。
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let p = 0, n = 0;
const ck = (name: string, ok: boolean) => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}`); };
const here = import.meta.dir;
const read = (rel: string) => readFileSync(join(here, rel), 'utf8').replace(/\r\n?/g, '\n');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** 每个全屏编辑器顶栏:按钮的 testID(必须是 EditorHeaderButton),primary 的那个是保存。 */
const HEADERS: Record<string, { buttons: string[]; primary: string[]; iconOnly?: boolean; note: string }> = {
  'NodeRulesSection.tsx': { buttons: ['rules-full-reload', 'rules-full-save', 'rules-full-exit'], primary: ['rules-full-save'], note: '规则文件全屏:一行 header(exit),状态句单独一行' },
  'TaskDescriptionFullscreen.tsx': { buttons: ['req-description-full-save', 'req-description-full-close', 'req-description-page-save'], primary: ['req-description-full-save', 'req-description-page-save'], note: '任务描述:桌面全屏 + 手机整页(定时任务内容复用)' },
  'SplitEditorParts.tsx': { buttons: [], primary: [], note: '零件本身:EditorHeaderButton / ModeToggle' },
  'ScheduleContentFullscreen.tsx': { buttons: [], primary: [], note: '复用 TaskDescriptionEditor 的全屏,不自带顶栏' },
  'ScheduledTasksScreen.tsx': { buttons: [], primary: [], note: '只打开 ScheduleContentFullscreen' },
  'RulesFind.tsx': { buttons: [], primary: [], iconOnly: true, note: '查找栏(全屏时放在顶栏行里):↑↓ 是图标按钮,禁用调淡图标是惯例,不查 opacity' },
};

// 「disabled ? { opacity: … }」或「opacity: …disabled… ? 0.5」;按下时的 opacity(pressed && !disabled)不算。
const OPACITY_BY_DISABLED = /(?<!!)disabled\s*\?\s*\{\s*opacity|opacity:\s*[^,}]*disabled[^,}]*\?/;

console.log('取集:出现退出全屏 / ModeToggle 的组件都登记了');
const files = readdirSync(here).filter(f => f.endsWith('.tsx'));
const hits = files.filter(f => /退出全屏|exitFullscreen|<ModeToggle\b/.test(stripComments(read(f))));
for (const f of hits) ck(`${f} 已登记`, f in HEADERS);
for (const f of Object.keys(HEADERS)) ck(`登记的 ${f} 存在`, files.includes(f));
ck('取集不是空的(至少规则文件和任务描述两处)', hits.includes('NodeRulesSection.tsx') && hits.includes('TaskDescriptionFullscreen.tsx'));

console.log('判据:零件');
const parts = stripComments(read('SplitEditorParts.tsx'));
ck('EDITOR_BTN_HEIGHT 导出', /export const EDITOR_BTN_HEIGHT = /.test(parts));
const btn = parts.slice(parts.indexOf('export const EditorHeaderButton'), parts.indexOf('export function ModeToggle'));
ck('EditorHeaderButton 默认高 EDITOR_BTN_HEIGHT', /height = EDITOR_BTN_HEIGHT/.test(btn) && /\bheight,/.test(btn));
ck('EditorHeaderButton 圆角 radius.control、带 1px 边框(描边和主按钮同尺寸)', /borderRadius: radius\.control/.test(btn) && /borderWidth: 1/.test(btn));
ck('EditorHeaderButton 禁用不靠 opacity', !OPACITY_BY_DISABLED.test(btn));
ck('primary 禁用 = 浅灰底 + 灰字', /disabled \? \{ backgroundColor: colors\.subtleFill/.test(btn) && /disabled \? colors\.textMuted/.test(btn));
ck('EditorHeaderButton 写 aria-disabled(web 读屏和测试看得到)', /aria-disabled=\{!!disabled\}/.test(btn));
const toggle = parts.slice(parts.indexOf('export function ModeToggle'));
ck('ModeToggle 容器高 EDITOR_BTN_HEIGHT', /height: EDITOR_BTN_HEIGHT/.test(toggle.slice(0, toggle.indexOf('{tabs.map'))));
ck('ModeToggle 的 tab 不再用 paddingVertical 撑高', !/paddingVertical/.test(toggle.slice(0, toggle.indexOf('</View>'))));

console.log('判据:每个登记的顶栏');
for (const [f, h] of Object.entries(HEADERS)) {
  const src = stripComments(read(f));
  for (const id of h.buttons) {
    const at = src.indexOf(`testID="${id}"`);
    const open = src.lastIndexOf('<', at);
    const tag = src.slice(open, at);
    ck(`${f} ${id} 是 <EditorHeaderButton>`, at > 0 && /^<EditorHeaderButton\b/.test(tag));
    if (h.primary.includes(id)) ck(`${f} ${id} 是 primary`, /\bprimary\b/.test(tag));
  }
  if (!h.iconOnly) ck(`${f} 没有按 disabled 调 opacity 的按钮`, !OPACITY_BY_DISABLED.test(src));
}

console.log('判据:规则文件全屏的退出全屏和按钮同一行');
const rules = stripComments(read('NodeRulesSection.tsx'));
const fs = rules.slice(rules.indexOf('function RulesFullscreen'));
const sh = fs.slice(fs.indexOf('testID="screen-header"'));
ck('screen-header 自己不是 row(行由 header(exit) 摆,退出全屏不再是第二列)', !/flexDirection: 'row'/.test(sh.slice(0, sh.indexOf('>'))));
ck('退出全屏交给 header(exit)', /\{header\(<EditorHeaderButton ref=\{closeRef\}/.test(sh));
const fh = rules.slice(rules.indexOf('const fullHeader = '), rules.indexOf('const bodyProps'));
ck('宽:一行 = 左侧 … {actions}{exit}', /\{actions\}\{exit\}<\/View>/.test(fh));
ck('宽:状态句在顶栏下面单独一行', /testID="rules-full-status"/.test(fh));
ck('窄:第一行 左侧 + 退出全屏', /\{left\}<View style=\{\{ flex: 1 \}\} \/>\{exit\}<\/View>/.test(fh));

console.log(`\n${p}/${n} passed`);
if (p !== n) process.exit(1);
