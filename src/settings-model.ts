// 0.2.83(Vincent 2026-09-20「设置改为这种样式和交互吧」,参照 Claude 桌面端):设置页从
// 一整列卡片改成「左栏分类 + 右栏行式选项」。这里只放**纯模型**:有哪些分类、每类下有哪些
// 可搜索的行、搜索怎么筛。行的真正渲染(账号列表、本地 Hub 状态)是有状态的,留在
// SettingsScreen 里;这里只保证「搜"提示音"能找到通知那一类」这种事有单元测试。
//
// 🔴 只登记**真实存在**的设置。不要为了让左栏好看往里编分类。
// 纯逻辑,不 import react-native。

export type SettingsCategoryKey = 'account' | 'localHub' | 'appearance' | 'notifications' | 'about';

export type SettingsRow = {
  readonly key: string;
  /** 行左边的标签,也是搜索命中的依据。 */
  readonly label: string;
  /** 额外可搜的词(同义词 / 英文),不显示。 */
  readonly keywords?: readonly string[];
};

export type SettingsCategory = {
  readonly key: SettingsCategoryKey;
  readonly label: string;
  /** Ionicons 名。 */
  readonly icon: string;
  readonly rows: readonly SettingsRow[];
  /** 只在某些运行态才出现(本地 Hub 只有装了本地工作区才有)。 */
  readonly conditional?: boolean;
};

export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  {
    key: 'account',
    label: '账号',
    icon: 'person-circle-outline',
    rows: [
      { key: 'profiles', label: '账号与 Hub', keywords: ['登录', '服务器', 'profile', 'hub', 'account'] },
      { key: 'addAccount', label: '添加 Hub / 账号', keywords: ['添加', '登录', 'add'] },
      { key: 'logout', label: '移除当前账号', keywords: ['退出', '登出', 'logout'] },
    ],
  },
  {
    key: 'localHub',
    label: '本地 Hub',
    icon: 'server-outline',
    conditional: true,
    rows: [
      { key: 'status', label: '状态', keywords: ['运行', 'status'] },
      { key: 'endpoint', label: '地址', keywords: ['端口', 'url', 'endpoint'] },
      { key: 'hubVersion', label: 'Hub 版本', keywords: ['版本', 'version'] },
      { key: 'restart', label: '重新启动', keywords: ['重启', 'restart'] },
      { key: 'stop', label: '停止', keywords: ['stop'] },
      { key: 'logs', label: '打开日志', keywords: ['log'] },
      { key: 'backup', label: '立即备份', keywords: ['备份', 'backup'] },
      { key: 'deleteLocal', label: '删除本地工作区数据', keywords: ['删除', '清空', 'delete', 'reset'] },
    ],
  },
  {
    key: 'appearance',
    label: '外观',
    icon: 'color-palette-outline',
    rows: [
      { key: 'theme', label: '主题', keywords: ['深色', '浅色', '暗色', 'dark', 'light', 'theme'] },
    ],
  },
  {
    key: 'notifications',
    label: '通知',
    icon: 'notifications-outline',
    rows: [
      { key: 'sound', label: '消息提示音', keywords: ['声音', '铃声', 'sound', 'chime'] },
      { key: 'quiet', label: '免打扰时段', keywords: ['勿扰', '静音', 'quiet', 'dnd'] },
    ],
  },
  {
    key: 'about',
    label: '关于',
    icon: 'information-circle-outline',
    rows: [
      { key: 'version', label: '版本', keywords: ['version'] },
      { key: 'update', label: '软件更新', keywords: ['升级', '检查更新', 'update', 'upgrade'] },
    ],
  },
];

const normalize = (s: string) => s.trim().toLowerCase();

export function rowMatches(row: SettingsRow, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  if (normalize(row.label).includes(q)) return true;
  return (row.keywords ?? []).some((k) => normalize(k).includes(q));
}

/**
 * 按搜索词筛:返回仍有命中行的分类,每类只保留命中的行。空查询 = 原样全部。
 * `available` 控制 conditional 分类此刻在不在(本地 Hub 没装就整类不出现)。
 */
export function filterSettings(
  query: string,
  available: Partial<Record<SettingsCategoryKey, boolean>> = {},
  categories: readonly SettingsCategory[] = SETTINGS_CATEGORIES,
): SettingsCategory[] {
  const out: SettingsCategory[] = [];
  for (const cat of categories) {
    if (cat.conditional && available[cat.key] !== true) continue;
    const rows = cat.rows.filter((r) => rowMatches(r, query));
    if (rows.length) out.push({ ...cat, rows });
  }
  return out;
}

/** 搜索中 → 命中的行键集合(渲染时用它决定哪些行显示);不在搜索 → null(全显示)。 */
export function visibleRowKeys(query: string, filtered: readonly SettingsCategory[]): ReadonlySet<string> | null {
  if (!normalize(query)) return null;
  const keys = new Set<string>();
  for (const cat of filtered) for (const r of cat.rows) keys.add(`${cat.key}.${r.key}`);
  return keys;
}

/**
 * 当前选中的分类在筛选结果里没了(比如搜到别的类去了)→ 切到第一个有命中的;
 * 没有任何命中 → 保持原选中(右栏显示「没有匹配的设置」)。
 */
export function activeCategoryKey(
  current: SettingsCategoryKey,
  filtered: readonly SettingsCategory[],
): SettingsCategoryKey {
  if (filtered.some((c) => c.key === current)) return current;
  return filtered[0]?.key ?? current;
}
