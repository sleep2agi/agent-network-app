import { registerTranslations } from './i18n';
registerTranslations({
  'tags.title': ['标签', 'Tags'],
  'tags.input': ['输入标签，回车创建', 'Enter a tag, press Enter to create'],
  'tags.add': ['添加', 'Add'],
  'tags.remove': ['移除标签 {tag}', 'Remove tag {tag}'],
  'tags.invalid': ['最多 10 个标签，每个 1–20 字，不含控制字符。', 'Use up to 10 tags, each 1–20 characters without control characters.'],
  'tags.failed': ['标签未保存，请重试。', 'Tags were not saved. Please retry.'],
  'tags.loadingFailed': ['已有标签加载失败，可继续输入新标签。', 'Could not load existing tags. You can still enter a tag.'],
  'tags.unsupported': ['升级 Hub 后可编辑标签。', 'Upgrade the Hub to edit tags.'],
  'tags.all': ['全部标签', 'All tags'],
  'tags.saving': ['正在保存…', 'Saving…'],
});
