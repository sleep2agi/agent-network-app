// #649 静态守卫:Hub 地址只能经打码函数上屏 —— run: bun src/hub-address-render-guard.test.ts
//
// Vincent 10-06:服务器页把完整 Hub 地址摆在屏上「太容易泄露了」。那一页修了,但同一个地址
// 还在设置、账号切换、窗口标题、确认弹窗里各摆一份。这道门让「新加一个组件把 serverUrl 原样
// 显示出来」在 CI 里红,而不是等下一张截图。
//
// 判据(逐行,先去掉 // 注释;行里出现 maskHubAddress / displayHubAddress / maskedHubHost /
// maskUrlsInText 任一即放行):
//   R1 JSX:文本型属性(value / subtitle / title / label / name / text / description / message /
//      accessibilityLabel / placeholder / footer / hint / detail)或 JSX 子节点 `>{…}` 的表达式里出现
//      serverUrl / hubUrl / profile.url
//   R2 模板串:`…${…serverUrl…}…` 且插值后面紧跟的是文字(空格、·、@、中文、反引号前有别的字)——
//      `${cfg.serverUrl}${path}` / `${serverUrl}/api` / `${a}\u0000${b}` / `${a}|${b}` 这类拼请求或缓存键的放行
//   R3 去协议的显示惯用法:`xxx.serverUrl.replace(/^https?:\/\//…` —— 去协议只为了上屏
//   R1' 对象字面量的文本字段 `label: … / value: …` 里出现地址
//   R4 兜底显示:`… || x.serverUrl` / `… ?? f(serverUrl)` 作为表达式结尾(名字没有就退回地址)
// 白名单只给「用户在里面输入地址」的输入框,逐条写理由;mask-hub-address.ts 自身、测试文件不扫。
//
// 两层自检(取集 ≠ 判据,见 CLAUDE.md 复核纪律 ⑤):
//   - 判据:每条规则各喂一个已知坏的片段必须报;已打码 / 拼请求 / 输入框的片段必须不报。
//   - 取集:递归收 src/ 下所有 .ts/.tsx(含子目录)+ 根目录 App.tsx;断言收到了已知文件和子目录里的文件。
//
// 盲区(写明,不假装):变量改名(const u = cfg.serverUrl; <Text>{u}</Text>)、跨行拼接、i18n 参数插值
// 里的地址、包在别的函数调用里的插值(`${f(cfg.serverUrl)}`,为放过拼缓存键的调用而让)、两层以上的函数嵌套
// (`?? f(g(serverUrl))`)、花括号嵌套的 JSX 属性(`value={tr('k', { v: cfg.serverUrl })}`)、同一行已出现打码函数时整行放行
// (`value={maskHubAddress(a) || cfg.serverUrl}`),本门看不见。
// 2026-10-06 #729 独立审查补上:对象字面量 `value:` / `label:`、`??` 兜底、以 `,` 结尾的 `||` 链(此前也看不见,
// 而且真仓里各有一处:node-info.ts、desktop-chat-windows.ts)。行为层由 mask-hub-address.test.ts 与 tests/test-server-address-mask 的截图驱动兜。

import fs from 'node:fs';
import path from 'node:path';

let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) { pass++; console.log('✅', name); }
  else console.log('❌', name, extra);
};

