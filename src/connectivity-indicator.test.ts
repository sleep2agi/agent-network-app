// 静态守卫(ck 风格,bun/node 可跑):连接状态不再是全宽顶部横幅。run: bun src/connectivity-indicator.test.ts
//
// Vincent 2026-10-01(iPad 宽屏,v0.2.178):顶上一整条「连接较慢 · 数据可能稍有延迟」太丑、截图全毁,
// 要「缩到角落里,让我知道就行」。规则按类定(不只修截图那一条):
//   1. 连接状态文案(connectivity.ts bannerText)只由 ConnectivityIndicator 画 —— 角标,不是横幅;
//   2. 旧的全宽横幅组件不存在、也没人挂;
//   3. 角标三处都挂上了:桌面 rail、MobileNavRail(iPad 横屏 / 安卓展开)、手机内容区右上角;
//   4. 角标自身不铺满:圆点定宽定高,手机那份绝对定位(不占位、不推内容),没有 width:'100%' / alignSelf:'stretch';
//   5. 兄弟横幅:事件流页「实时流已断开」那条压在列表上方的条也收掉了(标题栏的状态胶囊就是它的提示)。
// 量框的那一半在 tests/test-connectivity-indicator/drive.mjs(三种尺寸 × 两套主题)。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** 去掉注释,只看代码(注释里提旧组件名是允许的)。 */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, e);
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...sources(rel));
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(rel);
  }
  return out;
}
// 取集自检:必须真递归到 src 的子目录、并且收到 App.tsx —— 否则「0 处违规」只说明没扫到。
const files = ['App.tsx', ...sources('src')];
ck(`取集:收到了 App.tsx、src 下的 .tsx 和子目录里的文件(共 ${files.length} 个)`, files.includes('App.tsx')
  && files.includes(join('src', 'ConnectivityIndicator.tsx')) && files.length > 100 && files.some(f => f.split(/[\\/]/).length > 2));

// 1. bannerText 只由角标使用
const users = files.filter(f => f !== join('src', 'connectivity.ts') && /\bbannerText\s*\(/.test(code(read(f))));
ck(`连接状态文案只由 ConnectivityIndicator 画(实际:${users.join(', ') || '无'})`, users.length === 1 && users[0] === join('src', 'ConnectivityIndicator.tsx'));

// 2. 旧横幅组件已删、无人挂
ck('旧的全宽横幅 src/ConnectivityBanner.tsx 已删除', !existsSync(join(ROOT, 'src', 'ConnectivityBanner.tsx')));
const bannerMounts = files.filter(f => /ConnectivityBanner/.test(code(read(f))));
ck(`没有任何文件再引用 ConnectivityBanner(实际:${bannerMounts.join(', ') || '无'})`, bannerMounts.length === 0);
const testIdBanner = files.filter(f => /testID="connectivity-banner/.test(read(f)));
ck('没有 connectivity-banner 测试 id 残留', testIdBanner.length === 0);

// 3. 三处挂载
const app = code(read('App.tsx'));
const rail = code(read(join('src', 'MobileNavRail.tsx')));
ck('桌面 rail:版本号由角标带着画(placement="rail" + label=v${APP_VERSION})', /<ConnectivityIndicator placement="rail" label=\{`v\$\{APP_VERSION\}`\}/.test(app));
ck('桌面 rail:不再单独画一个 v{APP_VERSION} 文本(否则会有两个版本号)', !/<Text style=\{desktopStyles\.railVersion\}>v\{APP_VERSION\}<\/Text>/.test(app));
ck('手机:内容区右上角挂 placement="corner",且只在没有左栏时', /railShown \? null : <ConnectivityIndicator placement="corner" \/>/.test(app));
ck('MobileNavRail(iPad 横屏 / 安卓展开):版本号旁挂 placement="rail"', /<ConnectivityIndicator placement="rail" label=\{`v\$\{APP_VERSION\}`\}/.test(rail));
ck('MobileNavRail 矮屏(无版本号)也挂圆点', /<ConnectivityIndicator placement="rail" style=\{s\.dotOnly\} \/>/.test(rail));
// 挂载点在 SafeAreaView 根下的「全宽兄弟」位置 = 横幅形状;角标不能挂在那儿。
const rootSibling = /<StatusBar[^>]*\/>\s*\{?[^<]*<ConnectivityIndicator/.test(app);
ck('角标没挂在根 SafeAreaView 的顶部(那是横幅的位置)', !rootSibling);

// 4. 角标自身不铺满
const ind = code(read(join('src', 'ConnectivityIndicator.tsx')));
const styleBlock = (name: string) => (ind.match(new RegExp(`\\b${name}: \\{([^}]*)\\}`)) ?? [])[1] ?? '';
ck('角标样式里没有 width:\'100%\' / alignSelf:\'stretch\' / flex:1', !/width: '100%'|alignSelf: 'stretch'|\bflex: 1\b/.test(ind));
ck('圆点定宽定高(DOT)', /dot: \{ width: DOT, height: DOT/.test(ind) && /const DOT = \d+;/.test(ind) && Number(/const DOT = (\d+);/.exec(ind)?.[1]) <= 10);
ck('手机角标绝对定位在右上(不占位、不推内容)', /position: 'absolute'/.test(styleBlock('corner')) && /top: 0/.test(styleBlock('corner')) && /right: 0/.test(styleBlock('corner')));
ck('提示条绝对定位(出现/消失不推内容)', /position: 'absolute'/.test(styleBlock('tip')));
ck('完整文案在 accessibilityLabel 上', /accessibilityLabel: text,/.test(ind));
ck('在线时不画角标(手机返回 null)', /if \(!text\) \{[\s\S]*?return null;/.test(ind));
ck('判慢/判断连的逻辑没被搬进组件(组件不自己数失败)', !/reportReadFailure|reportReadSuccess|failureRounds/.test(ind));

// 5. 兄弟横幅
const logs = read(join('src', 'LogsScreen.tsx'));
ck('事件流页压在列表上方的「实时流已断开」条已收掉', !/logs-disconnected-banner/.test(logs));
ck('事件流页的断开详情在标题栏状态胶囊的 accessibilityLabel 上', /accessibilityLabel=\{conn === 'disconnected' \? `实时流已断开/.test(logs));

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
