import { registerTranslations } from './i18n';

registerTranslations({
  'portalReport.row': ['上报日志与 SKILLS', 'Report logs & skills'],
  'portalReport.rowHint': ['匿名上传，或填 PAT 以便门户按设备归因', 'Upload anonymously, or add a PAT so the portal can attribute it'],
  'portalReport.title': ['上报到门户', 'Report to the portal'],
  'portalReport.pat': ['PAT（可留空 = 匿名）', 'PAT (leave empty = anonymous)'],
  'portalReport.patHint': ['PAT 只用于这一次请求，不写入日志也不随日志上报。', 'The PAT is used for this request only; it is never logged or uploaded.'],
  'portalReport.sendLogs': ['上报日志', 'Send logs'],
  'portalReport.sendSkills': ['上报 SKILLS', 'Send skills'],
  'portalReport.sending': ['正在上报…', 'Sending…'],
  'portalReport.ok': ['已上报 {n} 条（丢弃 {d} 条超限）', 'Sent {n} item(s), {d} dropped over the cap'],
  'portalReport.badPat': ['PAT 无效或没有上报权限。', 'The PAT is invalid or lacks permission.'],
  'portalReport.tooBig': ['内容过大，已在本机截断，请重试。', 'Too large; trimmed locally, please retry.'],
  'portalReport.rateLimited': ['请求太频繁，稍后再试。', 'Too many requests, try again later.'],
  'portalReport.server': ['门户暂时不可用，稍后再试。', 'The portal is unavailable; try again later.'],
  'portalReport.failed': ['上报失败，请重试。', 'Report failed, please retry.'],
  'portalReport.offline': ['没有网络，稍后再试。', 'No network; try again later.'],
});
