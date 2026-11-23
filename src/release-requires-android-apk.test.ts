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

// ⚠️ Windows 上工作流是 CRLF，而正则里的 `.` 不匹配 \r —— 这一条曾经只写了 `description:.*\n`，
// 于是 ubuntu 绿、windows 红（2026-11-10，run 42770695031）。用 [^\n]* 才能同时吃 LF 和 CRLF。
check('skip_android 是显式输入，默认 false',
  /skip_android:[ \t]*\r?\n[ \t]*description:[^\n]*\r?\n[ \t]*required: false\r?\n[ \t]*default: false/.test(wf));
check('job 级传进环境变量', /attach-android-apk:[\s\S]{0,600}SKIP_ANDROID: \$\{\{ inputs\.skip_android \}\}/.test(wf));
check('require_apk 在未放行时 exit 1', /if \[ "\$\{SKIP_ANDROID:-false\}" = "true" \]; then[\s\S]{0,400}exit 1/.test(wf));
check('require_apk 在放行时降级为 warning', /require_apk\(\)[\s\S]{0,400}::warning::/.test(wf));
const calls = wf.match(/require_apk "/g) ?? [];
check('三条失败路径都走 require_apk（不是各自 warning+exit 0）', calls.length === 3);
check('不再保留「by hand」式静默放行',
  !/::warning::no android-build run for \$COMMIT/.test(wf)
  && !/::warning::android-build \$run_id for \$COMMIT concluded/.test(wf)
  && !/did not finish in 20 minutes; attach the APK by hand/.test(wf));
// 0.2.614：挂 APK 这一步用 `releases/tags/<tag>` 查草稿 ⇒ HTTP 404（草稿在发布前没有 tag ref），
// Mac / Windows 都构建完了，卡在最后一步。同一个错此前在 0.2.455、0.2.504 各出过一次。
// 这个 job 跑在发布之前：只能用 prepare-release 交出来的 release_id 找草稿。
const attach = wf.slice(wf.indexOf('\n  attach-android-apk:'), wf.indexOf('\n  normalize-updater-manifest:'));
check('挂 APK 的 job 拿得到 prepare-release 的 release_id', /needs: \[prepare-release, build-release, verify-draft\]/.test(attach)
  && attach.includes('RELEASE_ID: ${{ needs.prepare-release.outputs.release_id }}'));
check('挂 APK 的 job 按 id 读草稿并核对是本版本', attach.includes('gh api "repos/$GITHUB_REPOSITORY/releases/$RELEASE_ID"')
  && attach.includes('= "desktop-v$version" ]'));
check('挂 APK 的 job 里没有任何按 tag 查 release 的调用',
  attach.length > 1000 && !attach.split(/\r?\n/).some(l => !/^\s*#/.test(l) && /releases\/tags\//.test(l)));
if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('all green');
