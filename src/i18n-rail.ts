import { registerTranslations } from './i18n';

// 设置 → 外观:「折叠屏 / 平板左侧导航」的形态。显式键名(不吃 settings.copy.N 的位置编号)。
registerTranslations({
  'railForm.title': ['折叠屏 / 平板左侧导航', 'Rail on foldables and tablets'],
  'railForm.hint': ['纯图标与桌面端一致（长按看名字）；也可以保留文字标签。', 'Icons only matches the desktop rail (long-press shows the name); or keep the labels.'],
  'railForm.icons': ['纯图标', 'Icons only'],
  'railForm.labels': ['图标 + 文字', 'Icons + labels'],
});
