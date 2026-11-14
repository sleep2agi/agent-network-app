import { registerTranslations } from './i18n';

export const aboutTranslations = {
  'about.tagline': ['企业级多 Agent 协作网络', 'Enterprise multi-agent network'],
  'about.groupUpdates': ['更新', 'Updates'],
  'about.groupSupport': ['帮助与支持', 'Help & support'],
  'about.groupTroubleshoot': ['排障', 'Troubleshooting'],
  'about.copied': ['已复制', 'Copied'],
  'about.diagnosticsHint': ['反馈问题时贴给我们；不含令牌、账号和完整地址', 'Paste this when reporting a problem; no tokens, accounts or full addresses'],
  'about.versionA11y': ['版本 {version}', 'Version {version}'],
  'about.footer': ['© 2026 ANet · anet.sh', '© 2026 ANet · anet.sh'],
} as const;

registerTranslations(aboutTranslations);
