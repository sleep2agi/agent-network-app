// 登录流纯逻辑(App战线① PR4):URL 规范化 + 失败分类。可单测。
//
// 🔴 判据(通信龙 08-18):断的是**分叉本身**——「凭据错」和「网络不可达」用户动作完全
// 不同(改密码 vs 等网络/查地址),必须结构可分(kind),不许合并成一句「登录失败」。
// witnessed-red:pre-fix 两种失败同为 {ok:false,error:<散文>},结构不可分(已录红)。

export type LoginFailureKind = 'bad-url' | 'unreachable' | 'bad-credentials' | 'server-error';

export interface LoginFailureCopy {
  /** 发生了什么(人话) */
  what: string;
  /** 下一步做什么 */
  next: string;
}

// 每种失败:说清楚发生了什么 + 下一步做什么(不许「出错了请重试」)。
// UI 断言用 kind/testID(结构),不耦合这些文案——文案可改,分叉不可合并。
export const LOGIN_FAILURE_COPY: Record<LoginFailureKind, LoginFailureCopy> = {
  'bad-url': {
    what: '服务器地址格式不对',
    next: '检查地址拼写,例如 https://your-hub.example.com（可省略 https://,会自动补上）',
  },
  unreachable: {
    what: '连不上服务器',
    next: '检查网络连接和服务器地址是否可达;如在内网,确认已连 VPN;若为内网地址,试试显式填 http://',
  },
  'bad-credentials': {
    what: '用户名或密码不对',
    next: '核对后重新输入;忘记密码请联系管理员',
  },
  'server-error': {
    what: '服务器响应异常',
    next: '确认地址指向 hub 服务;若地址无误,稍后再试或联系管理员',
  },
};

/** 规范化服务器地址:trim、自动补 https://、去尾斜杠;不合法 → bad-url。 */
export function normalizeServerUrl(raw: string): { ok: true; url: string } | { ok: false; kind: 'bad-url' } {
  let u = (raw || '').trim();
  if (!u) return { ok: false, kind: 'bad-url' };
  if (/\s/.test(u)) return { ok: false, kind: 'bad-url' };
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`; // 用户常漏协议——补上而不是报错
  u = u.replace(/\/+$/, '');
  try {
    const parsed = new URL(u);
    // WHATWG URL 对垃圾宿主名过于宽容(https://ht!tp… 也能 parse)——宿主名限
    // 域名/IP 合法字符集(测试「纯垃圾 → bad-url」钉着这条)。
    if (!parsed.hostname || !['http:', 'https:'].includes(parsed.protocol)) return { ok: false, kind: 'bad-url' };
    if (!/^[a-z0-9.-]+$/i.test(parsed.hostname) && !/^\[[0-9a-f:]+\]$/i.test(parsed.hostname)) return { ok: false, kind: 'bad-url' };
  } catch {
    return { ok: false, kind: 'bad-url' };
  }
  return { ok: true, url: u };
}

/** 把 login() 的失败原料分类成 kind。
 *  network=fetch 抛了(连接拒绝/DNS/超时) → unreachable;
 *  HTTP 401/403 → bad-credentials(服务器活着且明确拒了凭据);
 *  其余(5xx/非 JSON/空响应/缺 token)→ server-error。 */
export function classifyLoginFailure(network: boolean, status: number | null): LoginFailureKind {
  if (network) return 'unreachable';
  if (status === 401 || status === 403) return 'bad-credentials';
  return 'server-error';
}
