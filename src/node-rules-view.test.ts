// 规则文件「阅读 / 编辑 / 全屏目录」纯模型。ck 风格自执行脚本(不是 bun:test)。
// @ts-expect-error app tsconfig 不带 node 类型(其余读源码的 ck 测试同样报这一条);运行时由 node/bun 提供。
import { readFileSync } from 'node:fs';
import { buildRulesOutline, outlineText, OUTLINE_MAX_LEVEL, RULES_DEFAULT_MODE, rulesReadKey, rulesViewState } from './node-rules-view';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) p++; else console.log(`  ✗ ${n}`); };

// ── 草稿在两种模式间保留 ───────────────────────────────
ck('默认是阅读模式', RULES_DEFAULT_MODE === 'read');
const clean = rulesViewState('# 规则\n原文', '# 规则\n原文');
ck('没改过:阅读渲染原文、不标未保存', clean.renderSource === '# 规则\n原文' && clean.unsaved === false);
const draft = rulesViewState('# 规则\n改过的草稿', '# 规则\n原文');
ck('改过:阅读渲染的是草稿,不是节点上的原文', draft.renderSource === '# 规则\n改过的草稿');
ck('改过:标未保存', draft.unsaved === true);
ck('还没读到(onNode=null):不标未保存', rulesViewState('', null).unsaved === false);
ck('节点上没有文件(onNode=\'\')+ 写了草稿:标未保存', rulesViewState('新规则', '').unsaved === true);
ck('节点上没有文件 + 草稿也空:不标未保存', rulesViewState('', '').unsaved === false);

// ── 目录 ────────────────────────────────────────────
const doc = [
  '# 总则',
  '正文',
  '## 第 1 节 `命令`',
  '```bash',
  '# 这是代码里的注释,不是标题',
  'echo hi',
  '```',
  '### 1.1 **加粗** 与 [链接](https://example.com)',
  '#### 太深的标题',
  '## 第 2 节',
  '#不是标题(没有空格)',
].join('\n');
const o = buildRulesOutline(doc);
ck('收 h1–h3,代码块里的 # 和 h4 不收', o.map(h => h.text).join('|') === '总则|第 1 节 命令|1.1 加粗 与 链接|第 2 节');
ck('层级正确', o.map(h => h.level).join(',') === '1,2,3,2');
ck('序号按全文所有标题计(h4 占一个号,后面的序号跳过它)', o.map(h => h.index).join(',') === '0,1,2,4');
ck('OUTLINE_MAX_LEVEL = 3', OUTLINE_MAX_LEVEL === 3);
ck('空文档目录为空', buildRulesOutline('').length === 0);
ck('没收尾的代码块:后面的 # 也不当标题', buildRulesOutline('# A\n```\n# 注释\n## 不是').map(h => h.text).join('|') === 'A');
ck('outlineText 去掉行内记号', outlineText('`a` **b** *c* [d](https://x.y)') === 'a b c d');
ck('outlineText 保留普通星号乘法', outlineText('2 * 3') === '2 * 3');

// ── 重读时机:页面刷新造新对象不重读,换节点/换网络才重读 ─────────
const cfg: { serverUrl: string; networkId?: string; token: string } = { serverUrl: 'http://hub.example', networkId: 'net_a', token: 't1' };
const cfgRefreshed = { ...cfg, token: 't2' };
const k = rulesReadKey(cfg, { node_id: null, alias: 'demo-node' });
ck('同一目标、新对象 ⇒ 同一个 key(刷新不重读、不冲草稿)', k === rulesReadKey(cfgRefreshed, { node_id: null, alias: 'demo-node', runtime: 'claude-code-cli' } as any));
ck('换节点 ⇒ 换 key', k !== rulesReadKey(cfg, { node_id: null, alias: 'other-node' }));
ck('换网络 ⇒ 换 key', k !== rulesReadKey({ ...cfg, networkId: 'net_b' }, { node_id: null, alias: 'demo-node' }));
ck('有无 node_id ⇒ 换 key', k !== rulesReadKey(cfg, { node_id: 'n_1', alias: 'demo-node' }));

// ── 渲染侧契约:组件确实用了这些 helper,且 MarkdownMessage 报标题位置 ─────────
const section = readFileSync(new URL('./NodeRulesSection.tsx', import.meta.url), 'utf8');
const md = readFileSync(new URL('./MarkdownMessage.tsx', import.meta.url), 'utf8');
ck('规则区用 rulesViewState 决定渲染源和未保存标记', /rulesViewState\(editor/.test(section) && /view\.unsaved/.test(section));
ck('全屏用 buildRulesOutline 生成目录', /buildRulesOutline\(source\)/.test(section));
ck('阅读模式用聊天同一个 MarkdownMessage', /<MarkdownMessage onHeadingLayout=/.test(section));
ck('全屏 Esc 退出', /event\.key === 'Escape'/.test(section));
ck('首次读取挂在 readKey 上,不挂在 runRead 身份上', /\}, \[readKey\]\);/.test(section) && !/\}, \[runRead\]\);/.test(section));
ck('MarkdownMessage 按标题序号回报 y', /onHeadingLayout\(nth, event\.nativeEvent\.layout\.y\)/.test(md));

console.log(`node rules view: ${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);
