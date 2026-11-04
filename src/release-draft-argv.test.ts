// 发布草稿的创建方式守卫(2026-11-05)。
//
// 事故:0.2.454 连续两次构建在 `prepare-release` 就失败,日志里只有
//   `prepare release failed: gh api -X POST .../releases -f tag_name=… -f body=<7 万字符>`。
// 真错因被正文淹掉了。本机用同一条命令复现:`Argument list too long` —— releaseBody 涨到
// **74,110 字符**后被当成**命令行参数**传给 `gh`,超出 execve 限制。不是 GitHub 拒绝内容,
// 也不是 tag 冲突;手工用短 body 建草稿立刻成功。
//
// 修法不是「把更新日志砍短」(那样会丢掉应用内 280+ 版历史,`rollbackTarget` 也依赖它),
// 而是**把 body 走 stdin**(`gh api --input -` 的 JSON)。这个测试钉住三件事:
//   1) 创建草稿必须用 `--input -` + stdin JSON,不能出现 `-f body=`;
//   2) 大 body(200KB)也能构造出 payload,且命令行里不含正文;
//   3) releaseBody 仍然保留足够多的历史(应用内「更新日志」靠它)。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { prepareReleaseDraft } from '../scripts/prepare-desktop-release.mjs';

let pass = 0;
const names: string[] = [];
function ck(name: string, ok: boolean, extra = '') {
  names.push(name);
  if (ok) { pass += 1; return; }
  console.log(`FAIL: ${name}${extra ? ` — ${extra}` : ''}`);
}

// Windows 检出是 CRLF：不归一化的话 `\|-\n` 这类跨行锚点永远匹配不上
// （2026-11-05 真红过一次，和 legion3d-view.test.ts 同一类坑）。
const read = (rel: string) =>
  readFileSync(path.join(import.meta.dir, '..', rel), 'utf8').replace(/\r\n?/g, '\n');
const script = read('scripts/prepare-desktop-release.mjs');
const workflow = read('.github/workflows/release-desktop-auto-update.yml');

ck('创建草稿不把 body 当命令行参数（-f body= 已消失）',
  !/-f',\s*`body=/.test(script) && !script.includes("'-f', `body=${body}`"));

ck('创建草稿走 --input -（stdin JSON）',
  script.includes("'--input', '-'") && script.includes('input: JSON.stringify('));

ck('gh() 支持 stdin（spawnSync 的 input）',
  /spawnSync\('gh', args, \{[^}]*input/.test(script));

ck('默认 run 会把 opts(input) 转发给 gh（漏了就被服务端当空 body，422 links/0/schema）',
  /run = \(args, opts\) => gh\(args, opts\)/.test(script));

ck('200KB body 也能构造 payload，且命令行里没有正文', (() => {
  const calls: Array<[string[], { input?: string }]> = [];
  prepareReleaseDraft({
    version: '9.9.9',
    commit: '0123456789abcdef0123456789abcdef01234567',
    requireCommit: true,
    body: 'X'.repeat(200_000),
    listReleases: () => [],
    run: (args: string[], opts: { input?: string }) => { calls.push([args, opts]); return args.includes('POST') ? { id: 7 } : {}; },
  } as never);
  const hit = calls.find(([args]) => args.includes('POST'));
  if (!hit) return false;
  const [args, opts] = hit;
  return args.includes('--input') && !args.some((a) => a.startsWith('body=')) && (opts.input ?? '').length > 200_000;
})());

ck('releaseBody 仍保留大量历史（应用内更新日志与回滚基线靠它）', (() => {
  const m = /\n( +)releaseBody: \|-\n/.exec(workflow);
  if (!m) return false;
  const indent = m[1].length;
  const rest = workflow.slice((m.index ?? 0) + m[0].length);
  const body: string[] = [];
  for (const line of rest.split('\n')) {
    if (line.trim() === '') { body.push(''); continue; }
    if (line.length - line.trimStart().length <= indent) break;
    body.push(line.slice(indent + 2));
  }
  const n = (body.join('\n').match(/What's new in \d+\.\d+\.\d+:/g) ?? []).length;
  return n >= 50;
})());

console.log(`release draft guard: ${pass}/${names.length} checks passed`);
if (pass !== names.length) process.exit(1);
