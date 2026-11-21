// 节点运行时（runtime）切换——纯逻辑层。
//
// admin 2026-11-21：运行时只能 `anet node edit --runtime` 换，App 的「模型与运行时」tab 只有读。
// 负责人定的口径：放在「更多选项 / 进阶」、不要和常规模型切换混在一起；文案必须写
// 「需要重启生效」+「换运行时可能需要重新配置认证」；只写配置 + 回读，不声称运行时已切换。
//
// 这里只做：候选清单（来自已有的 RUNTIME_GUIDE，允许任意输入，不声称完整）、校验、patch。
import { RUNTIME_GUIDE } from './daemon-overview';

export type RuntimeOption = { id: string; label: string };

/** 已知 runtime 清单（顺序 = `anet` 自己那张表；允许任意输入，所以不声称完整）。 */
export function runtimeOptions(): RuntimeOption[] {
  return Object.keys(RUNTIME_GUIDE).map(id => ({ id, label: id }));
}

export type RuntimeSwitchCheck =
  | { ok: true; value: string }
  | { ok: false; reason: 'invalid_runtime' | 'same_runtime' };

/** 校验并规范化：trim、非空、≤64、无空白/控制字符；与当前相同则不产生请求。 */
export function validateRuntimeSwitch(input: string, current: string | null | undefined): RuntimeSwitchCheck {
  const value = String(input ?? '').trim();
  if (!value || value.length > 64 || /[\s\u0000-\u001f\u007f]/.test(value)) return { ok: false, reason: 'invalid_runtime' };
  const currentId = String(current ?? '').trim();
  if (currentId && currentId === value) return { ok: false, reason: 'same_runtime' };
  return { ok: true, value };
}

/** 这个运行时如果已知登录命令，一并提示（换运行时后可能要重新登录）。 */
export function runtimeLoginHint(runtimeId: string): string | null {
  const id = String(runtimeId ?? '').trim();
  if (!id) return null;
  const login = RUNTIME_GUIDE[id]?.login ?? null;
  return login && String(login).trim() ? String(login).trim() : null;
}

/** 写入节点配置时用的最小 patch（与 CLI `anet node edit --runtime` 同一字段）。 */
export function patchForRuntime(value: string): { runtime: string } {
  return { runtime: String(value ?? '').trim() };
}

export function runtimeSwitchErrorText(reason: string): string {
  if (reason === 'invalid_runtime') return '运行时 id 不能为空、不能带空格或控制字符，最长 64。';
  if (reason === 'same_runtime') return '和当前运行时相同，不需要改。';
  return reason;
}
