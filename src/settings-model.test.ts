// 0.2.83 设置页「左栏分类 + 右栏行式选项 + 搜索」的纯模型。
import { readFileSync } from 'fs';
import { SETTINGS_CATEGORIES, activeCategoryKey, filterSettings, rowMatches, visibleRowKeys } from './settings-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}`); };
const norm = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf-8').replace(/\r\n?/g, '\n');

// —— 结构:每类非空、键不重复、图标都给了 ——
{
  const keys = SETTINGS_CATEGORIES.map((c) => c.key);
  ck('分类键不重复', new Set(keys).size === keys.length);
  ck('每个分类至少一行', SETTINGS_CATEGORIES.every((c) => c.rows.length > 0));
  ck('每个分类都有图标名', SETTINGS_CATEGORIES.every((c) => typeof c.icon === 'string' && c.icon.length > 0));
  for (const c of SETTINGS_CATEGORIES) {
    const rk = c.rows.map((r) => r.key);
    ck(`「${c.label}」行键不重复`, new Set(rk).size === rk.length);
  }
  ck('本地 Hub 是条件分类(没装本地工作区就不出现)', SETTINGS_CATEGORIES.find((c) => c.key === 'localHub')?.conditional === true);
}

// —— 搜索:按标签与关键词,跨分类 ——
{
  const all = filterSettings('', { localHub: true });
  ck('空查询 = 全部分类', all.length === SETTINGS_CATEGORIES.length);
  const noLocal = filterSettings('', {});
  ck('本地 Hub 未装 → 该类不出现', !noLocal.some((c) => c.key === 'localHub'));

  const r = filterSettings('提示音', { localHub: true });
  ck('搜「提示音」只剩通知类', r.length === 1 && r[0].key === 'notifications');
  ck('且只剩那一行', r[0].rows.length === 1 && r[0].rows[0].key === 'sound');

  const kw = filterSettings('dark', { localHub: true });
  ck('英文关键词也能搜到主题', kw.length === 1 && kw[0].key === 'appearance' && kw[0].rows[0].key === 'theme');

  const multi = filterSettings('版本', { localHub: true });
  ck('「版本」跨两个分类命中(本地 Hub 版本 + 关于·版本)', multi.map((c) => c.key).sort().join(',') === 'about,localHub');

  ck('大小写/首尾空格不影响', filterSettings('  UPDATE ', {}).some((c) => c.key === 'about'));
  ck('没命中 → 空数组', filterSettings('这个词肯定没有', { localHub: true }).length === 0);
  ck('rowMatches 空查询恒真', rowMatches({ key: 'x', label: 'y' }, ''));
}

// —— 可见行键与选中分类的切换 ——
{
  ck('不在搜索时 visibleRowKeys 为 null(全显示)', visibleRowKeys('', filterSettings('', {})) === null);
  const f = filterSettings('提示音', { localHub: true });
  const keys = visibleRowKeys('提示音', f);
  ck('搜索中 visibleRowKeys 只含命中行', keys !== null && keys.size === 1 && keys.has('notifications.sound'));

  ck('当前分类仍有命中 → 保持', activeCategoryKey('notifications', f) === 'notifications');
  ck('当前分类没命中 → 切到第一个有命中的', activeCategoryKey('account', f) === 'notifications');
  ck('什么都没命中 → 保持原选中', activeCategoryKey('about', []) === 'about');
}

// —— 契约:SettingsScreen 真的用了这套模型 + 两栏布局 ——
{
  const src = norm('./SettingsScreen.tsx');
  ck('SettingsScreen 从模型取分类与筛选', src.includes("from './settings-model'") && src.includes('filterSettings('));
  ck('左栏(分类列表)', src.includes('testID="settings-sidebar"'));
  ck('右栏(内容面板)', src.includes('testID="settings-pane"'));
  ck('搜索框', src.includes('accessibilityLabel="搜索设置"'));
  ck('关闭按钮(仅传了 onClose 时)', src.includes('accessibilityLabel="关闭设置"'));
  ck('分类按钮按模型渲染', src.includes('accessibilityLabel={`设置分类 ${cat.label}`}'));
  ck('右栏标题 = 当前分类名', src.includes('<Text style={styles.paneTitle}>'));
  ck('删除本地工作区放在单独的危险区', src.includes('testID="settings-danger-zone"'));
  ck('提示音 / 免打扰用真正的开关', src.includes('<Switch'));
}

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
