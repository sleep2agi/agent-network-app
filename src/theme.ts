// ── #545 强调色方案(Vincent 2026-10-04「感觉这个 绿色是真的丑」)─────────────────────────────
// 「我发出的气泡」「发送」「主按钮」「恢复默认」这类次按钮、选中态、开关、链接……全 app 的强调色一族
// 只从这里来。换一套 = 改下面 ACCENT_SCHEME 一行;每套都带浅色 / 深色两份,且都过 WCAG AA
// (src/theme-accent-schemes.test.ts 逐套逐对断言)。
//   accent           强调色:主按钮底、链接 / 文字按钮、选中勾、开关、焦点线(作文字时在 bg/card/tonalBg 上 ≥ 4.5)
//   onAccent         主按钮上的字 / 图标(在 accent 上 ≥ 4.5)
//   tonalBg          次按钮(tonal)的浅底,字用 accent
//   railActiveBg     导航栏 / 分段控件的选中底
//   bubbleMine       我发出的聊天气泡底
//   onBubbleMine     我发出的气泡里的字(≥ 4.5)
//   linkOnBubbleMine 我发出的气泡里的链接 / 行内强调(≥ 4.5)
type AccentTokens = {
  accent: string; onAccent: string; tonalBg: string; railActiveBg: string;
  bubbleMine: string; onBubbleMine: string; linkOnBubbleMine: string;
};
export type AccentSchemeId = 'teal' | 'wechat' | 'blue' | 'graphite';
export const ACCENT_SCHEMES: Record<AccentSchemeId, { light: AccentTokens; dark: AccentTokens }> = {
  // 0.2.204 及以前:墨青。气泡是中性灰(与 rowActive 同值),只有按钮 / 链接是青。
  teal: {
    light: { accent: '#067a86', onAccent: '#ffffff', tonalBg: '#eaf5f6', railActiveBg: '#dcedf0', bubbleMine: '#e9ebee', onBubbleMine: '#1d2026', linkOnBubbleMine: '#067a86' },
    dark: { accent: '#4cc3d6', onAccent: '#0b0b0d', tonalBg: '#17313a', railActiveBg: '#15282c', bubbleMine: '#222227', onBubbleMine: '#ededef', linkOnBubbleMine: '#4cc3d6' },
  },
  // A 微信绿:气泡就是微信的 #95EC69 + 深色字;按钮用更深一档的绿(微信的 #07C160 配白字只有 2.4:1,不过 AA)。
  wechat: {
    light: { accent: '#07803c', onAccent: '#ffffff', tonalBg: '#eef8f1', railActiveBg: '#e9f6ed', bubbleMine: '#95ec69', onBubbleMine: '#111111', linkOnBubbleMine: '#111111' },
    dark: { accent: '#3eb575', onAccent: '#0b0b0d', tonalBg: '#173226', railActiveBg: '#142a1f', bubbleMine: '#3eb575', onBubbleMine: '#0b0b0d', linkOnBubbleMine: '#0b0b0d' },
  },
  // B 晴蓝(iMessage / Telegram 一类):实底蓝气泡 + 白字。
  blue: {
    light: { accent: '#1b65db', onAccent: '#ffffff', tonalBg: '#edf3fe', railActiveBg: '#e6eefd', bubbleMine: '#1b65db', onBubbleMine: '#ffffff', linkOnBubbleMine: '#ffffff' },
    dark: { accent: '#5e9bff', onAccent: '#0b0b0d', tonalBg: '#172a48', railActiveBg: '#15243b', bubbleMine: '#2563d9', onBubbleMine: '#ffffff', linkOnBubbleMine: '#ffffff' },
  },
  // C 石墨(中性):不用彩色,主按钮是墨黑 / 深色下是浅灰,气泡是中性灰 —— 让内容和状态色(绿/红/黄)说话。
  graphite: {
    light: { accent: '#27272a', onAccent: '#ffffff', tonalBg: '#eceef1', railActiveBg: '#e3e5e9', bubbleMine: '#e3e5e9', onBubbleMine: '#1d2026', linkOnBubbleMine: '#1d2026' },
    dark: { accent: '#e4e4e7', onAccent: '#111113', tonalBg: '#26262b', railActiveBg: '#232328', bubbleMine: '#2c2c31', onBubbleMine: '#ededef', linkOnBubbleMine: '#ededef' },
  },
};
/** 🔴 换强调色只改这一行。 */
export const ACCENT_SCHEME: AccentSchemeId = 'blue';
const ACCENT = ACCENT_SCHEMES[ACCENT_SCHEME];
/** 永远画在深色底上的强调(语音浮层的电平条):不随浅 / 深主题变。 */
export const ACCENT_ON_DARK = ACCENT.dark.accent;