const ROOT = path.join(__dirname, '..');
const IDENT = String.raw`(?:\bserverUrl\b|\bhubUrl\b|\bprofile\.url\b)`;
const MASKED = /\b(maskHubAddress|displayHubAddress|maskedHubHost|maskUrlsInText)\(/;
const TEXT_PROPS = 'value|subtitle|title|label|name|text|description|message|accessibilityLabel|placeholder|footer|hint|detail';

const R1_PROP = new RegExp(String.raw`\b(?:${TEXT_PROPS})=\{[^{}]*${IDENT}`);
// 对象字面量的文本字段(facts / rows 数组里的 { label, value }),#729 审查 B1 node-info.ts 就是这一形。
const R1_OBJ = new RegExp(String.raw`\b(?:${TEXT_PROPS})\s*:\s*[^,;{}]*${IDENT}`);
const R1_CHILD = new RegExp(String.raw`(?<!=)>\s*\{[^{}]*${IDENT}[^{}]*\}`);
const R2 = new RegExp(String.raw`\$\{[^{}]*${IDENT}[^{}]*\}([^$/\\|?&#:\u0000]|$)`);
const R3 = new RegExp(String.raw`${IDENT}\.replace\(\/\^https\?`);
// `||` / `??` 兜底到地址(可包一层函数调用),以 ; ) ] } , 结尾。#729 审查:`?? safeServerUrl(serverUrl) }`、`|| profile.serverUrl,`。
const R4 = new RegExp(String.raw`(?:\|\||\?\?)\s*(?:[\w.?]+\()?[\w.?]*${IDENT}\)?\s*[;)\]},]`);

/** 用户在里面输入地址的输入框:原样显示是对的。每条写明是哪一个框。 */
const ALLOWLIST: Array<{ file: string; line: string; why: string }> = [
  { file: 'App.tsx', line: 'value={serverUrl}', why: '登录页「服务器地址」输入框(TextInput),用户自己在输入' },
];

/** 路径一律用正斜杠比较(Windows 上 path.relative 给的是 src\\a.tsx)。 */
export const toPosix = (p: string): string => p.split(path.sep).join('/').replace(/\\/g, '/');

export type Finding = { file: string; line: number; rule: string; text: string };

export function scanSource(file: string, src: string): Finding[] {
  const out: Finding[] = [];
  // CRLF 检出(Windows 上 git autocrlf)按行切完先去掉行尾 \r。
  src.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/(^|[^:])\/\/.*$/, '$1');
    if (!new RegExp(IDENT).test(line) || MASKED.test(line)) return;
    const trimmed = line.trim();
    if (ALLOWLIST.some(a => a.file === file && trimmed === a.line)) return;
    const hit = (rule: string) => out.push({ file, line: i + 1, rule, text: trimmed });
    if (R1_PROP.test(line) || R1_CHILD.test(line)) return hit('R1 jsx');
    if (R1_OBJ.test(line)) return hit('R1 object');
    // R2:插值后面紧跟反引号时,只有模板里还有别的字才算「上屏文字」。
    // 键 / 缓存作用域(xxxKey = / scope = / key={…})不上屏;插值里是函数调用的,值是函数的返回值不是地址本身。
    const isKey = /\b\w*(?:Key|key|Scope|scope)\s*[=(]|\bkey=\{/.test(line);
    const tm = isKey ? [] : line.match(/`[^`]*`/g) ?? [];
    for (const t of tm) {
      if (!new RegExp(IDENT).test(t)) continue;
      const m = t.match(R2);
      if (!m) continue;
      if (/\(/.test(m[0])) continue;
      if (m[1] === '`' && t.replace(/\$\{[^{}]*\}/g, '').length <= 2) continue;
      return hit('R2 template');
    }
    if (R3.test(line)) return hit('R3 strip-scheme');
    if (!isKey && R4.test(line)) return hit('R4 fallback');
  });
  return out;
}

export function collect(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && e.name !== 'mask-hub-address.ts') out.push(p);
    }
  };
  walk(path.join(root, 'src'));
  const app = path.join(root, 'App.tsx');
  if (fs.existsSync(app)) out.push(app);
  return out.sort();
}

