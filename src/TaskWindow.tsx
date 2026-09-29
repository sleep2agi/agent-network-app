import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-tasks';
// 「在新窗口打开」的任务窗口页(`/?taskWindow=1`,只在桌面 Tauri;来龙去脉见 task-window-model.ts)。
// 等开窗的一方送来「哪个任务、哪个账号」,再从凭据库读这个账号(token 不经过事件),然后画一整页任务详情 ——
// 和抽屉同一个 RequirementBoard / TaskDetailPanel(单任务模式):描述全屏、语音、图片、检查项全都能用。
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Text } from './ui-text';
import { colors, spacing } from './theme';
import type { HubConfig } from './api';
import { loadConfig, loadHubProfile } from './storage';
import { sameServer } from './image-window-model';
import { parseTaskWindowPayload, type TaskWindowPayload } from './task-window-model';
import { closeTaskWindow, setTaskWindowTitle, subscribeTaskWindow } from './task-window';
import RequirementBoard from './RequirementBoard';
import MacTitleStrip from './mac-title-strip';
import WinTitleBar from './win-title-bar';

export default function TaskWindow() {
  useTranslation();
  const [payload, setPayload] = useState<TaskWindowPayload | null>(null);
  const [cfg, setCfg] = useState<HubConfig | null>(null);
  const [error, setError] = useState('');
  const latest = useRef(0);

  useEffect(() => {
    let off: (() => void) | undefined;
    let alive = true;
    void subscribeTaskWindow(raw => {
      const next = parseTaskWindowPayload(raw);
      if (!next || next.at < latest.current) return;
      latest.current = next.at;
      setPayload(next);
    }).then(u => { if (alive) off = u; else u(); }).catch(e => setError(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; off?.(); };
  }, []);

  const accountKey = payload ? `${payload.profileId ?? ''}\0${payload.serverUrl}\0${payload.networkId ?? ''}` : '';
  useEffect(() => {
    if (!payload) return;
    let alive = true;
    setCfg(null);
    setError('');
    (payload.profileId ? loadHubProfile(payload.profileId) : loadConfig())
      .then(stored => {
        if (!alive) return;
        if (!stored || !sameServer(stored.serverUrl, payload.serverUrl)) { setError(tr('taskWin.accountGone')); return; }
        // 网络跟开窗那一刻的看板走(同一账号可能在别的窗口切了网络)。
        setCfg({ ...stored, ...(payload.networkId ? { networkId: payload.networkId } : {}) });
      })
      .catch(e => { if (alive) setError(tr('taskWin.accountError', { error: e instanceof Error ? e.message : String(e) })); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey]);

  useEffect(() => { if (payload) void setTaskWindowTitle(payload.title); }, [payload?.taskId, payload?.title]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID="task-window">
      <MacTitleStrip />
      <WinTitleBar />
      {cfg && payload ? (
        <RequirementBoard
          key={`${accountKey}\0${payload.taskId}`}
          cfg={cfg}
          desktop
          single={{ taskId: payload.taskId, onClose: () => { void closeTaskWindow(); }, onTitle: name => { void setTaskWindowTitle(name); } }}
        />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl }}>
          {error ? <Text style={{ color: colors.failed, textAlign: 'center' }} testID="task-window-error">{error}</Text> : <ActivityIndicator color={colors.accent} />}
        </View>
      )}
    </View>
  );
}