/** '#rrggbb' 线性混合:t=0 → a,t=1 → b。热力图等「强调色的几档深浅」由它从 accent 推出来,不另写死色值。 */
export const mixHex = (a: string, b: string, t: number): string => {
  const ch = (h: string, i: number) => Number.parseInt(h.replace('#', '').slice(i, i + 2), 16);
  return '#' + [0, 2, 4].map(i => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t).toString(16).padStart(2, '0')).join('');
};

// Design tokens lifted from the dashboard's #217 design language:
// neutral near-black surfaces, restrained color, semantic status triad.
// 极简(2026-09-24):地面从近黑抬到 #111113,卡片只比地面亮一档;边框只用来分区,不用来包每个元素。
const DARK = {
  bg: '#111113',
  card: '#18181b',
  border: '#242428',
  inputBg: '#151518',
  text: '#ededef',
  textSecondary: '#a1a1aa',
  // 旧 #52525b 在近黑地面上对比 2.6:1,时间戳/提示几乎看不见;抬到在所有深色面上 ≥4.5:1。
  textMuted: '#8b8b95',
  broadcast: '#a78bfa',
  running: '#22c55e',
  failed: '#ef4444',
  blocked: '#f59e0b',
  rest: '#71717a',
  // 列表行:平铺不成卡片;悬停/选中各一档中性底色(不再用阴影和强调色)。
  listBg: '#111113',
  rowHover: '#1b1b1f',
  rowActive: '#222227',
  // 引用、分隔等「次要结构」统一用这一档,不另起一套灰。
  subtleFill: '#1e1e22',
  // 桌面左侧导航栏(rail):比会话列表再深一档;激活态用弱化的 accent 底色。
  railBg: '#0d0d0f',
  railHover: '#1a1a1e',
  railTooltipBg: '#27272a',
  railTooltipText: '#f4f4f5',
  // 手机「设置」分组列表(照微信):地面一档、行一档、按下再一档。深色是同一结构的深色版,不是反色。
  groupedBg: '#111113',
  groupedRow: '#1c1c1f',
  groupedRowPressed: '#242428',
  // 手机「按住 说话」浮层(微信式):绿色语音气泡 + 底部弧形面板。深色用降一档亮度的绿(微信深色同理),字始终深色。
  voiceBubble: '#3eb575',
  onVoiceBubble: '#0b0b0d',
  voiceArc: '#2c2c30',
  // 手指离开中间区(在 ✕ / 文 上)时面板暗一档 —— 实色,不能用透明度(会透出下面的大条)。
  voiceArcDim: '#1c1c1f',
  voiceArcText: '#ededef',
  // 浮起的面(见 ELEVATION):深色下没有阴影可用,靠「亮一档的面 + 细边」把它从地面上分出来。
  floatingBg: '#1c1c20',
  floatingBorder: '#2e2e33',
  // 强调色一族(accent / onAccent / tonalBg / railActiveBg / bubbleMine …)由文件顶部的 ACCENT_SCHEME 统一给出。
  ...ACCENT.dark,
};

