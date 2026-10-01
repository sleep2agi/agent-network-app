import { registerTranslations } from './i18n';

// 「上次异常退出」:渲染出错时的兜底页(FatalBoundary.tsx)、下次启动的小提示(LastCrashChip.tsx)、
// 设置 › 关于 的复制行。
registerTranslations({
  'fatal.title': ['出错了', 'Something went wrong'],
  'fatal.body': ['这一页遇到了一个错误，诊断信息已保存。', 'This screen hit an error. Diagnostics were saved.'],
  'fatal.reload': ['重新加载', 'Reload'],
  'fatal.chip': ['上次异常退出', 'Quit unexpectedly last time'],
  'fatal.send': ['发送诊断', 'Send diagnostics'],
  'fatal.pickRecipient': ['把诊断发给…', 'Send diagnostics to…'],
  'fatal.sending': ['发送中…', 'Sending…'],
  'fatal.sent': ['诊断已发送', 'Diagnostics sent'],
  'fatal.sendFailed': ['发送失败，可在 设置 › 关于 复制', 'Send failed — copy it from Settings › About'],
  'fatal.dismiss': ['关闭', 'Dismiss'],
  'fatal.copyRow': ['复制上次崩溃信息', 'Copy last crash info'],
  'fatal.copied': ['已复制', 'Copied'],
});
