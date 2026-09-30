// 内置更新日志(changelog-bundled.ts)必须和发版正文一字不差 —— 否则离线时「更新日志」里没有本版,或者和
// 更新弹窗里的说明对不上。版本升级 PR 改了 releaseBody 就会红在这里;修法见 FIX 行。ck 风格。
import { readFileSync } from 'node:fs';
import { BUNDLED_RELEASE_BODY, BUNDLED_RELEASE_DATES } from './changelog-bundled';
import { APP_VERSION } from './version';
// @ts-ignore — plain .mjs helper shared with the release workflow
import { extractReleaseBody } from '../scripts/android-release-notes.mjs';
// @ts-ignore
import { existingDates, renderBundled } from '../scripts/changelog-bundle.mjs';

let p = 0, t = 0;
const ck = (name: string, ok: boolean, extra = '') => { t++; if (ok) { p++; console.log(`PASS: ${name}`); } else console.log(`FAIL: ${name}${extra ? ` — ${extra}` : ''}`); };
const FIX = 'FIX: run `node scripts/changelog-bundle.mjs` and commit src/changelog-bundled.ts';

const workflow = readFileSync(new URL('../.github/workflows/release-desktop-auto-update.yml', import.meta.url), 'utf8');
const body = extractReleaseBody(workflow);
ck('workflow has a releaseBody', typeof body === 'string' && body.length > 0);
ck('bundled notes == releaseBody of the release workflow', BUNDLED_RELEASE_BODY === body, FIX);
ck(`bundled notes cover the running version ${APP_VERSION}`, BUNDLED_RELEASE_BODY.includes(`What's new in ${APP_VERSION}:`), FIX);
// Windows 检出(autocrlf)里这个文件是 CRLF,生成器永远写 LF —— 比内容不比换行符(windows-latest 曾因此红)。
const file = readFileSync(new URL('./changelog-bundled.ts', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
ck('file is exactly what the generator writes (not hand-edited)', file === renderBundled(body, existingDates(file)), FIX);
ck('dates are ISO timestamps', Object.values(BUNDLED_RELEASE_DATES).every(d => !Number.isNaN(Date.parse(d))));
// 生成器自检:一个已知的日期块能被读回(否则不带 --dates 重跑会静默丢光日期)。
ck('generator keeps dates from a CRLF checkout', Object.keys(existingDates(renderBundled('x', { '0.2.2': '2026-01-02T00:00:00Z' }).replace(/\n/g, '\r\n'))).join() === '0.2.2');
ck('generator keeps existing dates', existingDates(renderBundled('x', { '0.2.2': '2026-01-02T00:00:00Z', '0.2.10': '2026-01-10T00:00:00Z' }))['0.2.10'] === '2026-01-10T00:00:00Z');

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
