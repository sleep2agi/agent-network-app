import { registerTranslations } from './i18n';

// 切换账号(Vincent 2026-09-29):设置里「退出登录」上面那一行、手机底部面板 / 桌面对话框、登录页「添加账号」模式。
registerTranslations({
  'accounts.switch': ['切换账号', 'Switch account'],
  'accounts.switchHint': ['保存的账号都保持登录，点一下直接切换', 'Saved accounts stay signed in. Tap one to switch.'],
  'accounts.current': ['当前使用', 'Current'],
  'accounts.add': ['添加账号', 'Add account'],
  'accounts.manage': ['管理', 'Manage'],
  'accounts.done': ['完成', 'Done'],
  'accounts.cancel': ['取消', 'Cancel'],
  'accounts.close': ['关闭', 'Close'],
  'accounts.remove': ['移除', 'Remove'],
  'accounts.removeLabel': ['移除 {name}', 'Remove {name}'],
  'accounts.pick': ['切换到 {name}', 'Switch to {name}'],
  'accounts.reauth': ['登录已失效，点一下重新验证', 'Signed out. Tap to sign in again.'],
  'accounts.local': ['本地工作区', 'Local workspace'],
  'accounts.addTitle': ['添加账号', 'Add an account'],
  'accounts.addCopy': ['登录另一个账号或服务器。当前账号会保持登录，之后可在「设置 → 切换账号」里切回。', 'Sign in to another account or server. Your current account stays signed in; switch back from Settings → Switch account.'],
  'accounts.cancelAdd': ['取消，返回当前账号', 'Cancel and go back'],
});
