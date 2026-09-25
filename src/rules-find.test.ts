// 规则文件查找/替换纯逻辑 — run: bun src/rules-find.test.ts
import {
  contentKey, FIND_MATCH_LIMIT, findCountLabel, findKeyAction, findMatches, foldForFind, isFindShortcut, isMacPlatform, isTruncated,
  joinSegments, matchAtOrAfter, matchLines, ordinalInGroup, pickCorresponding, piecesForMatch, replaceAll, replaceMatch,
  SEGMENT_BREAK, sourceKeysForBlock, stepMatch,
} from './rules-find';

let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) { pass++; console.log('✅', name); }
  else console.log('❌', name, extra);
};
const j = (v: unknown) => JSON.stringify(v);
const at = (text: string, q: string, cs = false) => findMatches(text, q, { caseSensitive: cs }).map((m) => [m.start, m.end]);

// ── 找匹配:偏移、大小写、CJK、字面 ──
ck('基本偏移', j(at('abc abc', 'bc')) === j([[1, 3], [5, 7]]), j(at('abc abc', 'bc')));
ck('默认不区分大小写', j(at('Hub hub HUB', 'hub')) === j([[0, 3], [4, 7], [8, 11]]));
ck('查找词大写也不区分', j(at('hub', 'HUB')) === j([[0, 3]]));
ck('区分大小写时只命中原样', j(at('Hub hub HUB', 'hub', true)) === j([[4, 7]]));
ck('中文:偏移是 UTF-16 下标', j(at('规则文件的规则', '规则')) === j([[0, 2], [5, 7]]));
ck('中英混排', j(at('## 身份 alias: TMA门户鲸2号', '门户鲸')) === j([[16, 19]]), j(at('## 身份 alias: TMA门户鲸2号', '门户鲸')));
ck('全角标点照常命中', j(at('（不经公司 HTTPS 代理）', '（不经')) === j([[0, 3]]));
ck('代理对(emoji)后面的偏移仍对得上 slice', (() => { const t = '🔴 复核纪律 复核'; return findMatches(t, '复核').every((m) => t.slice(m.start, m.end) === '复核') && findMatches(t, '复核').length === 2; })());
ck('正则特殊字符按字面:点', j(at('a.b axb', 'a.b')) === j([[0, 3]]));
ck('正则特殊字符按字面:星号括号', j(at('f(x)* f(x)', '(x)*')) === j([[1, 5]]));
ck('正则特殊字符按字面:反斜杠和 $', j(at('C:\\a $1 C:\\a', 'C:\\a')) === j([[0, 4], [8, 12]]));
ck('正则特殊字符按字面:[ ] ^ | ?', j(at('[x]^|? [x]', '[x]^|?')) === j([[0, 6]]));
ck('空查找词 ⇒ 0 处', findMatches('abc', '').length === 0);
ck('空文本 ⇒ 0 处', findMatches('', 'a').length === 0);
ck('不重叠:aaaa 里找 aa 是 2 处', j(at('aaaa', 'aa')) === j([[0, 2], [2, 4]]));
ck('不重叠:aaa 里找 aa 是 1 处', j(at('aaa', 'aa')) === j([[0, 2]]));
ck('找不到 ⇒ 0 处', findMatches('abc', 'z').length === 0);
ck('查找词比文本长 ⇒ 0 处', findMatches('ab', 'abc').length === 0);
ck('上限截断', findMatches('a'.repeat(50), 'a', { limit: 7 }).length === 7);
ck('默认上限 = FIND_MATCH_LIMIT', findMatches('a'.repeat(FIND_MATCH_LIMIT + 10), 'a').length === FIND_MATCH_LIMIT);
ck('isTruncated 在满上限时为真、差一个为假', isTruncated({ length: 7 }, 7) && !isTruncated({ length: 6 }, 7));

// ── 大小写折叠保持长度(偏移对得上原文) ──
ck('折叠后长度不变(普通)', foldForFind('AbC').length === 3 && foldForFind('AbC') === 'abc');
ck('折叠后长度不变(İ 这种 toLowerCase 会变长的字符原样保留)', foldForFind('İstanbul').length === 'İstanbul'.length, String(foldForFind('İstanbul').length));
ck('İ 之后的匹配偏移仍对原文', (() => { const t = 'İİ hub'; const m = findMatches(t, 'HUB')[0]; return !!m && t.slice(m.start, m.end) === 'hub'; })());
ck('中文不受折叠影响', foldForFind('规则ABC') === '规则abc');

// ── 上一个 / 下一个:绕回 ──
ck('下一个', stepMatch(0, 3, 1) === 1);
ck('下一个绕回', stepMatch(2, 3, 1) === 0);
ck('上一个', stepMatch(2, 3, -1) === 1);
ck('上一个绕回', stepMatch(0, 3, -1) === 2);
ck('0 处 ⇒ -1', stepMatch(0, 0, 1) === -1 && stepMatch(-1, 0, -1) === -1);
ck('当前无效时下一个从 0 起', stepMatch(-1, 4, 1) === 0);
ck('当前无效时上一个从末尾起', stepMatch(-1, 4, -1) === 3);
ck('当前越界(内容变短后)也按无效处理', stepMatch(9, 4, 1) === 0);
ck('只有 1 处时上下都停在 0', stepMatch(0, 1, 1) === 0 && stepMatch(0, 1, -1) === 0);