// ── 1. 判据自检:已知坏的必须报 ──
const bad: Array<[string, string, string]> = [
  ['R1 value 属性', 'R1', `<SettingsRow label="地址" value={cfg.serverUrl} />`],
  ['R1 子节点', 'R1', `<Text style={s.host}>{profile.serverUrl}</Text>`],
  ['R1 hubUrl', 'R1', `<Text>{hubUrl}</Text>`],
  ['R1 profile.url', 'R1', `<Row subtitle={profile.url} />`],
  ['R1 无障碍标签', 'R1', `<Pressable accessibilityLabel={p.serverUrl} />`],
  ['R2 模板串带 ·', 'R2', "const body = `${cfg.serverUrl} · ${me.username}`;"],
  ['R2 模板串 @', 'R2', "const label = `${p.username} @ ${p.serverUrl}`;"],
  ['R2 中文提示', 'R2', "toast(`已连接 ${cfg.serverUrl}`);"],
  ['R3 去协议上屏', 'R3', "const host = cfg.serverUrl.replace(/^https?:\\/\\//, '');"],
  ['R4 名字退回地址', 'R4', "const name = p.displayName || p.username || p.serverUrl;"],
  ['R4 i18n 参数里退回地址', 'R4', "tr('settings.copy.182', { v0: profile.displayName || profile.serverUrl })"],
  ['R1 对象字面量 value:(审查 B1 原形)', 'R1', "    { label: '服务器', value: safeServerLabel(node?.server ?? session.server) ?? safeServerUrl(serverUrl) },"],
  ['R1 对象字面量 label:', 'R1', "rows.push({ label: cfg.serverUrl, key: 'srv' });"],
  ['R4 ?? 兜底到地址', 'R4', "const shown = node?.server ?? cfg.serverUrl;"],
  ['R4 ?? 包一层函数', 'R4', "const shown = label ?? safeServerUrl(serverUrl);"],
  ['R4 || 链以逗号结尾(审查 N2 原形)', 'R4', "        window.context || profile.displayName || profile.username || profile.serverUrl,"],
];
for (const [name, rule, code] of bad) {
  const f = scanSource('fixture.tsx', code);
  ck(`判据·坏:${name} → 报 ${rule}`, f.length === 1 && f[0].rule.startsWith(rule), JSON.stringify(f));
}

// ── 2. 判据自检:不该报的不报 ──
const good: Array<[string, string, string]> = [
  ['打码后的 value', 'fixture.tsx', `<SettingsRow value={maskedHubHost(cfg.serverUrl)} />`],
  ['打码后的模板', 'fixture.tsx', "const body = `${maskedHubHost(cfg.serverUrl)} · ${me.username}`;"],
  ['拼请求 URL', 'fixture.ts', "const res = await appFetch(`${cfg.serverUrl}${path}`, {});"],
  ['拼 /api 路径', 'fixture.ts', "const u = `${cfg.serverUrl}/api/files/${id}`;"],
  ['缓存键 \\u0000', 'fixture.ts', "const key = `${cfg.serverUrl}\\u0000${cfg.token}`;"],
  ['缓存键 |', 'fixture.tsx', "avatarColor(`${profile.serverUrl}|${profile.username}`)"],
  ['传给子组件的 serverUrl 属性', 'fixture.tsx', `<AttachmentFile serverUrl={cfg.serverUrl} token={cfg.token} />`],
  ['?? 当键', 'fixture.tsx', "const k = `${cfg?.profileId ?? cfg?.serverUrl ?? 'login'}`;"],
  ['复制完整值', 'fixture.tsx', "onCopy={() => copy('host', cfg.serverUrl)}"],
  ['?? 左边是地址(取缓存)', 'fixture.ts', "const v = connectedSinceByServer.get(cfg.serverUrl) ?? null;"],
  ['类型标注里的 serverUrl', 'fixture.ts', "type P = { label: string; serverUrl: string };"],
  ['?? 拼进 xxxKey(不上屏)', 'fixture.ts', "const draftHandoffKey = `chatDraft:${cfg.profileId ?? cfg.serverUrl}:${alias}`;"],
  ['?? 作为 xxxKey() 参数', 'fixture.ts', "requestNodeSection(nodeInfoSectionKey(cfg.profileId ?? cfg.serverUrl, alias), s);"],
  ['对象里 serverUrl 作键传参', 'fixture.ts', "const text = accountCopyText({ serverUrl: profile.serverUrl, username: profile.username });"],
  ['注释里提到', 'fixture.tsx', "// 以前这里是 <Text>{cfg.serverUrl}</Text>"],
  ['白名单输入框', 'App.tsx', '                value={serverUrl}'],
  ['React key 用地址', 'fixture.tsx', "<View key={`${attachmentCacheScope(cfg.serverUrl, cfg.token)}-${a.key}`} />"],
  ['xxxKey 赋值', 'fixture.tsx', "const workspaceKey = `${theme}:${cfg?.profileId ?? cfg?.serverUrl ?? 'login'}`;"],
  ['箭头函数体不是 JSX 子节点', 'fixture.ts', "set: (serverUrl: string, value: R) => { map.set(key(serverUrl), value); },"],
];
for (const [name, file, code] of good) {
  const f = scanSource(file, code);
  ck(`判据·好:${name} → 不报`, f.length === 0, JSON.stringify(f));
}
ck('白名单只认那个文件:别的文件里同一行照报', scanSource('src/Other.tsx', 'value={serverUrl}').length === 1);
ck('白名单每条都写了理由', ALLOWLIST.every(a => a.why.length >= 8));

