// #4395 —— 「这一版没有 APK」应当是**失败**，不是 warning 之后照发。
//
// 实证：0.489–0.492 四版 release 都没有 APK，而流水线每一步都只是 ::warning:: … exit 0，
// 于是四版全发成功，安卓用户读 desktop/<ver>/SHA256SUMS 找不到 APK 判 incomplete，停在 0.488。
//
// 这个测试钉的是**形状**，不是文案：三条失败路径必须都走 require_apk，而 require_apk 在
// SKIP_ANDROID != true 时必须 exit 1、= true 时降级为 warning。
import { readFileSync } from 'node:fs';

const wf = readFileSync('.github/workflows/release-desktop-auto-update.yml', 'utf8');
let failed = 0;
const check = (name: string, ok: boolean) => { if (!ok) { console.error('FAIL: ' + name); failed++; } else console.log('PASS: ' + name); };

check('skip_android 是显式输入，默认 false',
  /skip_android:\s*\n\s*description:.*\n\s*required: false\s*\n\s*default: false/.test(wf));
check('job 级传进环境变量', /attach-android-apk:[\s\S]{0,600}SKIP_ANDROID: \$\{\{ inputs\.skip_android \}\}/.test(wf));
check('require_apk 在未放行时 exit 1', /if \[ "\$\{SKIP_ANDROID:-false\}" = "true" \]; then[\s\S]{0,400}exit 1/.test(wf));
check('require_apk 在放行时降级为 warning', /require_apk\(\)[\s\S]{0,400}::warning::/.test(wf));
const calls = wf.match(/require_apk "/g) ?? [];
check('三条失败路径都走 require_apk（不是各自 warning+exit 0）', calls.length === 3);
check('不再保留「by hand」式静默放行',
  !/::warning::no android-build run for \$COMMIT/.test(wf)
  && !/::warning::android-build \$run_id for \$COMMIT concluded/.test(wf)
  && !/did not finish in 20 minutes; attach the APK by hand/.test(wf));
if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('all green');