// ── 从某个偏移起找 ──
{
  const ms = findMatches('x a x a x', 'x');
  ck('matchAtOrAfter:正好在匹配起点', matchAtOrAfter(ms, 4) === 1);
  ck('matchAtOrAfter:在两处之间', matchAtOrAfter(ms, 5) === 2);
  ck('matchAtOrAfter:后面没有了绕回 0', matchAtOrAfter(ms, 99) === 0);
  ck('matchAtOrAfter:无匹配 ⇒ -1', matchAtOrAfter([], 0) === -1);
}

// ── 计数文案 ──
ck('计数 3/12', findCountLabel('x', 2, 12) === '3/12');
ck('无结果', findCountLabel('x', -1, 0) === '无结果');
ck('没输入 ⇒ 空', findCountLabel('', -1, 0) === '');
ck('截断时写 N+', findCountLabel('x', 0, 5000, true) === '1/5000+');

// ── 替换 ──
{
  const t = 'hub Hub HUB';
  const ms = findMatches(t, 'hub');
  const r = replaceMatch(t, ms, 1, '节点');
  ck('替换第 2 处', r?.text === 'hub 节点 HUB', r?.text);
  ck('替换后从替换段末尾继续', r?.resumeAt === 6, String(r?.resumeAt));
  ck('替换越界 ⇒ null', replaceMatch(t, ms, 5, 'x') === null);
  ck('匹配已过期(文本变短)⇒ null', replaceMatch('hu', ms, 2, 'x') === null);
  const again = replaceMatch('a', findMatches('a', 'a'), 0, 'aa');
  const nextIdx = again ? matchAtOrAfter(findMatches(again.text, 'a'), again.resumeAt) : -2;
  ck('替换成含查找词的串:下一处不是刚替换进去的那段(绕回也不死循环)', again?.text === 'aa' && nextIdx === 0 && again.resumeAt === 2, j({ again, nextIdx }));
}
ck('全部替换(不区分大小写)', j(replaceAll('hub Hub HUB x', 'hub', 'node')) === j({ text: 'node node node x', count: 3 }));
ck('全部替换(区分大小写)', j(replaceAll('hub Hub HUB', 'Hub', 'node', { caseSensitive: true })) === j({ text: 'hub node HUB', count: 1 }));
ck('全部替换:替换成含查找词的串只扫一遍', j(replaceAll('a-a', 'a', 'aa')) === j({ text: 'aa-aa', count: 2 }));
ck('全部替换:空查找词什么都不改', j(replaceAll('abc', '', 'x')) === j({ text: 'abc', count: 0 }));
ck('全部替换:替换成空串 = 删除', j(replaceAll('规则a规则', '规则', '')) === j({ text: 'a', count: 2 }));
ck('全部替换:正则字符按字面,$& 不展开', j(replaceAll('a.b a.b', 'a.b', '$&$1')) === j({ text: '$&$1 $&$1', count: 2 }));
ck('全部替换:不受上限截断', replaceAll('a'.repeat(FIND_MATCH_LIMIT + 3), 'a', 'b').count === FIND_MATCH_LIMIT + 3);
ck('全部替换:CJK 重叠词不重叠', j(replaceAll('哈哈哈', '哈哈', '笑')) === j({ text: '笑哈', count: 1 }));

// ── 阅读区:文本节点拼接与切分 ──
{
  const A = {}, B = {};
  const segs = [{ text: '上级', group: A }, { text: '授权', group: A }, { text: '规则', group: B }];
  const { text, starts } = joinSegments(segs);
  ck('同段直接拼,异段插分隔符', text === `上级授权${SEGMENT_BREAK}规则` && j(starts) === j([0, 2, 5]), j({ text, starts }));
  const ms = findMatches(text, '级授');
  ck('同段跨节点的词能找到', ms.length === 1);
  ck('跨节点切成两片', j(piecesForMatch(starts, [2, 2, 2], ms[0])) === j([{ segment: 0, start: 1, end: 2 }, { segment: 1, start: 0, end: 1 }]));
  ck('异段之间不会拼出假命中', findMatches(text, '授权规则').length === 0);
  ck('只在一个节点里的只出一片', j(piecesForMatch(starts, [2, 2, 2], findMatches(text, '规则')[0])) === j([{ segment: 2, start: 0, end: 2 }]));
  ck('空列表', j(joinSegments([])) === j({ text: '', starts: [] }));
  const E = {};
  const withEmpty = joinSegments([{ text: 'ab', group: E }, { text: '', group: E }, { text: 'cd', group: E }]);
  ck('中间有空节点:切片跳过长度 0 的那段', j(piecesForMatch(withEmpty.starts, [2, 0, 2], { start: 1, end: 3 })) === j([{ segment: 0, start: 1, end: 2 }, { segment: 2, start: 0, end: 1 }]));
}

