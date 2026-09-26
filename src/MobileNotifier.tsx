// 0.2.107 手机端新消息系统通知的挂载点。只做两件事:把当前账号交给运行时(登录/换号/登出),
// 把「点通知 → 打开会话」接到导航上。拉消息、判定、发通知都在 notifier-runtime.ts(模块级,
// 界面卸载后「后台保持连接」开着时仍要继续)。桌面端不挂这个组件(桌面有 DesktopNotifier)。
import { useEffect, useRef } from 'react';
import type { HubConfig } from './api';
import { attachNotifierUi, setNotifierConfig } from './notifier-runtime';

export default function MobileNotifier({ cfg, onOpenChat }: { cfg: HubConfig | null; onOpenChat: (alias: string) => void }) {
  const open = useRef(onOpenChat);
  open.current = onOpenChat;
  useEffect(() => { void setNotifierConfig(cfg).catch(() => { /* 通知是附带功能 */ }); }, [cfg?.profileId, cfg?.serverUrl, cfg?.token, cfg?.username, cfg?.networkId]);
  useEffect(() => attachNotifierUi(alias => open.current(alias)), []);
  return null;
}
