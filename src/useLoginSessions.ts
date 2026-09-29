// 设置 → 账号 → 登录设备 的状态:手机子页和宽屏右栏读同一份(SettingsScreen 里调一次)。
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HubConfig } from './api';
import { t } from './i18n';
import { fetchLoginSessions, revokeLoginSession, revokeOtherLoginSessions } from './login-sessions-api';
import { orderSessions, otherSessionCount, type LoginSession, type SessionsLoad } from './login-sessions';

export type SessionsConfirm = { kind: 'others'; count: number } | { kind: 'one'; session: LoginSession; name: string };

export function useLoginSessions(cfg: Pick<HubConfig, 'serverUrl' | 'token' | 'profileId'>) {
  // null = 还在加载。旧 hub 没有这个接口 → 'unsupported',入口整个不出现。
  const [load, setLoad] = useState<SessionsLoad | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<SessionsConfirm | null>(null);
  const [showAll, setShowAll] = useState(false);

  const refresh = useCallback(async () => {
    setLoad(await fetchLoginSessions(cfg as HubConfig));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.serverUrl, cfg.token]);

  useEffect(() => {
    setLoad(null);
    setMessage(null);
    setShowAll(false);
    void refresh();
  }, [refresh]);

  const sessions = useMemo(() => (load?.kind === 'ok' ? orderSessions(load.sessions) : []), [load]);

  const revokeOne = async (session: LoginSession) => {
    setBusy(session.token_id);
    setMessage(null);
    try {
      const r = await revokeLoginSession(cfg as HubConfig, session.token_id);
      if (!r.ok) setMessage({ ok: false, text: t('sessions.revokeFailed', { msg: r.error }) });
      await refresh();
    } catch (e) {
      setMessage({ ok: false, text: t('sessions.revokeFailed', { msg: e instanceof Error ? e.message : String(e) }) });
    } finally {
      setBusy(null);
    }
  };

  const revokeOthers = async () => {
    setBusy('others');
    setMessage(null);
    try {
      const r = await revokeOtherLoginSessions(cfg as HubConfig);
      setMessage(r.ok ? { ok: true, text: t('sessions.revokedOthers', { n: r.revoked ?? 0 }) } : { ok: false, text: t('sessions.revokeFailed', { msg: r.error }) });
      await refresh();
    } catch (e) {
      setMessage({ ok: false, text: t('sessions.revokeFailed', { msg: e instanceof Error ? e.message : String(e) }) });
    } finally {
      setBusy(null);
    }
  };

  return {
    load,
    /** 入口出现的条件:hub 明确支持(加载成功)或者支持但这次读失败了(出错也要能进去看到错误、重试)。 */
    available: load?.kind === 'ok' || load?.kind === 'error',
    sessions,
    others: otherSessionCount(sessions),
    idleDays: load?.kind === 'ok' ? load.idleDays : null,
    error: load?.kind === 'error' ? load.message : null,
    busy,
    message,
    showAll,
    setShowAll,
    confirm,
    askRevokeOne: (session: LoginSession, name: string) => setConfirm({ kind: 'one', session, name }),
    askRevokeOthers: () => setConfirm({ kind: 'others', count: otherSessionCount(sessions) }),
    cancelConfirm: () => setConfirm(null),
    runConfirm: () => {
      const c = confirm;
      setConfirm(null);
      if (!c) return;
      if (c.kind === 'others') void revokeOthers();
      else void revokeOne(c.session);
    },
    refresh,
  };
}

export type LoginSessionsState = ReturnType<typeof useLoginSessions>;