// ── 阅读 ↔ 编辑:挑对应的那一处 ──
ck('同块第 k 处', pickCorresponding([3, 5, 5, 5, 9], 5, 1) === 2);
ck('同块不够 k 处 ⇒ 块内最后一处', pickCorresponding([3, 5, 5, 9], 5, 4) === 2);
ck('那块没有 ⇒ 往后第一处', pickCorresponding([3, 9, 12], 5, 0) === 1);
ck('后面也没有 ⇒ 0', pickCorresponding([1, 2], 50, 0) === 0);
ck('另一边无匹配 ⇒ -1', pickCorresponding([], 5, 0) === -1);
ck('负序号按 0', pickCorresponding([5, 5], 5, -3) === 0);
ck('ordinalInGroup', ordinalInGroup([3, 5, 5, 5, 9], 3) === 2 && ordinalInGroup([3, 5], 0) === 0 && ordinalInGroup([3], 7) === 0);
ck('sourceKeysForBlock:块内的行归到块首', j(sourceKeysForBlock([1, 4, 5, 6, 9], { start: 4, end: 6 })) === j([1, 4, 4, 4, 9]));
{
  // 阅读区第 2 块(原文 4–6 行)里的第 2 处 → 编辑框里对应的那一处
  const src = 'a\nx\nq\nq\nnote x and x\nx\nq\nx';
  const ms = findMatches(src, 'x');
  const lines = matchLines(src, ms);
  ck('matchLines', j(lines) === j([1, 4, 4, 5, 7]), j(lines));
  const idx = pickCorresponding(sourceKeysForBlock(lines, { start: 4, end: 6 }), 4, 1);
  ck('阅读→编辑:块内第 2 处对应原文第 3 个匹配', idx === 2, String(idx));
}
ck('matchLines 认 \\r\\n 和 \\r', j(matchLines('a\r\nb\rc\nd', findMatches('a\r\nb\rc\nd', 'd'))) === j([3]));
ck('matchLines 与逐个 lineAtOffset 一致(\\r\\n 只算一次)', (() => { const t = 'x\r\n\r\nx\rx'; return j(matchLines(t, findMatches(t, 'x'))) === j([0, 2, 3]); })());

// ── 快捷键 ──
ck('macOS ⌘F', isFindShortcut({ key: 'f', metaKey: true }, true));
ck('macOS Ctrl+F 不拦(emacs 光标右移)', !isFindShortcut({ key: 'f', ctrlKey: true }, true));
ck('Windows/Linux Ctrl+F', isFindShortcut({ key: 'f', ctrlKey: true }, false));
ck('Windows/Linux ⊞+F 不拦', !isFindShortcut({ key: 'f', metaKey: true }, false));
ck('大写 F(CapsLock)也算', isFindShortcut({ key: 'F', ctrlKey: true }, false));
ck('输入法下 key 不是 f 时认 code', isFindShortcut({ key: 'Process', code: 'KeyF', ctrlKey: true }, false));
ck('带 Shift 不拦(⌘⇧F 留给别人)', !isFindShortcut({ key: 'F', metaKey: true, shiftKey: true }, true));
ck('带 Alt 不拦', !isFindShortcut({ key: 'f', ctrlKey: true, altKey: true }, false));
ck('Ctrl+⌘+F(macOS 全屏)不拦', !isFindShortcut({ key: 'f', ctrlKey: true, metaKey: true }, true));
ck('别的键不拦', !isFindShortcut({ key: 'g', ctrlKey: true }, false));
ck('macOS UA', isMacPlatform('MacIntel', '') && isMacPlatform('', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)'));
ck('Windows / Linux UA 不是 mac', !isMacPlatform('Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)') && !isMacPlatform('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)'));
ck('查找框:Enter 下一个 / Shift+Enter 上一个', findKeyAction({ key: 'Enter' }) === 'next' && findKeyAction({ key: 'Enter', shiftKey: true }) === 'prev');
ck('查找框:↓ 下一个 / ↑ 上一个 / Esc 关闭', findKeyAction({ key: 'ArrowDown' }) === 'next' && findKeyAction({ key: 'ArrowUp' }) === 'prev' && findKeyAction({ key: 'Escape' }) === 'close');
ck('查找框:输入法组字中的 Enter 不算(选词)', findKeyAction({ key: 'Enter', isComposing: true }) === null && findKeyAction({ key: 'Enter', keyCode: 229 }) === null);
ck('查找框:普通字符不算', findKeyAction({ key: 'a' }) === null);

// ── contentKey ──
ck('内容相同 key 相同', contentKey('规则 A') === contentKey('规则 A'));
ck('改一个字 key 就变', contentKey('规则 A') !== contentKey('规则 B'));
ck('同长度不同内容也不同', contentKey('ab') !== contentKey('ba'));

console.log(`\n${pass}/${total} passed`);
if (pass !== total) (globalThis as any).process?.exit(1);
