// #4437 —— manifest 的 notes 只保留最近几版：客户端**每次检查更新**都会下载解析它。
//
// 实测 0.2.499：latest.json 146,292 B，其中 notes 141,226 B（0.2.499 → 0.2.43，约 450 段）。
// 这不是「难看」，是每次检查更新多传 141 KB。
import { trimManifestNotes, NOTES_SECTIONS_KEPT } from '../scripts/normalize-desktop-update-manifest.mjs';

let failed = 0;
const check = (name: string, ok: boolean, extra = '') => {
  if (!ok) { console.error('FAIL: ' + name + ' ' + extra); failed++; } else console.log('PASS: ' + name);
};

const body = [
  'Signed and notarized update for macOS (Apple Silicon), and signed update for Windows (x64).',
  '',
  "What's new in 0.2.499:",
  '- 思考档位窗口 150 秒',
  '',
  "What's new in 0.2.498:",
  '- 档位在一段时间窗内确认生效',
  '',
  "What's new in 0.2.497:",
  '- 修模型切换误报',
  '',
  "What's new in 0.2.496:",
  '- 老内容 496',
  '',
  "What's new in 0.2.288:",
  '- 更老的内容 288',
].join('\n');

const out = trimManifestNotes(body, { releasesUrl: 'https://github.com/x/y/releases' });
check('保留前言', out.includes('Signed and notarized update'));
check('保留最近 N 段', out.includes("What's new in 0.2.499:") && out.includes("What's new in 0.2.497:"));
check('丢掉更老的段', !out.includes("What's new in 0.2.496:") && !out.includes("What's new in 0.2.288:"));
check('给出全文入口', out.includes('更早版本的更新内容：https://github.com/x/y/releases'));
check('按整段裁（不留半句）', !out.includes('老内容 496') && !out.includes('更老的内容 288'));
check('段数不足时原样返回', trimManifestNotes("What's new in 0.2.499:\n- a", {}) === "What's new in 0.2.499:\n- a");
check('空串原样返回', trimManifestNotes('') === '');
check('keep 可调', trimManifestNotes(body, { keep: 1, releasesUrl: 'u' }).includes("What's new in 0.2.499:") === true
  && trimManifestNotes(body, { keep: 1, releasesUrl: 'u' }).includes("What's new in 0.2.498:") === false);
check('默认保留 3 段', NOTES_SECTIONS_KEPT === 3);
// 上面那份夹具只有 5 段，裁到 3 段不可能缩 80% —— 这条断言第一次写错，是拿「真实 450 段」的
// 比例去要求一个小夹具。要测「确实变小」就用足够长的夹具，别用一个恰好能过的假数字。
const many = ['前言', '', ...Array.from({ length: 60 }, (_, i) => `What's new in 0.2.${400 + i}:\n- 内容 ${i}`)].join('\n');
const trimmedMany = trimManifestNotes(many.releasesUrl ? many : many, { releasesUrl: 'u' });
check('450 段量级下缩到 25% 以内', trimmedMany.length < many.length * 0.25);
check('小夹具也至少是变短（不是变长）', out.length < body.length);

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('all green');
