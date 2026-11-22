// pickerErrorMessage(attach.ts) — Android 上「ActivityResultLauncher 未注册」是 expo-modules-core
// 的已知上游缺陷(expo/expo#50386)：Activity 被系统重建后，图片/相机/文件选择器全部失效，直到整个
// App 被杀掉重开。admin 2026-11-22 截图看到的是原始 Java 异常文本；这里验证它被换成了可操作的提示。
//
// attach.ts 本身 import 了 expo-image-picker / expo-document-picker 等原生模块，在 bun/node 下
// 直接 import 会在模块解析阶段就失败(非 RN/Expo bundler 环境)。所以不直接 import 该文件，
// 而是从源码里取出 pickerErrorMessage 这一段逻辑的字符串形态，核对它仍然在、且判据没有被削弱。
import { readFileSync } from 'node:fs';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

const src = readFileSync(new URL('./attach.ts', import.meta.url), 'utf8');
const fnStart = src.indexOf('export const pickerErrorMessage');
ck('pickerErrorMessage 存在', fnStart >= 0);
const fnBody = src.slice(fnStart, src.indexOf('\n};', fnStart) + 3);
ck('只在 Android 上套用专门文案(iOS/web 走原样 message，别把不同平台的报错都说成一回事)', fnBody.includes("Platform.OS === 'android'"));
ck('用的是 chat.pickerNeedsRestart 这个 key', fnBody.includes("t('chat.pickerNeedsRestart')"));
ck('非匹配情况原样带出原始 message(不吞掉其它真实报错的排障信息)', fnBody.includes('return raw;'));

// 判据本身：从源码里原样抠出那一条 RegExp 字面量，而不是在测试里重写一遍
// (重写等于测试跟实现各写一份，实现改了判据测试也不会跟着红)。
const reMatch = src.match(/const UNREGISTERED_LAUNCHER_RE = (\/.*\/i);/);
ck('UNREGISTERED_LAUNCHER_RE 存在', !!reMatch);
if (reMatch) {
  // eslint-disable-next-line no-eval
  const re = eval(reMatch[1]) as RegExp;
  ck('命中真实截图里的那句 Java 异常', re.test("java.lang.IllegalStateException: Attempting to launch an unregistered ActivityResultLauncher with contract ..."));
  ck('命中大小写变体', re.test('Unregistered ActivityResultLauncher'));
  ck('普通的「用户取消选择」不会被误判成这个已知缺陷', !re.test('User cancelled image picker'));
  ck('普通的网络错误不会被误判', !re.test('Network request failed'));
}

console.log(`picker error message: ${p}/${t} passed`);
if (p !== t) process.exit(1);