// 白色主题 (Vincent tg 811/812) — same restraint on white surfaces;
// accent/status use darker shades where needed for AA contrast on white.
const LIGHT: typeof DARK = {
  bg: '#f6f7f9',
  card: '#ffffff',
  border: '#e6e8ec',
  inputBg: '#f1f2f5',
  text: '#1d2026',
  textSecondary: '#5d6470',
  // 弱化文字在全部浅色面(含选中行)上 ≥4.5:1。
  textMuted: '#636a75',
  broadcast: '#7c3aed',
  running: '#15803d',
  failed: '#dc2626',
  blocked: '#d97706',
  rest: '#71717a',
  listBg: '#fafafb',
  rowHover: '#f1f3f5',
  rowActive: '#e9ebee',
  subtleFill: '#f0f1f3',
  railBg: '#eef0f3',
  railHover: '#e3e6ea',
  railTooltipBg: '#20242a',
  railTooltipText: '#f4f4f5',
  groupedBg: '#ededf0',
  groupedRow: '#ffffff',
  groupedRowPressed: '#e9eaee',
  voiceBubble: '#95ec69',
  onVoiceBubble: '#111111',
  voiceArc: '#f2f2f4',
  voiceArcDim: '#d4d4d8',
  voiceArcText: '#1d2026',
  floatingBg: '#ffffff',
  // 浅色下浮起的面靠阴影,不画边:透明边只为了与深色同尺寸(不让内容在切主题时挪 1px)。
  floatingBorder: 'transparent',
  ...ACCENT.light,
};

export type ThemeMode = 'dark' | 'light';
const PALETTES: Record<ThemeMode, typeof DARK> = { dark: DARK, light: LIGHT };

// ── 0.2.101「跟随系统」(Vincent 2026-09-26:「三个选项,浅色、深色,然后跟随系统」)──
//
// 两个概念,别混:
//  - **偏好** ThemePreference:用户在设置里选的那一项,'light' | 'dark' | 'system'。持久化的是它。
//  - **生效主题** ThemeMode:此刻真正画出来的调色板,只有 'light' | 'dark'。
// `themeMode()` 仍然只返回生效主题 —— 全仓几十处 `themeMode() === 'light'` 不用改。
// 偏好是 'system' 时,生效主题 = 系统当前配色(由 setSystemColorScheme 喂进来,
// 见 system-color-scheme.ts);偏好是 light/dark 时,系统怎么变都不影响。
export type ThemePreference = ThemeMode | 'system';
export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];
/** 新装(存储里没有任何值)默认跟随系统。已存 light/dark 的老用户原样保留。 */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';
/** 系统配色拿不到(null / 旧 WebView 没有 matchMedia)时的兜底 —— 与本 app 一直以来的默认一致。 */
export const FALLBACK_SYSTEM_MODE: ThemeMode = 'dark';

export const isThemePreference = (v: unknown): v is ThemePreference =>
  v === 'light' || v === 'dark' || v === 'system';

/**
 * 存储里的原始值 → 偏好。旧版本只会写 'light' / 'dark'(key 仍是 theme_mode_v1),原样沿用;
 * null / 空 / 不认识的值 = 从没选过 → 默认「跟随系统」。
 */
export const parseStoredThemePreference = (raw: unknown): ThemePreference =>
  isThemePreference(raw) ? raw : DEFAULT_THEME_PREFERENCE;

export const resolveThemeMode = (pref: ThemePreference, system: ThemeMode | null): ThemeMode =>
  pref === 'system' ? (system ?? FALLBACK_SYSTEM_MODE) : pref;

// Mutable singleton: module-level StyleSheets are rebuilt through
// onThemeChange, inline JSX reads pick the new values up on the keyed
// remount in App. Avoids threading a theme context through every file.
export const colors = { ...DARK };

let mode: ThemeMode = 'dark';
// 内存里的初始偏好就是新装默认;冷启动读到存储后由 setThemePreference 覆盖。
let preference: ThemePreference = DEFAULT_THEME_PREFERENCE;
let systemScheme: ThemeMode | null = null;
const listeners: Array<(m: ThemeMode) => void> = [];
const preferenceListeners: Array<() => void> = [];

export const themeMode = (): ThemeMode => mode;
export const themePreference = (): ThemePreference => preference;
/** 最近一次喂进来的系统配色;null = 还没读到 / 平台不提供。 */
export const systemColorScheme = (): ThemeMode | null => systemScheme;

