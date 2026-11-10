// #4422 —— 发布完成后必须显式触发一次安卓镜像闸，不能只靠 `on: schedule`。
//
// 实测（2026-11-10）：android-mirror-lag.yml 在 03:33Z 合并后到 07:07Z 之间 **零次触发**，
// 而同一仓库的 modelscope-mirror 定时任务是跑了的。所以「定时任务会来看」这句话不成立。
//
// 这个测试钉两件事：链在 normalize 之后（此时资产已齐），以及「只认 id 更大的新 run」。
import { readFileSync } from 'node:fs';

const wf = readFileSync('.github/workflows/release-desktop-auto-update.yml', 'utf8');
let failed = 0;
const check = (name: string, ok: boolean) => { if (!ok) { console.error('FAIL: ' + name); failed++; } else console.log('PASS: ' + name); };

check('存在 trigger-android-mirror-gate job', /\n  trigger-android-mirror-gate:/.test(wf));
check('它排在 normalize-updater-manifest 之后', wf.indexOf('trigger-android-mirror-gate:') > wf.indexOf('normalize-updater-manifest:'));
check('只在 publish=true 时跑', /trigger-android-mirror-gate:[\s\S]{0,900}if: inputs\.publish == true/.test(wf));
check('真的 dispatch 那道闸', /gh workflow run android-mirror-lag\.yml --ref main/.test(wf));
check('以 run id 变大作为唯一证据', /newest" -gt "\$baseline"/.test(wf));
check('等了也等不到就判红，而不是静默成功', /::error::dispatched android-mirror-lag\.yml but no new run appeared/.test(wf));


// 2026-11-10 首次真实发布：这个 job 在没有 checkout 的上下文里跑 `gh workflow run`，
// 报 `failed to run git: fatal: not a git repository`。--repo 是必须的，不是可选优化。
check('dispatch 显式带 --repo（这个 job 没有 checkout）', /gh workflow run android-mirror-lag\.yml --repo "\$GITHUB_REPOSITORY" --ref main/.test(wf));
check('已经有一个在跑的闸 run 也算接上了（不误报）', /mirror gate already running as \$rid/.test(wf));

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('all green');
