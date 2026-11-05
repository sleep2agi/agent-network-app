// 「复制诊断信息」的一行文本:版本 / 平台 / 更新渠道 / 更新状态 / 服务器(已脱敏)。
// 文案放在纯 .ts 里:UI 守卫只扫 .tsx,而这里的标签走 settingsText 复用已有翻译键。
// **绝不包含 token、账号、完整 Hub 地址**。
import { settingsText } from './i18n-settings';

export function diagnosticsLine(input: {
  version: string;
  platform: string;
  source?: string;
  updateKind: string;
  maskedHost: string;
}): string {
  const src = input.source === 'mirror' ? settingsText('国内镜像')
    : input.source === 'github' ? 'GitHub' : settingsText('未知');
  return [
    `v${input.version}`,
    input.platform,
    `${settingsText('更新渠道：')}${src}`,
    `${settingsText('更新状态：')}${input.updateKind}`,
    `${settingsText('服务器：')}${input.maskedHost}`,
  ].join(' · ');
}