const apply = (): void => {
  const next = resolveThemeMode(preference, systemScheme);
  if (next !== mode) {
    mode = next;
    // Mutate `colors` IN PLACE — never reassign it. Every module imported
    // the same `colors` object reference; Object.assign keeps that reference
    // valid so they all see the new palette. A reassignment (colors = ...)
    // would leave existing imports pointing at the stale object. Components
    // re-read these values on App's theme-keyed remount.
    Object.assign(colors, PALETTES[mode]);
    // 只在生效主题**真的变了**才通知:App 用 key={theme} 整棵重挂,系统事件重复发同一个值
    // (或「深色」→「跟随系统(当前深色)」)不能把用户正在看的界面白白重挂一遍。
    listeners.forEach(l => l(mode));
  }
  preferenceListeners.forEach(l => l());
};

/** 用户在设置里选了一项(或冷启动读到了存储)。 */
export const setThemePreference = (p: ThemePreference): void => {
  preference = isThemePreference(p) ? p : DEFAULT_THEME_PREFERENCE;
  apply();
};

/**
 * 喂入系统当前配色(Appearance / matchMedia 的读数与变化事件)。偏好是 'system' 才会改变
 * 生效主题;显式 light/dark 下只记下读数(设置页「跟随系统(当前:…)」用得到)。
 */
export const setSystemColorScheme = (s: string | null | undefined): void => {
  systemScheme = s === 'light' || s === 'dark' ? s : null;
  apply();
};

/**
 * 兼容旧调用点(夹具、旧代码):直接指定一个明确的主题 = 把偏好设成它。
 */
export const setThemeMode = (m: ThemeMode): void => setThemePreference(m);

export const onThemeChange = (l: (m: ThemeMode) => void): (() => void) => {
  listeners.push(l);
  return () => {
    const i = listeners.indexOf(l);
    if (i >= 0) listeners.splice(i, 1);
  };
};

/**
 * Re-run every onThemeChange listener without a palette change. ui-scale.ts calls this when the
 * 字体大小 / 界面密度 changes: the listeners are what rebuild module-level `makeStyles()`, and
 * the density lives in `spacing`, which those styles read. (Listeners receive the unchanged mode.)
 */
export const restyleAll = (): void => {
  listeners.forEach(l => l(mode));
};

/** 偏好或系统读数变了(生效主题不一定变)。设置页靠它刷新「跟随系统(当前:…)」。 */
export const onThemePreferenceChange = (l: () => void): (() => void) => {
  preferenceListeners.push(l);
  return () => {
    const i = preferenceListeners.indexOf(l);
    if (i >= 0) preferenceListeners.splice(i, 1);
  };
};

const MODE_LABEL: Record<ThemeMode, string> = { light: '浅色', dark: '深色' };
export const THEME_PREFERENCE_LABEL: Record<ThemePreference, string> = { light: '浅色', dark: '深色', system: '跟随系统' };

/** 设置页主题行的说明文字。跟随系统时写明当前生效的是哪个:「跟随系统（当前：深色）」。 */
export const themePreferenceSummary = (pref: ThemePreference, effective: ThemeMode): string =>
  pref === 'system' ? `跟随系统（当前：${MODE_LABEL[effective]}）` : THEME_PREFERENCE_LABEL[pref];

export const statusColor = (status: string, online: boolean): string => {
  if (!online) return colors.rest;
  switch (status) {
    case 'idle':
    case 'working':
    case 'running':
      return colors.running;
    case 'error':
    case 'failed':
      return colors.failed;
    case 'blocked':
      return colors.blocked;
    default:
      return colors.rest;
  }
};

/** Unscaled spacing scale. `spacing` below is this × the 界面密度 factor (src/ui-scale.ts). */
export const SPACING_BASE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
// Mutable like `colors`: ui-scale.ts rewrites it IN PLACE when the density changes and then
// runs restyleAll(), so every module-level makeStyles() picks up the new values.
export const spacing: { xs: number; sm: number; md: number; lg: number; xl: number } = { ...SPACING_BASE };

