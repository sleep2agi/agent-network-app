// 纯逻辑单测(bun/node 可跑)。run: bun src/login-flow.test.ts
// 登录失败分类+URL 规范化(App战线① PR4)。断的是分叉本身,不耦合文案(通信龙 08-18)。
import { classifyLoginFailure, LOGIN_FAILURE_COPY, normalizeServerUrl, type LoginFailureKind } from './login-flow';

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

console.log(`\n${p}/${t} passed`);
if (p !== t) { if (typeof process !== 'undefined') process.exit(1); }
