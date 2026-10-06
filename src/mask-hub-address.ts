// #649:服务器页 / 侧栏默认不露完整 Hub 地址。
//
// Vincent 10-06 看到服务器页「地址」一行把完整 Hub 主机名 + 端口原样摆着,「太容易泄露了」
// (截图、投屏、录屏都会带出去)。屏上默认显示打码后的地址,眼睛按钮看完整值,复制按钮照旧复制完整值。
//
// 打码规则(纯函数,mask-hub-address.test.ts 逐条钉住):
//   - 保留协议(有就留)、端口;userinfo(user:pass@)整段丢掉,路径换成 `/****`。
//   - 域名:保留第一段的首字符;三段及以上时再保留第二段的首字符;中间一律 `****`;保留顶级域。
//       y.example.top:9300       → y.e****.top:9300
//       https://a.b.example.com  → https://a.b****.com
//       hub.example.com          → h.e****.com
//       example.com              → e****.com
//       localhost:9200           → l****:9200
//   - IPv4:保留首尾两段,中间两段 `***`:203.0.113.177:9300 → 203.***.***.177:9300
//   - IPv6:保留第一组:[2001:db8::1]:9300 → [2001:****]:9300;首组为空([::1])→ [****]
//   - 方括号里不是 IPv6 字面量([hub.example.com]、没有 ])→ 整段 `****`
//   - 空串原样返回;控制字符去掉;以 `[` 开头却没有 `]` 的、端口不是数字的 → 整段 `****`。

const MASK = '****';
/** 十六进制组 + 冒号,可带 IPv4 尾巴(::ffff:192.0.2.1);必须至少一个冒号。 */
const IPV6_LITERAL = /^(?=[^:]*:)[0-9A-Fa-f:]+(?:\d{1,3}(?:\.\d{1,3}){3})?$/;

function maskDomain(host: string): string {
  const labels = host.split('.').filter(Boolean);
  if (labels.length === 0) return MASK;
  if (labels.length === 1) return `${labels[0][0]}${MASK}`;
  const tld = labels[labels.length - 1];
  const rest = labels.slice(0, -1);
  const head = rest.length >= 2 ? `${rest[0][0]}.${rest[1][0]}` : rest[0][0];
  return `${head}${MASK}.${tld}`;
}

function maskHost(host: string): string {
  if (host.startsWith('[')) {
    // IPv6 字面量 [..]。没有收尾的 `]` 就不是合法字面量 —— 整段打码,别把 `[` 之后的原文当「第一组」漏出去。
    const close = host.indexOf(']');
    if (close < 0) return MASK;
    const inner = host.slice(1, close);
    // 括号里不是 IPv6 字面量(主机名 `[hub.example.com]`、没有冒号、混了别的字)→ 整段打码,不留「第一组」。
    if (!IPV6_LITERAL.test(inner)) return MASK;
    const first = inner.split(':')[0];
    return first ? `[${first}:${MASK}]` : `[${MASK}]`;
  }
  const v4 = host.match(/^(\d{1,3})\.\d{1,3}\.\d{1,3}\.(\d{1,3})$/);
  if (v4) return `${v4[1]}.***.***.${v4[2]}`;
  return maskDomain(host);
}

/** 把 Hub 地址(可带或不带协议)打码成可以出现在屏幕上的样子。 */
export function maskHubAddress(address: string): string {
  // 控制字符(含 NUL)不上屏。
  const s = (address ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!s) return s;
  const m = s.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)?(?:[^@/]*@)?(\[[^\]]*\]|[^:/?#]*)(:\d+)?([/?#].*)?$/);
  if (!m) return MASK;
  const [, scheme = '', host, port = '', tail = ''] = m;
  const path = tail && tail !== '/' ? `/${MASK}` : '';
  return `${scheme}${maskHost(host)}${port}${path}`;
}

/** 屏幕上的地址文案:去掉协议和末尾斜杠;没展开时打码。 */
export function displayHubAddress(serverUrl: string, revealed: boolean): string {
  const host = (serverUrl ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return revealed ? host : maskHubAddress(host);
}

/** 屏幕上任何「这台 Hub 是谁」的地方用它:去协议 + 打码。 */
export function maskedHubHost(serverUrl: string): string {
  return displayHubAddress(serverUrl, false);
}

/** 错误 / 提示文案里夹着的 http(s) 地址(fetch 报错常把完整 URL 带出来)逐个打码。 */
export function maskUrlsInText(text: string): string {
  if (!text) return text;
  return text
    .replace(/\bhttps?:\/\/[^\s'"<>()（）]+/gi, m => maskHubAddress(m.replace(/[.,;:!?。，；：]+$/, '')) + (m.match(/[.,;:!?。，；：]+$/)?.[0] ?? ''))
    // Node / Bun 的网络错误把裸 host[:port] 跟在错误码后面:getaddrinfo ENOTFOUND hub.example.com / connect ECONNREFUSED 1.2.3.4:9300
    // 方括号候选不必成对:] 可以没有(未闭合的 [host),] 后面也可以紧跟裸 host([v6]hub.example.com)。
    // 这两种以前整段进不了 maskHubAddress,主机原样留在屏幕上。
    .replace(/\b(ENOTFOUND|ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EPIPE)(\s+)(\[[^\]\s]*(?:\](?:[A-Za-z0-9.-]+(?::\d+)?)?|(?=\s|$))(?::\d+)?|[A-Za-z0-9.-]+(?::\d+)?)/g,
      (_m, code, sp, hostPort) => `${code}${sp}${maskHubAddress(hostPort)}`);
}