// 极简(2026-09-24):圆角、字号、字重各收成一套刻度。原来源码里散着 14 种圆角、14 种字号、
// 51 处 700 粗体——视觉上的「乱」主要来自这里,不是颜色。新代码只用这三组值。
//
// 圆角(2026-09-29 Vincent「感觉这个 UI 还是有点丑,改的现代一点?四个角圆角一点」):
// 按「它是什么」取值,不按像素挑。全仓 borderRadius 只许写这里的 token(src/radius-tokens.test.ts 门禁)。
//   surface  卡片 / 弹窗 / 抽屉 / 底部面板 / 面板 / 浮层              16
//   control  输入框 / 按钮 / 分段控件 / 搜索框 / 菜单                 12
//   thumb    聊天里的图片 / 视频缩略图                                12
//   item     嵌在面或控件**里面**的一格:分段选中块、侧栏/导航项、代码块、
//            表格、≤ 32 高的小图标按钮                               8
//   mark     极小件:键帽、≤ 24 的悬停底、细把手                       4
//   inline   一行文字里的标记(查找命中高亮)                          2
//   bubble   聊天气泡                                                 18
//   pill     chip / tag / badge / pill,以及所有圆:圆点、圆形按钮、单选圈。
//            999 由 RN 与 CSS 夹到短边一半,所以圆不用写 size / 2。     999
// sm / md / lg 是旧名,值跟着新档走(item / control / surface),留着让还在路上的分支照样编译。
export const radius = {
  inline: 2,
  mark: 4,
  item: 8,
  control: 12,
  thumb: 12,
  surface: 16,
  bubble: 18,
  pill: 999,
  sm: 8,
  md: 12,
  lg: 16,
} as const;

/**
 * 头像:圆。全 app(手机列表、桌面列表、聊天、选择器、头像池)同一个形状 —— 它跟 dashboard 的
 * AliasAvatar 对齐(见 AliasAvatar.tsx 的 circle mask),在线点也是按圆的右下角摆的。
 * 所以这里不做「圆角方块」:那会让 app 和 dashboard 的同一个头像长得不一样。
 */
export const avatarRadius = (_size: number): number => radius.pill;

/** 应用图标(登录页 logo 等):系统图标那种圆角方块,约 23%。 */
export const appIconRadius = (size: number): number => Math.round(size * 0.23);

// 浮起的面(菜单、浮层、抽屉、弹窗、灰底上的卡片)用一层很淡的阴影代替 1px 硬边框。
// 深色下阴影看不见 —— 改用比底色亮一档的面 + 一条细边(colors.floatingBorder)。
// 平台分支(web boxShadow / 原生 shadow* + elevation)在 src/elevation.ts;这里只放数值。
export const ELEVATION = {
  /** 灰底上的卡片、分组列表。 */
  raised: { web: '0 1px 2px rgba(16,24,40,0.05), 0 1px 3px rgba(16,24,40,0.06)', y: 1, blur: 3, opacity: 0.07, android: 1 },
  /** 菜单、浮层、抽屉、弹窗、toast。 */
  floating: { web: '0 10px 30px rgba(16,24,40,0.12), 0 2px 8px rgba(16,24,40,0.06)', y: 8, blur: 24, opacity: 0.14, android: 6 },
} as const;
export type ElevationLevel = keyof typeof ELEVATION;

/**
 * 按钮:一种主按钮(强调色实底)、一种次按钮(浅色 tonal 底)。高度随平台:手机 40、桌面 36 ——
 * 与 #424 的输入栏控件同高(composer-row-layout.ts COMPOSER_CONTROL_BASE = 40);桌面是鼠标,
 * 36 就够。左右内边距统一 16。平台判断在 src/elevation.ts 的 buttonStyle()。
 */
export const CONTROL_HEIGHT = { phone: 40, desktop: 36 } as const;
export const CONTROL_PAD_X = 16;
export const type = { caption: 11, small: 12, body: 14, title: 16, heading: 20 };
/** 最重只到 600:标题/名字用 600,正文 400,次要信息 400 + textSecondary。 */
export const weight = { regular: '400', medium: '500', strong: '600' } as const;
