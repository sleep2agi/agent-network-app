// 纯逻辑单测(bun/node 可跑)。run: bun src/login-flow.test.ts
// 登录失败分类+URL 规范化(App战线① PR4)。断的是分叉本身,不耦合文案(通信龙 08-18)。
import http from 'node:http';
import { classifyLoginFailure, LOGIN_FAILURE_COPY, normalizeServerUrl, type LoginFailureKind } from './login-flow';
import { login } from './api';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

// ── 🔴 分叉本身:四种 kind 两两不同(合并任何两种=用户动作被误导) ─────────────────
const kinds: LoginFailureKind[] = [
  classifyLoginFailure(true, null),   // fetch 抛 → unreachable
  classifyLoginFailure(false, 401),   // 401 → bad-credentials
  classifyLoginFailure(false, 500),   // 5xx → server-error
  'bad-url',                          // 预检产生(不经网络)
];
ck('🔴 网络抛→unreachable', kinds[0] === 'unreachable');
ck('🔴 401→bad-credentials(改密码,不是等网络)', kinds[1] === 'bad-credentials');
ck('403→bad-credentials·500→server-error', classifyLoginFailure(false, 403) === 'bad-credentials' && kinds[2] === 'server-error');
ck('🔴 四种 kind 两两不同(结构可分·非文案可分)', new Set(kinds).size === 4);
ck('边界:200 但业务失败(!data.ok 非 401/403)→ server-error 而非 credentials', classifyLoginFailure(false, 200) === 'server-error');

// ── 文案契约:每种都有「发生了什么」+「下一步」,且不是「出错了请重试」式空话 ────────
for (const k of kinds) {
  const c = LOGIN_FAILURE_COPY[k];
  ck(`${k}: what+next 都非空且 next 是具体动作(≥8字)`, !!c && c.what.length >= 4 && c.next.length >= 8 && !/^出错|^请重试$/.test(c.next));
}

// ── URL 规范化:用户常见输入形态 ────────────────────────────────────────────────
const n = normalizeServerUrl;
ck('漏协议自动补 https://', (() => { const r = n('hub.example.com'); return r.ok && r.url === 'https://hub.example.com'; })());
ck('去尾斜杠+trim', (() => { const r = n('  https://hub.example.com///  '); return r.ok && r.url === 'https://hub.example.com'; })());
ck('http:// 保留(内网明文)', (() => { const r = n('http://192.168.1.5:9999'); return r.ok && r.url === 'http://192.168.1.5:9999'; })());
ck('空串 → bad-url', !n('').ok && !n('   ').ok);
ck('含空格 → bad-url(不发请求)', !n('http://exa mple.com').ok);
ck('纯垃圾 → bad-url', !n('ht!tp:/:/x').ok);

// ── N 组:🔴「这不是 hub」的 401 ≠「密码错」(review-fix·pre-fix 已录红) ────────────
// 401+HTML(basic-auth nginx)/ 401+空体 → server-error;判 bad-credentials 会让用户
// 对着错误的地址反复重打密码。规则=响应形状不对与 HTTP 状态码无关(同 no-token 行)。
{
  const mk = (body: string) => http.createServer((rq, rs) => { rs.writeHead(401, { 'content-type': 'text/html' }); rs.end(body); });
  const h1 = mk('<html>401 Authorization Required — nginx</html>');
  const h2 = mk('');
  await new Promise<void>(r => h1.listen(5816, '127.0.0.1', () => r()));
  await new Promise<void>(r => h2.listen(5817, '127.0.0.1', () => r()));
  const htmlCase = await login('http://127.0.0.1:5816', 'u', 'p');
  const emptyCase = await login('http://127.0.0.1:5817', 'u', 'p');
  h1.close(); h2.close();
  ck('🔴 N1 401+HTML 体 → server-error(非 bad-credentials·kind 与文案同向)', !htmlCase.ok && htmlCase.kind === 'server-error');
  ck('🔴 N2 401+空体 → server-error', !emptyCase.ok && emptyCase.kind === 'server-error');
  // 正控:真 hub 的 401(合法 JSON {ok:false})仍是 bad-credentials——收紧没有误伤真凭据错
  const hub = http.createServer((rq, rs) => { rs.writeHead(401, { 'content-type': 'application/json' }); rs.end('{"ok":false,"error":"invalid credentials"}'); });
  await new Promise<void>(r => hub.listen(5818, '127.0.0.1', () => r()));
  const cred = await login('http://127.0.0.1:5818', 'u', 'p');
  hub.close();
  ck('N3 正控:JSON 401(真 hub 拒凭据)仍 → bad-credentials', !cred.ok && cred.kind === 'bad-credentials');
}

console.log(`\n${p}/${t} passed`);
if (p !== t) { if (typeof process !== 'undefined') process.exit(1); }