// ── 2b. 跨平台自检(Linux 上就能抓到 Windows 才会出的错) ──
ck('toPosix:反斜杠路径 → 正斜杠', toPosix('src\\deep\\er\\c.tsx') === 'src/deep/er/c.tsx' && toPosix('src/a.tsx') === 'src/a.tsx');
{
  const crlf = ['const ok = 1;', '<SettingsRow value={cfg.serverUrl} />', '                value={serverUrl}', "const b = `${cfg.serverUrl}`;", '// 以前这里是 <Text>{cfg.serverUrl}</Text>', ''].join('\r\n');
  const f = scanSource('App.tsx', crlf);
  ck('CRLF 源码:坏行照报、行号对', f.length === 1 && f[0].line === 2 && f[0].rule.startsWith('R1'), JSON.stringify(f));
  ck('CRLF 源码:白名单输入框照样放行(行尾 \\r 不影响比较)', !f.some(x => x.line === 3));
  ck('CRLF 源码:只有插值的模板串不因行尾 \\r 被当成上屏文字', !f.some(x => x.line === 4), JSON.stringify(f));
  // `.` 不匹配 \r:不先去掉行尾 \r,去注释的 /\/\/.*$/ 在 CRLF 行上整条失配,注释里的旧写法会被当成代码报出来。
  ck('CRLF 源码:注释行照样被去掉', !f.some(x => x.line === 5), JSON.stringify(f));
}

// ── 3. 取集自检 ──
{
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'hub-guard-'));
  fs.mkdirSync(path.join(tmp, 'src', 'deep', 'er'), { recursive: true });
  for (const f of ['src/a.tsx', 'src/b.ts', 'src/deep/er/c.tsx', 'src/x.test.ts', 'src/mask-hub-address.ts', 'App.tsx']) fs.writeFileSync(path.join(tmp, f), '');
  const got = collect(tmp).map(p => toPosix(path.relative(tmp, p))).sort();
  ck('取集:递归收子目录、带上 App.tsx、跳过测试与打码模块本身', JSON.stringify(got) === JSON.stringify(['App.tsx', 'src/a.tsx', 'src/b.ts', 'src/deep/er/c.tsx']), JSON.stringify(got));
  fs.rmSync(tmp, { recursive: true, force: true });
}
const files = collect(ROOT);
const rel = files.map(f => toPosix(path.relative(ROOT, f)));
ck('取集:真仓里收到了 ServerScreen / SettingsScreen / SettingsPhonePages / App.tsx', ['src/ServerScreen.tsx', 'src/SettingsScreen.tsx', 'src/SettingsPhonePages.tsx', 'App.tsx'].every(f => rel.includes(f)), String(rel.length));
ck('取集:真仓里有子目录下的文件(没退回非递归)', rel.some(f => f.split('/').length > 2), '');
ck('取集:文件数 > 100(分母没塌)', files.length > 100, String(files.length));

// ── 4. 真仓:0 条违规,且白名单每条都还在用 ──
const findings = files.flatMap(f => scanSource(toPosix(path.relative(ROOT, f)), fs.readFileSync(f, 'utf8')));
ck('真仓:没有未打码的 Hub 地址上屏', findings.length === 0, '\n' + findings.map(f => `   ${f.file}:${f.line} [${f.rule}] ${f.text}`).join('\n'));
for (const a of ALLOWLIST) {
  const src = fs.readFileSync(path.join(ROOT, a.file), 'utf8');
  ck(`白名单仍然对应真代码:${a.file} ${a.line}`, src.split(/\r?\n/).some(l => l.trim() === a.line));
}

console.log(`\n${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
