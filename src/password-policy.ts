// 修改密码(#653,Vincent「admin 自己登录在客户端里面，它自己有个 UI 去改」)的纯逻辑:强度规则、表单校验、
// hub 失败分类。可单测,不 import react-native。
//
// 🔴 强度规则照抄 hub(sleep2agi/agent-network server/src/auth.ts validatePasswordStrength + password-dict.ts):
//   · 少于 8 个字符 → "new password must be at least 8 characters"
//   · 小写后在弱密码表里 → "new password is too common"
// 这里只是**提示**:最终以 hub 的 400 为准(hub 的表以后变了,这里漏判的也会被 hub 拒、照样显示「太简单」)。
// 表与 hub 逐字一致(password-policy.test.ts 抽样断言了几条,包括生成的 000000–000999 / password0–999 / qwerty0–999)。

/** hub 的最短长度(validatePasswordStrength)。 */
export const PASSWORD_MIN_LENGTH = 8;

// 照抄 hub password-dict.ts WEAK_PASSWORDS_RAW(数据,不是界面文案)。
const WEAK_RAW = `
123456 password 123456789 12345 12345678 qwerty 1234567 111111 1234567890 123123 abc123 1234 password1 iloveyou
1q2w3e4r 000000 qwerty123 zaq12wsx dragon sunshine princess letmein monkey football baseball welcome admin login
master hello freedom whatever trustno1 qazwsx 654321 superman batman passw0rd password123 asdfgh zxcvbnm qwertyuiop
1qaz2wsx lovely flower hunter shadow buster soccer hockey killer george charlie andrew michael jessica michelle
pepper jordan harley ranger ginger joshua maggie mustang computer internet secret summer winter spring autumn
orange banana cookie coffee matrix starwars pokemon naruto 888888 666666 5201314 121212 112233 159753 987654321
`;

const WEAK = (() => {
  const set = new Set(WEAK_RAW.trim().split(/\s+/).map(p => p.toLowerCase()));
  for (let i = 0; i <= 999; i++) {
    set.add(String(i).padStart(6, '0'));
    set.add(`password${i}`);
    set.add(`qwerty${i}`);
  }
  return set;
})();

export const isCommonPassword = (password: string): boolean => WEAK.has(password.toLowerCase());

export type PasswordStrengthProblem = 'too-short' | 'too-common';

/** hub 会不会拒这个新密码(null = 不会)。 */
export function passwordStrengthProblem(password: string): PasswordStrengthProblem | null {
  if (!password || password.length < PASSWORD_MIN_LENGTH) return 'too-short';
  if (isCommonPassword(password)) return 'too-common';
  return null;
}

/** 输入框下面那行提示的状态:空 = 只写规则;有问题 = 红字说哪条;过了 = 主色「可以使用」。 */
export type StrengthHint = 'rule' | PasswordStrengthProblem | 'ok';
export function strengthHint(password: string): StrengthHint {
  if (!password) return 'rule';
  return passwordStrengthProblem(password) ?? 'ok';
}

export type ChangePasswordForm = { current: string; next: string; confirm: string };

export type ChangePasswordProblem =
  | 'current-required'
  | PasswordStrengthProblem
  | 'mismatch'
  | 'same-as-current';

/** 提交前的本地校验。顺序 = 用户最该先改的那一项。null = 可以发给 hub。 */
export function changePasswordFormProblem(form: ChangePasswordForm): ChangePasswordProblem | null {
  if (!form.current) return 'current-required';
  const strength = passwordStrengthProblem(form.next);
  if (strength) return strength;
  if (form.next !== form.confirm) return 'mismatch';
  if (form.next === form.current) return 'same-as-current';
  return null;
}

export type ChangePasswordFailure =
  | 'wrong-current'
  | PasswordStrengthProblem
  | 'signed-out'
  | 'network'
  | 'server';

/**
 * hub 的失败 → 用户该做什么。
 *   400 "incorrect current password"            → wrong-current(重输当前密码)
 *   400 "… at least 8 characters" / "… too common" → too-short / too-common(换个新密码)
 *   401(令牌失效 / 过期)                        → signed-out(重新登录)
 *   fetch 抛了 / 超时                             → network
 *   其余(5xx、非 JSON、403 节点令牌…)          → server
 */
export function classifyChangePasswordFailure(input: { network: boolean; status?: number | null; error?: string | null }): ChangePasswordFailure {
  if (input.network) return 'network';
  const error = String(input.error ?? '').toLowerCase();
  if (input.status === 401) return 'signed-out';
  if (error.includes('incorrect current password')) return 'wrong-current';
  if (error.includes('at least') && error.includes('characters')) return 'too-short';
  if (error.includes('too common')) return 'too-common';
  return 'server';
}
