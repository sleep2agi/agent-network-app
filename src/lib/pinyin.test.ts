// 拼音匹配断言 — run: bun src/lib/pinyin.test.ts
//
// 两层证据:
//   1) 这里用**注入的 provider** 验匹配语义(不依赖 564KB 字典包)
//   2) 真包 pinyin-pro@3.28.2 的实际输出已单独实测过,注入的这份就是照它写的:
//      支付助手 → zhifuzhushou / zfzs;通信测试马 → tongxinceshima / txcsm;
//      N站牛 → nzhanniu / nzn
//   只做 (1) 会验到一个自己编的拼音表;只做 (2) 又没法钉住降级/缓存/空串这些分支。

import { pinyinMatch, __setPinyinProvider } from './pinyin';
import { buildSections, countShown } from '../agents-list';
import type { Session } from '../api';

let pass = 0, total = 0;
const ck = (n: string, c: boolean, extra = '') => {
  total++;
  if (c) { pass++; console.log('✅', n); } else console.log('❌', n, extra);
};

// 真包实测值(见文件头),照抄进注入表
const TABLE: Record<string, [string, string]> = {
  '支付助手': ['zhifuzhushou', 'zfzs'],
  '通信测试马': ['tongxinceshima', 'txcsm'],
  '通信龙': ['tongxinlong', 'txl'],
  '工程马': ['gongchengma', 'gcm'],
  'N站牛': ['nzhanniu', 'nzn'],
};
__setPinyinProvider(t => TABLE[t] ?? ['', '']);

// ── 与 web 同一套的三条判定 ──────────────────────────────────
ck('首字母命中:zf → 支付助手(通信龙点名的验收例)', pinyinMatch('支付助手', 'zf'));
ck('全拼命中:zhifu → 支付助手', pinyinMatch('支付助手', 'zhifu'));
ck('全拼完整命中:zhifuzhushou → 支付助手', pinyinMatch('支付助手', 'zhifuzhushou'));
ck('子串命中(不经字典):支付 → 支付助手', pinyinMatch('支付助手', '支付'));
ck('大小写不敏感:ZF → 支付助手', pinyinMatch('支付助手', 'ZF'));
ck('首尾空格被裁剪:"  zf  " → 支付助手', pinyinMatch('支付助手', '  zf  '));
ck('中英混合别名:nzn → N站牛', pinyinMatch('N站牛', 'nzn'));
ck('英文段子串:站 → N站牛', pinyinMatch('N站牛', '站'));

// ── 负向:不该命中的必须不命中 ───────────────────────────────
ck('负向:zf 不命中 通信龙', !pinyinMatch('通信龙', 'zf'));
ck('负向:txl 不命中 支付助手', !pinyinMatch('支付助手', 'txl'));
ck('负向:乱码不命中任何人', !pinyinMatch('支付助手', 'qqqzzz'));
ck('空 filter 返回 true(调用方据此显示全量)', pinyinMatch('支付助手', ''));
ck('空 text 不命中非空 filter', !pinyinMatch('', 'zf'));

// ── 降级:字典不可用时退化为子串,而不是搜索整个坏掉 ──────────
{
  // 🔴 必须显式关掉 auto-load,不能靠「这台机器上恰好没装 pinyin-pro」。
  // 原来这里只写 __setPinyinProvider(null),于是 ensureProvider() 仍会去 require,
  // 在装了依赖的环境(CI、或 bun 的 auto-install)下降级分支根本进不去,这条断言必红。
  // 实测:`bun` → 20/21;`bun --no-install` → 21/21 —— 同一份代码,只差环境。
  __setPinyinProvider(null, { disableAutoLoad: true });
  ck('降级:无字典时子串仍可用', pinyinMatch('支付助手', '支付'));
  ck('降级:无字典时拼音不再命中(诚实失效,不假装)', !pinyinMatch('支付助手', 'zf'));
  __setPinyinProvider(t => TABLE[t] ?? ['', '']);
}

// ── 接进列表:报分母,拒绝退化绿 ─────────────────────────────
{
  const S = (alias: string, status = 'idle'): Session => ({ alias, status } as Session);
  const fleet = [S('支付助手'), S('通信测试马'), S('通信龙'), S('工程马'), S('N站牛')];

  const hit = buildSections(fleet, 'zf', { match: pinyinMatch });
  const n = countShown(hit);
  ck('拼音搜 zf:命中 >0 且 <总数(不是全中/全不中)', n > 0 && n < fleet.length, `命中 ${n}/${fleet.length}`);
  ck('拼音搜 zf:命中的就是支付助手',
    hit.flatMap(g => g.data).map(s => s.alias).join(',') === '支付助手');

  const tx = countShown(buildSections(fleet, 'tx', { match: pinyinMatch }));
  ck('拼音搜 tx:命中通信两人(>0 且 <总数)', tx === 2, `命中 ${tx}/${fleet.length}`);

  const none = buildSections(fleet, 'zzzz', { match: pinyinMatch });
  ck('搜不到时 0 条(调用方必须据此显示空态而不是空白)', countShown(none) === 0);

  const cleared = buildSections(fleet, '', { match: pinyinMatch });
  ck('清空查询完全复原', countShown(cleared) === fleet.length, `${countShown(cleared)}/${fleet.length}`);

  // 反证:默认子串匹配器搜 zf 是 0 —— 证明上面的命中确实来自拼音而非子串
  ck('反证:不注入拼音时 zf 命中 0(上面的命中真的来自拼音)',
    countShown(buildSections(fleet, 'zf')) === 0);
}

console.log(`\n${pass}/${total} passed`);
if (pass !== total) process.exit(1);
