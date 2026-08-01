// 纯逻辑单测(bun/node 可跑·无 RN 依赖)。run: bun src/lib/avatar-resolve.test.ts
// R1 avatar 解析链回归(通信龙 07-31 验收:双向 + 同一份数据里的正向对照)。
import { planAvatarFile, poolFileNameForAlias, poolIndexForAlias, POOL_SIZE, KNOWN_BUNDLED_FILES } from './avatar-resolve';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };
const hub = (aliases: string[], map: Record<string, string> = {}) => ({ nodeAliases: new Set(aliases), map });

// 一份数据同时含 node-backed 和 session-only —— 满足"正向对照":两条腿都在同一测里
const NODE = 'grok测试7';   // 有 nodes 行
const SESS = '临时会话马';   // 纯会话(无 nodes 行)
const POOL_OF = (a: string) => `file:${poolFileNameForAlias(a)}`;

// ── 方向 A:node-backed 出 hub 图 ──────────────────────────────────────────────
ck('A1 node-backed + hub 绝对URL → remote', planAvatarFile(NODE, hub([NODE], { [NODE]: 'https://cdn.x/a.png' })) === 'remote:https://cdn.x/a.png');
ck('A2 node-backed + hub 相对池图 → 该文件(不是 alias 的池位)', planAvatarFile(NODE, hub([NODE], { [NODE]: '/avatars/avatar-09.webp' })) === 'file:avatar-09.webp');
ck('A3 相对URL带query/hash → 取 basename', planAvatarFile(NODE, hub([NODE], { [NODE]: '/avatars/avatar-03.webp?v=2#x' })) === 'file:avatar-03.webp');
ck('A4 http 大小写不敏感', planAvatarFile(NODE, hub([NODE], { [NODE]: 'HTTPS://cdn/x.png' })) === 'remote:HTTPS://cdn/x.png');

// ── 方向 B(🔴 正向对照):session-only 仍出池图 —— 删掉池层这条必挂 ─────────────
ck('B1 session-only(无 nodes 行)→ djb2 池图', planAvatarFile(SESS, hub([NODE], { [NODE]: 'https://cdn/x.png' })) === POOL_OF(SESS));
ck('B2 session-only 命名覆盖 → 命名文件', planAvatarFile('通信N站马', hub([])) === 'file:intern_avatar.png');
ck('B3 session-only 普通别名 → 池图(稳定)', planAvatarFile('随便一个马', hub([])) === POOL_OF('随便一个马'));

// ── 🔴 清空一致性:node-backed 的 avatar_url 为 null(不在 map)→ 走设计默认链,不复活 ──
// App 无本地层:planAvatarFile 根本不接受 local 覆盖入参 → 结构上不可能复活旧图。
ck('C1 node-backed 已清空(在 nodeAliases·不在 map)→ 设计默认池图', planAvatarFile(NODE, hub([NODE], {})) === POOL_OF(NODE));
ck('C2 清空后与"从没设过"同图(池位一致·无缓存差异)', planAvatarFile(NODE, hub([NODE], {})) === planAvatarFile(NODE, hub([NODE])));
ck('C3 node-backed 命名覆盖 + 已清空 → 命名文件(设计默认含命名层)', planAvatarFile('通信N站马', hub(['通信N站马'], {})) === 'file:intern_avatar.png');

// ── set-but-unresolvable:node-backed 设了个 App 没打包的相对文件 → none(=pill·对齐网页 404) ──
ck('D1 node-backed 相对但未打包文件 → none(pill·不静默降级到池)', planAvatarFile(NODE, hub([NODE], { [NODE]: '/avatars/unknown-99.webp' })) === 'none');
ck('D2 node-backed 相对空串 → 视为清空 → 设计默认', planAvatarFile(NODE, hub([NODE], { [NODE]: '   ' })) === POOL_OF(NODE));

// ── 健壮 + djb2 契约 ──────────────────────────────────────────────────────────
ck('E1 空 alias → none', planAvatarFile('', hub([])) === 'none' && planAvatarFile(null, hub([])) === 'none' && planAvatarFile(undefined, hub([])) === 'none');
ck('E2 POOL_SIZE=20 且 KNOWN_BUNDLED_FILES 含全部池图+命名', POOL_SIZE === 20 && KNOWN_BUNDLED_FILES.has('avatar-20.webp') && KNOWN_BUNDLED_FILES.has('avatar-01.webp') && KNOWN_BUNDLED_FILES.has('intern_avatar.png'));
ck('E3 poolIndexForAlias 稳定 in [0,20)·同 alias 同值', (() => { const i = poolIndexForAlias(SESS); return i === poolIndexForAlias(SESS) && i >= 0 && i < 20; })());
ck('E4 poolFileNameForAlias 形如 avatar-NN.webp', /^avatar-\d{2}\.webp$/.test(poolFileNameForAlias(SESS)));
ck('E5 djb2 ≠ 恒定(不同 alias 能分到不同池位)', new Set(['a', 'bb', 'ccc', '马', 'grok'].map(poolIndexForAlias)).size > 1);

console.log(`\n${p}/${t} passed`);
if (p !== t) { if (typeof process !== 'undefined') process.exit(1); }
