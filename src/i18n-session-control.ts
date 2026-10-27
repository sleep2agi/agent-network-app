import { registerTranslations } from './i18n';
export const sessionControlTranslations = {
  'sessionControl.title': ['OpenCode 原会话', 'Original OpenCode session'],
  'sessionControl.read': ['读取状态', 'Read status'],
  'sessionControl.refresh': ['刷新状态', 'Refresh status'],
  'sessionControl.loading': ['正在读取原会话…', 'Reading the original session…'],
  'sessionControl.requesting': ['正在请求转到后台…', 'Requesting background observation…'],
  'sessionControl.background': ['转到后台（Ctrl+B）', 'Move to background (Ctrl+B)'],
  // 手机上没有 Ctrl+B：同一个动作不带键盘提示（Vincent 2026-10-23 截图：手机上写着 Ctrl+B 很丑）。
  // 手机上那一条只有一行,用短标签(Vincent 2026-10-23:整块卡片「太丑」)。
  'sessionControl.titleShort': ['原会话', 'Original'],
  'sessionControl.readShort': ['读取', 'Read'],
  'sessionControl.backgroundShort': ['转后台', 'Background'],
  'sessionControl.backgroundTouch': ['转到后台', 'Move to background'],
  'sessionControl.running': ['前台运行中', 'Running in foreground'],
  'sessionControl.idle': ['前台空闲', 'Foreground idle'],
  'sessionControl.initial': ['读取原会话的前台运行状态；不会发送聊天消息。', 'Read the original session’s foreground status without sending a chat message.'],
  'sessionControl.hint': ['只请求将支持后台的前台工具转为后台观察，不会停止或重启会话。这不是终端画面。', 'Request background observation for supported foreground tools. This does not stop or restart the session and is not a terminal view.'],
  'sessionControl.processed': ['请求已处理；不代表一定有工具转到后台。', 'Request processed; this does not prove a tool moved to the background.'],
  'sessionControl.alreadyIdle': ['会话已空闲，无需转到后台。', 'The session is already idle; no background transition was needed.'],
  'sessionControl.stale': ['状态已过期，请先刷新。', 'Status is stale. Refresh it first.'],
  'sessionControl.error.unavailable': ['未能读取原会话，请稍后刷新状态。', 'Could not read the original session. Refresh status later.'],
  'sessionControl.error.unsupported': ['当前 Hub、Bridge 或 OpenCode 尚不支持此控制；没有发送按键或命令。', 'This Hub, Bridge or OpenCode does not support this control. No keys or commands were sent.'],
  'sessionControl.error.access': ['需要此节点所有者或网络所有者、管理员权限。', 'Node owner or network owner/admin access is required.'],
  'sessionControl.error.changed': ['原节点或会话绑定已变化，已拒绝操作，请刷新状态。', 'The node or session binding changed. The action was refused. Refresh status.'],
  'sessionControl.error.unknown': ['无法确认请求结果，未自动重试。请查看原会话；本页不再重复发送。', 'The request outcome is unknown and was not retried. Check the original session; this view will not resend it.'],
  'sessionControl.error.expired': ['状态请求已过期，请刷新。', 'The status request expired. Refresh it.'],
} as const;
registerTranslations(sessionControlTranslations);
