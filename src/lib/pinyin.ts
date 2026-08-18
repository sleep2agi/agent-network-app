// 拼音匹配 —— 移植自 web `dash-loop-wt/app/lib/pinyin-match.ts`(Loop R25)。
//
// 为什么移植而不是自己写一套:搜索语义分叉是**用户可感知**的坏 —— 同一个人
// 在网页上搜得到、在手机上搜不到,他不会觉得"这是两套实现",只会觉得
// "手机版搜索是坏的"。所以匹配规则必须和 web 同一套:
//     子串 OR 全拼 OR 首字母(全部小写、忽略大小写)
//
// 与 web 的唯一差异是**加载方式**,不是匹配语义:
//   web  : `import('pinyin-pro')` 动态 chunk + useSyncExternalStore 订阅就绪
//   RN   : Metro 没有真正的 code splitting,动态 import 一样会进 bundle。
//          这里改用**首次匹配时惰性 require**,把 564KB 字典挡在冷启动之外;
//          require 是同步的,所以不需要 web 那套"字典到了再刷新"的订阅机制。
//
// 真包行为已实测(pinyin-pro 3.28.2),用的是本军团真实别名:
//   支付助手   → 全拼 zhifuzhushou / 首字母 zfzs   → 'zf' 命中 ✓
//   通信测试马 → 全拼 tongxinceshima / 首字母 txcsm → 'txcs' 命中 ✓
//   N站牛     → 全拼 nzhanniu / 首字母 nzn(中英混合别名也正常)

type PinyinPair = [full: string, initials: string];
export type PinyinProvider = (text: string) => PinyinPair;

let provider: PinyinProvider | null = null;
let loadFailed = false;
const cache = new Map<string, PinyinPair>();

/**
 * 测试注入点:避免单测依赖 564KB 字典包。生产路径不调用它。
 *
 * 🔴 `disableAutoLoad` 是给「降级分支」那条测试用的。没有它时,
 * `__setPinyinProvider(null)` 只是清掉 provider,`ensureProvider()` 随后仍会去
 * `require('pinyin-pro')` —— 于是那条测试**能不能过,取决于那个包在当前环境里
 * 装没装**:
 *
 *     bun             （auto-install 会把它拉进来)→ require 成功 → 降级分支进不去 → 断言红
 *     bun --no-install                            → require 失败 → 降级分支 → 断言绿
 *     CI（npm ci 装了真依赖)                       → require 成功 → 断言红
 *
 * 也就是说:那条测试原本**只在「依赖恰好不存在」的机器上才通过**,而它测的偏偏是
 * 「依赖不存在时怎么办」。传 `disableAutoLoad: true` 之后,降级分支由测试**直接钉住**,
 * 与环境里装没装那个包无关。
 */
export function __setPinyinProvider(
  p: PinyinProvider | null,
  opts: { disableAutoLoad?: boolean } = {},
): void {
  provider = p;
  loadFailed = opts.disableAutoLoad === true;
  cache.clear();
}

function ensureProvider(): PinyinProvider | null {
  if (provider) return provider;
  if (loadFailed) return null;
  try {
    // 惰性 require:只有真的搜了一次才把字典拉进内存。
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const m = require('pinyin-pro');
    provider = (text: string) => [
      m.pinyin(text, { toneType: 'none', type: 'array' }).join('').toLowerCase(),
      m.pinyin(text, { pattern: 'first', toneType: 'none', type: 'array' }).join('').toLowerCase(),
    ];
    return provider;
  } catch {
    // 字典缺失时**降级为子串匹配**,而不是让搜索整个坏掉。
    loadFailed = true;
    return null;
  }
}

/**
 * 与 web 同一套判定:子串 OR 全拼 OR 首字母。
 * 空 filter 一律返回 true(调用方据此显示全量)。
 */
export function pinyinMatch(text: string, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  if (!f) return true;
  if (!text) return false;
  if (text.toLowerCase().includes(f)) return true;
  const p = ensureProvider();
  if (!p) return false;
  let entry = cache.get(text);
  if (!entry) {
    entry = p(text);
    cache.set(text, entry);
  }
  return entry[0].includes(f) || entry[1].includes(f);
}
