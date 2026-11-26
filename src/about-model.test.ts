// 关于页平台名:桌面 Tauri 的 Platform.OS 是 'web',要按 UA 认出真实系统(管理员截图里 Mac 写着「Web」)。
import { aboutPlatformLabel } from './about-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}`); };
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36';
const HARMONY_APP = 'Mozilla/5.0 (Phone; OpenHarmony 6.1) AppleWebKit/537.36 ArkWeb/4.1.6.1 Mobile ANetHarmony/0.2.622';
const HARMONY_BROWSER = 'Mozilla/5.0 (Phone; OpenHarmony 5.0) AppleWebKit/537.36 ArkWeb/4.1.6.1 Mobile';

ck('native iOS / Android', aboutPlatformLabel('ios', false) === 'iOS' && aboutPlatformLabel('android', false) === 'Android');
ck('HarmonyOS ArkWeb shell (bridge flag or ANetHarmony UA) → HarmonyOS',
  aboutPlatformLabel('web', false, MAC, true) === 'HarmonyOS' && aboutPlatformLabel('web', false, HARMONY_APP, false) === 'HarmonyOS');
ck('HarmonyOS standalone browser → HarmonyOS Web', aboutPlatformLabel('web', false, HARMONY_BROWSER, false) === 'HarmonyOS Web');
ck('Tauri on Mac → macOS (was "Web")', aboutPlatformLabel('web', true, MAC) === 'macOS');
ck('Tauri on Windows → Windows', aboutPlatformLabel('web', true, WIN) === 'Windows');
ck('Tauri on Linux → Linux', aboutPlatformLabel('web', true, LINUX) === 'Linux');
ck('Tauri, unknown UA → Desktop (not Web)', aboutPlatformLabel('web', true, '') === 'Desktop');
ck('real browser stays Web', aboutPlatformLabel('web', false, MAC) === 'Web');
ck('Android browser export → Android Web', aboutPlatformLabel('web', false, ANDROID) === 'Android Web');
ck('unknown OS passes through', aboutPlatformLabel('tvos', false) === 'tvos');

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
