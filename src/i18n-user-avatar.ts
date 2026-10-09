import { registerTranslations } from './i18n';
registerTranslations({
  'userAvatar.title': ['我的头像', 'My avatar'],
  'userAvatar.hint': ['仅修改当前 Hub 的本人头像，不会修改 Agent 头像。', 'Changes your profile on this Hub, not an Agent avatar.'],
  'userAvatar.remote': ['外部图片地址会向图片网站发送请求。相册上传暂未提供。', 'External images send requests to their host. Photo upload is not available yet.'],
  'userAvatar.url': ['图片网址（HTTP/HTTPS）', 'Image URL (HTTP/HTTPS)'],
  'userAvatar.save': ['保存图片网址', 'Save image URL'],
  'userAvatar.reset': ['恢复默认头像', 'Restore default avatar'],
  'userAvatar.saved': ['已保存到 Hub', 'Saved to Hub'],
  'userAvatar.busy': ['正在保存…', 'Saving…'],
  'userAvatar.loading': ['正在读取头像…', 'Loading avatar…'],
  'userAvatar.retry': ['重新读取', 'Retry'],
  'userAvatar.failed': ['暂时无法确认头像，请重试。未覆盖当前显示。', 'Could not confirm the avatar. Retry; the current display has been retained.'],
  'userAvatar.unsupported': ['此 Hub 尚不支持用户头像，请升级 Hub。', 'This Hub does not support user avatars yet. Upgrade the Hub.'],
  'userAvatar.invalid': ['请输入有效的 HTTP/HTTPS 图片网址，不支持本地文件或数据地址。', 'Enter a valid HTTP/HTTPS image URL, not a local file or data URL.'],
  'userAvatar.pick': ['选择头像 {n}', 'Choose avatar {n}'],
});
