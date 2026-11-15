// #4820 ⑤ —— 方案 A（2026-11-15 通信欧拍板）：**不引入客户端版本常量**，
// 只保证「同一个原因在同一域里显示同一句可读中文」，且不吞原始证据。
//
// 关键约束（通信欧 11-15 拦下的一条）：**catalog 域与 source-directory 域各用各的原因表**。
// 把 catalog 的 8 条套到 directory 串上，会得到「文案通顺但解释的是另一个失败」——本测试专门钉这一点。
//
// 这份测试钉六件事：
//   1) 域内同文：同一 reason 走 domain 渲染器与入口包装函数，结果逐字节相同；
//   2) 跨域不串味：catalog 的 reason 交给 source-directory 渲染时**不得**出现 catalog 的说法；
//   3) 版本不兼容两个域共用同一句（这确实是一件事）；
//   4) 版本判定要「version/版本」+「unsupported/不兼容…」同时出现，未知不升级；
//   5) 未登记 reason → 具名兜底 + 原始 code（不空白、不伪装已知原因）；
//   6) 源码级：选择器走 catalog 入口、向导走 source-directory 入口且渲染用映射后的文案。

import { readFileSync } from 'node:fs';
import {
  CATALOG_REASONS,
  SOURCE_DIRECTORY_REASONS,
  VERSION_UNSUPPORTED_ENTRY,
  catalogErrorText,
  isVersionUnsupportedError,
  reasonText,
  renderReason,
  sourceReadErrorText,
} from './opencode-v2-model-list';
import { directoryErrorText } from './session-source-directory';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? '✓' : '✗'} ${name}`); };

const catalogCodes = Object.keys(CATALOG_REASONS);
const directoryCodes = Object.keys(SOURCE_DIRECTORY_REASONS);

// 1) 域内同文
for (const code of catalogCodes) {
  ck(`catalog 域内同文（${code}）`, catalogErrorText(code) === reasonText('catalog', code));
}
for (const code of directoryCodes) {
  ck(`source-directory 域内同文（${code}）`, sourceReadErrorText(code) === reasonText('sourceDirectory', code));
}

// 2) 跨域不串味：catalog 专属 reason 交给目录渲染，必须落到具名兜底（带 code），不能出现 catalog 的句子
const catalogOnly = catalogCodes.filter(c => !(c in SOURCE_DIRECTORY_REASONS));
for (const code of catalogOnly) {
  const viaDirectory = sourceReadErrorText(code);
  const catalogSentence = renderReason(CATALOG_REASONS[code]);
  ck(`跨域不串味（${code}）`,
    viaDirectory !== catalogSentence && viaDirectory.includes(code));
}

// 3) 版本不兼容：两个域同一句
const versionCases = [
  'opencode_cli_version_unsupported',
  'runtime_version_incompatible',
  'cli version too old',
  'OpenCode CLI 版本不支持',
  '版本过低',
];
for (const c of versionCases) {
  ck(`判为版本不兼容：${c}`, isVersionUnsupportedError(c));
  ck(`两域同一句：${c}`,
    catalogErrorText(c) === renderReason(VERSION_UNSUPPORTED_ENTRY)
    && sourceReadErrorText(c) === renderReason(VERSION_UNSUPPORTED_ENTRY));
}

// 4) 负向：只有「版本」或只有「不支持」都不算
for (const c of ['unavailable', 'unauthorized', 'version 2 catalog empty', 'skills unsupported', 'directory_not_ascii']) {
  ck(`不升级为版本不支持：${c}`, isVersionUnsupportedError(c) === false);
}

// 5) 未登记 reason：具名兜底 + 白名单形状的原文；形状不像 code 时隐去（防路径/主机名泄进 UI）
const unknown = 'some_new_backend_reason';
ck('catalog 兜底带原文', catalogErrorText(unknown).includes(unknown) && catalogErrorText(unknown).includes('模型清单'));
ck('directory 兜底带原文', sourceReadErrorText(unknown).includes(unknown) && sourceReadErrorText(unknown).includes('目录'));
ck('空串不抛错且非空文案',
  catalogErrorText('') !== '' && sourceReadErrorText('') !== ''
  && catalogErrorText(undefined) !== '' && sourceReadErrorText(undefined) !== '');
ck('未被误判为版本不支持', !catalogErrorText(unknown).includes('CLI 版本'));

// 5b) 透传白名单：只允许 /^[a-z0-9_.-]{1,64}$/ 形状直通，其它一律隐去
const leaks = [
  '/home/vansin/work/proj',
  'failed reading /Users/vansin/secret at host 192.168.1.3',
  'token ghp_abcdefghijklmnop',
  'a'.repeat(65),
];
for (const bad of leaks) {
  const cat = catalogErrorText(bad);
  const dir = sourceReadErrorText(bad);
  ck(`不泄原文（${bad.slice(0, 18)}…）`,
    !cat.includes(bad) && !dir.includes(bad) && cat.includes('已隐去') && dir.includes('已隐去'));
}
ck('像 code 的形状照常直通', sourceReadErrorText('source_directory_busy_v2').includes('source_directory_busy_v2'));

// 5c) code 后面带细节：按 code 前缀命中已知条目，但细节不透传
const withDetail = 'source_directory_unavailable: preview off at /Users/vansin/work';
const detailed = sourceReadErrorText(withDetail);
ck('带细节的 code 仍命中源目录域条目',
  detailed === renderReason(SOURCE_DIRECTORY_REASONS.source_directory_unavailable));
ck('细节不随文案泄出',
  !detailed.includes('/Users/vansin/work') && !detailed.includes('preview off'));

// 5d) 向导最终文案：unavailable 必须带上本地 gate 尾巴（drives node-source-palette 断言要这两句）
{
  const closed = directoryErrorText('unavailable', 'source_directory_unavailable');
  ck('closed directory 文案含「未开放」', closed.includes('未开放'));
  ck('closed directory 文案含「不会退回普通创建」', closed.includes('不会退回普通创建'));
  ck('closed directory 文案是源目录域说法，不是 catalog 域',
    !closed.includes('模型清单') && !closed.includes('服务器没有返回'));
  const failed = directoryErrorText('failed', 'directory_read_failed');
  ck('failed 不重复拼 gate 尾巴', !failed.includes('不会退回普通创建'));
  const denied = directoryErrorText('denied', '这台服务器没有开启「列出已有项目 / 会话」的能力');
  ck('denied 原样返回（不加工已译好的句子）', denied === '这台服务器没有开启「列出已有项目 / 会话」的能力');
  // 拼好的整串再过一次映射也不该重复加尾巴（旧实现就是在这里把尾巴吞掉的）
  const twice = directoryErrorText('unavailable', `${closed}`);
  ck('再次进入映射不会出现两条 tail', (twice.match(/不会退回普通创建/g) || []).length === 1);
}




// 6) 源码级接线
const paletteSrc = readFileSync(new URL('./NodeSourcePalette.tsx', import.meta.url), 'utf8');
const composerSrc = readFileSync(new URL('./ComposerModelPalette.tsx', import.meta.url), 'utf8');
ck('向导 import 了组装函数 directoryErrorText（来自 session-source-directory）',
  /import\s*\{[^}]*directoryErrorText\s+as\s+directoryErrorTextOf[^}]*\}\s*from\s*'\.\/session-source-directory'/.test(paletteSrc));
ck('向导对 directory 错误做了映射', /directoryErrorText\s*=\s*useMemo\([\s\S]{0,300}directoryErrorTextOf\(directory\.kind,\s*directory\.error\)/.test(paletteSrc));
ck('向导渲染用映射后的文案',
  /<PaletteError text=\{directoryErrorText[^}]*\}\s+testID="source-directory-unavailable"/.test(paletteSrc));
ck('选择器仍走 catalogErrorText（两个域不互换）',
  /catalogErrorText\(/.test(composerSrc) && !/sourceReadErrorText/.test(composerSrc));

console.log(`${p}/${t} checks passed`);
