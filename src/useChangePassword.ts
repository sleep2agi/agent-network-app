// 修改密码表单的状态与提交(手机三级页和桌面右栏共用这一份,只是画法不同)。
import { useState } from 'react';
import { t as tr } from './i18n';
import './i18n-password';
import { authProfileId, type HubConfig } from './api';
import { beginTokenRotation } from './profile-auth-state';
import { changeHubPassword } from './change-password-api';
import { changePasswordFormProblem, strengthHint, type ChangePasswordForm, type StrengthHint } from './password-policy';

export type ChangePasswordState = {
  form: ChangePasswordForm;
  set: (field: keyof ChangePasswordForm, value: string) => void;
  /** 新密码下面那行:规则 / 哪条不够 / 符合要求。 */
  hint: StrengthHint;
  /** 确认框有字之后才说一不一致(null = 还没输)。 */
  confirmMatches: boolean | null;
  error: string;
  busy: boolean;
  submit: () => Promise<void>;
  reset: () => void;
};

const EMPTY: ChangePasswordForm = { current: '', next: '', confirm: '' };

/** 新密码强度提示的文案(手机 footer / 桌面输入框下面同一句)。 */
export function strengthHintText(hint: StrengthHint, password: string): string {
  if (hint === 'too-short') return tr('password.hint.tooShort', { n: Math.max(1, 8 - password.length) });
  if (hint === 'too-common') return tr('password.hint.tooCommon');
  if (hint === 'ok') return tr('password.hint.ok');
  return tr('password.rule');
}

export type ChangePasswordOutcome = { ok: true } | { ok: false; error: string; clearCurrent?: boolean };

/**
 * 一次「修改密码」:本地校验 → POST /api/auth/password → onChanged(新令牌)。纯流程(api 可注入),hook 和测试共用。
 * 本地校验不过 = 不发请求。onChanged 拿到 hub 新签的令牌(旧 hub 没有 → undefined),负责把它存下、换掉当前会话;抛错 = 存不下。
 */
export async function runChangePassword(
  cfg: Pick<HubConfig, 'serverUrl' | 'token' | 'profileId'>,
  form: ChangePasswordForm,
  onChanged: (token: string | undefined, revoked: number | undefined) => Promise<void>,
  api: typeof changeHubPassword = changeHubPassword,
): Promise<ChangePasswordOutcome> {
  const problem = changePasswordFormProblem(form);
  if (problem) return { ok: false, error: tr(`password.err.${problem}`) };
  // hub 会在处理这个请求时吊销 cfg.token:同时在飞的读拿旧令牌回 401,别把人踢回登录页(profile-auth-state.ts)。
  const endRotation = beginTokenRotation(authProfileId(cfg), cfg.token);
  let result: Awaited<ReturnType<typeof changeHubPassword>>;
  try {
    result = await api(cfg, form.current, form.next);
  } catch (e) {
    endRotation(false);
    throw e;
  }
  // 旧 hub 不回新令牌也不吊销旧的:那旧令牌没死,它的 401 照常上报。
  endRotation(result.ok && !!result.token);
  if (!result.ok) {
    return {
      ok: false,
      error: result.kind === 'server' ? tr('password.err.server', { msg: result.message }) : tr(`password.err.${result.kind}`),
      ...(result.kind === 'wrong-current' ? { clearCurrent: true } : {}),
    };
  }
  try {
    await onChanged(result.token, result.revoked);
  } catch (e) {
    return { ok: false, error: tr('password.err.save', { msg: e instanceof Error ? e.message : String(e) }) };
  }
  return { ok: true };
}

/** 表单状态 + 提交。成功后表单清空(密码不在内存里多留)。 */
export function useChangePassword(cfg: Pick<HubConfig, 'serverUrl' | 'token' | 'profileId'>, onChanged: (token: string | undefined, revoked: number | undefined) => Promise<void>): ChangePasswordState {
  const [form, setForm] = useState<ChangePasswordForm>(EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (field: keyof ChangePasswordForm, value: string) => { setForm(f => ({ ...f, [field]: value })); setError(''); };
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const outcome = await runChangePassword(cfg, form, onChanged);
      if (outcome.ok) setForm(EMPTY);
      else {
        setError(outcome.error);
        if (outcome.clearCurrent) setForm(f => ({ ...f, current: '' }));
      }
    } finally {
      setBusy(false);
    }
  };
  return {
    form,
    set,
    hint: strengthHint(form.next),
    confirmMatches: form.confirm ? form.confirm === form.next : null,
    error,
    busy,
    submit,
    reset: () => { setForm(EMPTY); setError(''); },
  };
}
