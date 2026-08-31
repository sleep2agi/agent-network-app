import fs from 'node:fs';
import path from 'node:path';

// 冷启动时用户存的主题原先只在一个 **await 了 loadConfig()/loadThemeMode() 的
// useEffect** 里恢复 —— 首帧一定是默认 DARK,存了 light 的用户每次冷启动都会闪一下深色。
//
// 🔴 同一个形状先在夹具里被撞到(UnreadBadgeFixtureScreen 用 useEffect 设主题,
// 于是截图永远截到 dark)。那说明它不是理论:**一个用 useEffect 才定的主题,
// 在第一帧上就是错的**。
//
// 判据只管桌面/web 那一支:`loadDesktopThemeMode()` 是纯同步的(localStorage.getItem),
// 必须在组件体内、useEffect **之外**被调用。移动端走 SecureStore.getItemAsync,
// 拿不到同步值,那一半本条管不了 —— 单独一条断言把这个边界写在测试里,免得后人误以为全修了。

const app = fs.readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8').replace(/\r\n?/g, '\n');
const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};

const marker = 'const early = loadDesktopThemeMode();';
check(app.includes(marker), 'App 在首帧前同步读取桌面/web 已存的主题');
check(app.includes("import { loadDesktopThemeMode } from './src/desktop-theme-storage';"),
  'loadDesktopThemeMode 是显式 import 的');

// 🔴 关键:那一行不能落在任何 useEffect 里 —— 落进去就等于没修。
const idx = app.indexOf(marker);
const before = idx >= 0 ? app.slice(0, idx) : '';
const opens = (before.match(/useEffect\(/g) || []).length;
const closes = (before.match(/\}, \[/g) || []).length;
check(idx >= 0 && opens === closes,
  `早期主题恢复必须在 useEffect 之外(之前有 ${opens} 个 useEffect( 与 ${closes} 个依赖数组收尾)`);

// 边界:移动端那一半没修,写进测试免得被读成"全修了"
check(app.includes('SecureStore') === false || app.includes('移动端仍会闪'),
  'App 里注明移动端仍会闪(SecureStore 异步),不假装修好');

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log(`theme cold start: 4 checks passed`);
