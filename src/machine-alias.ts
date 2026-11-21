// Hub #3711 —— 机器别名的客户端口径（纯函数，UI 与请求层共用）。
//
// 与 Hub 同口径：1–64 字、trim、禁控制字符（非法 400 invalid_machine_alias）；
// 写接口只认人类令牌（节点令牌 403 user_token_required）。
// 显示规则：alias 为空就回落 hostname —— 不显示「未设置」这类噪音。

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const HAS_CONTROL_CHAR = /[\u0000-\u001f\u007f]/;

export function stripControlChars(value: string): string {
  return String(value ?? '').replace(CONTROL_CHARS, '');
}

/** 列表行/详情页显示用的机器名：alias 优先，空则 hostname。 */
export function machineAliasLabel(hostname: string | null | undefined, alias: string | null | undefined): string {
  const cleanAlias = stripControlChars(String(alias ?? '')).trim();
  if (cleanAlias) return cleanAlias;
  return stripControlChars(String(hostname ?? '')).trim();
}

export type NormalizeAlias = { ok: true; value: string } | { ok: false; error: 'invalid_machine_alias' };

/** 提交前先按 Hub 的规则校验一次（少一次 400 往返）。 */
export function normalizeMachineAlias(input: string): NormalizeAlias {
  const raw = String(input ?? '');
  if (HAS_CONTROL_CHAR.test(raw)) return { ok: false, error: 'invalid_machine_alias' };
  const value = raw.trim();
  if (!value || value.length > 64) return { ok: false, error: 'invalid_machine_alias' };
  return { ok: true, value };
}

/** Hub 的错误码 → 人话（未知错误原样透出，别吞）。 */
export function machineAliasErrorText(code: string): string {
  if (code === 'user_token_required') return '修改机器别名需要人类账号登录，节点令牌不行。';
  if (code === 'invalid_machine_alias') return '机器别名要 1–64 个字，且不能包含控制字符。';
  if (code === 'missing_hostname') return '这台节点没有上报 hostname，暂时无法设置机器别名。';
  return code;
}

/** 一次列表面板里可能有同一台机器上的多个节点：按 hostname 去重，保持出现顺序。 */
export function uniqueHostnames(hostnames: ReadonlyArray<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of hostnames) {
    const host = String(raw ?? '').trim();
    if (!host || seen.has(host)) continue;
    seen.add(host);
    out.push(host);
  }
  return out;
}
