// 项目文件夹右侧文件树的纯状态 — run: bun src/node-files-tree.test.ts
// @ts-expect-error app tsconfig 不带 node 类型(其余读源码的 ck 测试同样处理);运行时由 bun 提供。
import { readFileSync } from 'node:fs';
import type { NodeFileEntry, NodeFilesListing } from './node-files';
import { NODE_PAGE_CONTENT_MAX_WIDTH } from './node-page-model';
import {
  FILES_TREE_DEFAULT_WIDTH, FILES_TREE_DOCK_MIN_CONTENT_WIDTH, FILES_TREE_MAX_WIDTH, FILES_TREE_MIN_WIDTH, FILES_VIEWER_MIN_WIDTH, FilesTreeCache,
  ancestorDirs, arrowIntent, clampTreeWidth, collapseDir, dropInFlight, emptyTree, expandDir, filesTreeMode, invalidateTree, isExpanded,
  markError, markLoading, mergeListing, missingExpanded, moveFocus, nodePageColumnMaxWidth, revealPath, toggleDir, visibleRows, type FilesTreeState, type TreeRow,
} from './node-files-tree';

let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) { pass++; console.log('✅', name); }
  else console.log('❌', name, extra);
};

const dir = (name: string, extra: Partial<NodeFileEntry> = {}): NodeFileEntry => ({ name, type: 'dir', ...extra });
const file = (name: string, extra: Partial<NodeFileEntry> = {}): NodeFileEntry => ({ name, type: 'file', size: 10, ...extra });
const L = (path: string, entries: NodeFileEntry[], truncated = false, total2 = entries.length): NodeFilesListing => ({ path, entries, truncated, total: total2 });
const names = (rows: TreeRow[]) => rows.map(r => (r.kind === 'entry' ? `${'  '.repeat(r.depth)}${r.name}${r.dirLike ? (r.expanded ? '/v' : '/>') : ''}` : `${'  '.repeat(r.depth)}<${r.kind}>`));

const ROOT = L('', [dir('docker'), dir('src'), dir('node_modules', { hidden_reason: 'skipped', no_descend: true }), dir('.git', { hidden_reason: 'secret', no_descend: true }),
  { name: 'docs-link', type: 'symlink', link_type: 'dir' }, { name: 'link-out', type: 'symlink', link_type: null }, file('.env', { hidden_reason: 'secret', size: undefined }), file('README.md')]);
const DOCKER = L('docker', [dir('feishu-deny-e2e'), file('compose.yml')]);
const FEISHU = L('docker/feishu-deny-e2e', [file('Dockerfile'), file('run.sh')]);

// ── 展开 / 收起:按需列,缓存命中不再发 ──
{
  const r0 = expandDir(emptyTree(), '');
  ck('根第一次展开要列', r0.fetch && r0.state.loading.includes(''));
  ck('根不写进 expanded(永远算展开)', r0.state.expanded.length === 0 && isExpanded(r0.state, ''));
  const again = expandDir(r0.state, '');
  ck('还在列的目录再展开不重复发', again.fetch === false);
  let s = mergeListing(r0.state, '', ROOT);
  ck('列回来清掉转圈', !s.loading.includes('') && s.listings[''] === ROOT);
  const t1 = toggleDir(s, 'docker');
  ck('展开 docker → 只列 docker 这一个路径', t1.fetch && t1.state.loading.join() === 'docker' && t1.state.expanded.join() === 'docker');
  s = mergeListing(t1.state, 'docker', DOCKER);
  const t2 = toggleDir(s, 'docker');
  ck('再点一次 = 收起,不发请求', !t2.fetch && !isExpanded(t2.state, 'docker'));
  const t3 = toggleDir(t2.state, 'docker');
  ck('收起后再展开命中缓存,不发请求', !t3.fetch && isExpanded(t3.state, 'docker') && t3.state.loading.length === 0);
  ck('收起根是 no-op', collapseDir(t3.state, '') === t3.state);
  // 收起父目录保留子目录展开状态
  let n = mergeListing(expandDir(t3.state, 'docker/feishu-deny-e2e').state, 'docker/feishu-deny-e2e', FEISHU);
  n = collapseDir(n, 'docker');
  ck('收起父目录时子目录展开记录保留', n.expanded.includes('docker/feishu-deny-e2e') && !n.expanded.includes('docker'));
  ck('收起父目录后子树不出现在行里', !names(visibleRows(n)).some(x => x.includes('Dockerfile')));
  n = toggleDir(n, 'docker').state;
  ck('再展开父目录,子目录原样展开回来', names(visibleRows(n)).includes('    Dockerfile'), names(visibleRows(n)).join('|'));
  ck('不可变更新:旧状态没被改', !t2.state.expanded.includes('docker') && s.listings['docker'] === DOCKER);
}

// ── 失败 / 重试 ──
{
  let s = mergeListing(emptyTree(), '', ROOT);
  s = expandDir(s, 'src').state;
  s = markError(s, 'src', '节点读取失败');
  ck('失败:转圈停、错误挂在那个目录', !s.loading.includes('src') && s.errors['src'] === '节点读取失败');
  ck('失败的目录下画一行错误', visibleRows(s).some(r => r.kind === 'error' && r.depth === 1 && r.message === '节点读取失败'));
  const collapsed = collapseDir(s, 'src');
  const retry = expandDir(collapsed, 'src');
  ck('收起再展开 = 重试(清错误、重新列)', retry.fetch && retry.state.errors['src'] === undefined && retry.state.loading.includes('src'));
  ck('markLoading 清错误', markLoading(s, 'src').errors['src'] === undefined && markLoading(s, 'src').loading.includes('src'));
}

// ── 摊平成行 ──
{
  let s = mergeListing(emptyTree(), '', ROOT);
  s = expandDir(s, 'docker').state;
  let rows = visibleRows(s);
  ck('展开中的目录下画一行转圈', rows.some(r => r.kind === 'loading' && r.depth === 1 && r.path.startsWith('docker\0')));
  const dockerRow = rows.find(r => r.kind === 'entry' && r.path === 'docker');
  ck('展开中的目录那一行自己也标 loading', dockerRow?.kind === 'entry' && dockerRow.loading);
  s = mergeListing(s, 'docker', DOCKER);
  s = mergeListing(expandDir(s, 'docker/feishu-deny-e2e').state, 'docker/feishu-deny-e2e', FEISHU);
  rows = visibleRows(s);
  ck('嵌套展开按层缩进', names(rows).slice(0, 6).join('|') === 'docker/v|  feishu-deny-e2e/v|    Dockerfile|    run.sh|  compose.yml|src/>', names(rows).join('|'));
  const byName = (n: string) => rows.find(r => r.kind === 'entry' && r.name === n) as Extract<TreeRow, { kind: 'entry' }> | undefined;
  ck('依赖目录(node_modules)不可展开', byName('node_modules')?.dirLike === false && byName('node_modules')?.action.kind === 'none');
  ck('凭据目录(.git)不可展开', byName('.git')?.dirLike === false);
  ck('工作目录内的目录链接可展开', byName('docs-link')?.dirLike === true && byName('docs-link')?.action.kind === 'descend');
  ck('指向外面的链接:不可打开(和列表视图同一个 entryAction)', byName('link-out')?.action.kind === 'none');
  ck('凭据文件:动作是 secret(不发读取请求)', byName('.env')?.action.kind === 'secret');
  ck('普通文件路径拼对', byName('Dockerfile')?.path === 'docker/feishu-deny-e2e/Dockerfile' && byName('Dockerfile')?.action.kind === 'open');
  const empty = visibleRows(mergeListing(expandDir(s, 'src').state, 'src', L('src', [])));
  ck('空目录画一行「空」', empty.some(r => r.kind === 'empty' && r.depth === 1));
  const trunc = visibleRows(mergeListing(emptyTree(), '', L('', [file('a')], true, 5000)));
  ck('截断的目录画一行「只显示前 N 项」', trunc.some(r => r.kind === 'truncated' && r.shown === 1 && r.total === 5000));
  ck('占位行 path 不会和真条目撞', rows.filter(r => r.kind !== 'entry').every(r => r.path.includes('\0')));
  ck('没有缓存的目录不走下去(visibleRows 不发请求,也不造行)', visibleRows(emptyTree()).length === 0);
}

// ── 打开文件时展开祖先 ──
{
  ck('ancestorDirs 从根到父', JSON.stringify(ancestorDirs('docker/feishu-deny-e2e/Dockerfile')) === '["","docker","docker/feishu-deny-e2e"]');
  ck('顶层文件的祖先只有根', JSON.stringify(ancestorDirs('README.md')) === '[""]');
  ck('空路径没有祖先', ancestorDirs('').length === 0);
  const r = revealPath(emptyTree(), 'docker/feishu-deny-e2e/Dockerfile');
  ck('全都没缓存 → 从根到叶依次列', JSON.stringify(r.fetch) === '["","docker","docker/feishu-deny-e2e"]', JSON.stringify(r.fetch));
  ck('祖先全部展开', isExpanded(r.state, 'docker') && isExpanded(r.state, 'docker/feishu-deny-e2e'));
  let s = mergeListing(mergeListing(emptyTree(), '', ROOT), 'docker', DOCKER);
  const r2 = revealPath(s, 'docker/feishu-deny-e2e/Dockerfile');
  ck('缓存里有的祖先直接用,只补缺的', JSON.stringify(r2.fetch) === '["docker/feishu-deny-e2e"]', JSON.stringify(r2.fetch));
  s = mergeListing(r2.state, 'docker/feishu-deny-e2e', FEISHU);
  ck('补齐后当前文件那一行看得见', visibleRows(s).some(x => x.kind === 'entry' && x.path === 'docker/feishu-deny-e2e/Dockerfile'));
  const r3 = revealPath(s, 'docker/feishu-deny-e2e/Dockerfile');
  ck('全缓存 → 一个请求都不发', r3.fetch.length === 0);
  const r4 = revealPath(markLoading(emptyTree(), ''), 'docker/x');
  ck('正在列的祖先不重复发', JSON.stringify(r4.fetch) === '["docker"]', JSON.stringify(r4.fetch));
}

// ── 刷新:整棵作废,只重取看得见的展开目录 ──
{
  let s = mergeListing(emptyTree(), '', ROOT);
  s = mergeListing(expandDir(s, 'docker').state, 'docker', DOCKER);
  s = mergeListing(expandDir(s, 'docker/feishu-deny-e2e').state, 'docker/feishu-deny-e2e', FEISHU);
  s = mergeListing(expandDir(s, 'src').state, 'src', L('src', [dir('lib')]));
  s = mergeListing(expandDir(s, 'src/lib').state, 'src/lib', L('src/lib', [file('util.ts')]));
  s = collapseDir(s, 'src');
  s = markError(expandDir(s, 'docs-link').state, 'docs-link', 'x');
  const inv = invalidateTree(s);
  ck('缓存全清', Object.keys(inv.state.listings).length === 0);
  ck('错误全清', Object.keys(inv.state.errors).length === 0);
  ck('展开状态保留', inv.state.expanded.includes('docker/feishu-deny-e2e') && inv.state.expanded.includes('src/lib'));
  ck('只重取看得见的展开目录,从浅到深', JSON.stringify(inv.fetch) === '["","docker","docs-link","docker/feishu-deny-e2e"]', JSON.stringify(inv.fetch));
  ck('收起的父目录下的展开记录不重取', !inv.fetch.includes('src/lib'));
  ck('重取的目录都在转圈', inv.fetch.every(d => inv.state.loading.includes(d)));
}

// ── 卸载 / 重挂 ──
{
  let s = mergeListing(emptyTree(), '', ROOT);
  s = expandDir(s, 'docker').state; // 卸载时 docker 还在列
  const back = dropInFlight(s);
  ck('卸载时在列的目录清掉转圈', back.loading.length === 0 && isExpanded(back, 'docker'));
  ck('重挂时补取展开但没缓存的目录', JSON.stringify(missingExpanded(back)) === '["docker"]');
  ck('没有在列的 → dropInFlight 原样返回', dropInFlight(mergeListing(emptyTree(), '', ROOT)).loading.length === 0);
  ck('空树重挂 → 要列根', JSON.stringify(missingExpanded(emptyTree())) === '[""]');
  ck('失败过的不自动重取(等人点)', missingExpanded(markError(back, 'docker', 'x')).length === 0);
}

// ── 按节点缓存 ──
{
  const c = new FilesTreeCache(2);
  const a = mergeListing(emptyTree(), '', ROOT);
  c.set('n1', a);
  ck('同一节点取回同一份', c.get('n1') === a);
  ck('没见过的节点 → 空树(不串到别的节点)', Object.keys(c.get('n2').listings).length === 0 && !c.has('n2'));
  c.set('n2', emptyTree()); c.get('n1'); c.set('n3', emptyTree());
  ck('超出上限淘汰最久没用的', c.has('n1') && !c.has('n2') && c.has('n3') && c.size === 2);
}

// ── 键盘 ──
{
  let s = mergeListing(emptyTree(), '', ROOT);
  s = mergeListing(expandDir(s, 'docker').state, 'docker', DOCKER);
  const rows = visibleRows(s);
  ck('↓ 没有焦点 → 当前文件那一行', moveFocus(rows, null, 1, 'docker/compose.yml') === 'docker/compose.yml');
  ck('↓ 没有焦点也没有当前文件 → 第一行', moveFocus(rows, null, 1) === 'docker');
  ck('↑ 没有焦点 → 最后一行', moveFocus(rows, null, -1) === 'README.md');
  ck('↓ 下一行(进子树)', moveFocus(rows, 'docker', 1) === 'docker/feishu-deny-e2e');
  ck('↓ 到底停住', moveFocus(rows, 'README.md', 1) === 'README.md');
  ck('↑ 到顶停住', moveFocus(rows, 'docker', -1) === 'docker');
  const withLoading = visibleRows(expandDir(s, 'docker/feishu-deny-e2e').state);
  ck('↓ 跳过占位行(转圈)', moveFocus(withLoading, 'docker/feishu-deny-e2e', 1) === 'docker/compose.yml');
  ck('→ 收起的目录 = 展开', JSON.stringify(arrowIntent(rows, 'src', 'right')) === '{"kind":"expand","path":"src"}');
  ck('→ 展开的目录 = 跳到第一个子项', JSON.stringify(arrowIntent(rows, 'docker', 'right')) === '{"kind":"focus","path":"docker/feishu-deny-e2e"}');
  ck('← 展开的目录 = 收起', JSON.stringify(arrowIntent(rows, 'docker', 'left')) === '{"kind":"collapse","path":"docker"}');
  ck('← 子项 = 跳到父目录', JSON.stringify(arrowIntent(rows, 'docker/compose.yml', 'left')) === '{"kind":"focus","path":"docker"}');
  ck('← 顶层文件 = 不动', arrowIntent(rows, 'README.md', 'left').kind === 'none');
  ck('→ 文件 = 不动', arrowIntent(rows, 'README.md', 'right').kind === 'none');
}

// ── 布局 ──
{
  ck('并排阈值 = 查看器最小宽 + 空隙 + 树默认宽', FILES_TREE_DOCK_MIN_CONTENT_WIDTH === FILES_VIEWER_MIN_WIDTH + 12 + FILES_TREE_DEFAULT_WIDTH);
  ck('手机布局不挂树(不变)', filesTreeMode({ contentWidth: 2000, phone: true }) === 'none');
  ck('够宽 → 并排', filesTreeMode({ contentWidth: FILES_TREE_DOCK_MIN_CONTENT_WIDTH, phone: false }) === 'docked');
  ck('差 1px → 抽屉', filesTreeMode({ contentWidth: FILES_TREE_DOCK_MIN_CONTENT_WIDTH - 1, phone: false }) === 'drawer');
  ck('没量到宽度 → 抽屉(不先挂出来再收回去)', filesTreeMode({ contentWidth: 0, phone: false }) === 'drawer' && filesTreeMode({ contentWidth: NaN, phone: false }) === 'drawer');
  ck('只有项目文件夹 + 并排时放宽内容列', nodePageColumnMaxWidth('files', 'docked') === NODE_PAGE_CONTENT_MAX_WIDTH + 12 + FILES_TREE_MAX_WIDTH
    && nodePageColumnMaxWidth('files', 'drawer') === NODE_PAGE_CONTENT_MAX_WIDTH && nodePageColumnMaxWidth('rules', 'docked') === NODE_PAGE_CONTENT_MAX_WIDTH);
  ck('宽度夹在上下限之间', clampTreeWidth(10) === FILES_TREE_MIN_WIDTH && clampTreeWidth(9999) === FILES_TREE_MAX_WIDTH && clampTreeWidth(300.4) === 300 && clampTreeWidth(NaN) === FILES_TREE_DEFAULT_WIDTH);
}

// ── 挂载契约 ──
{
  const comp = readFileSync(new URL('./NodeFilesSection.tsx', import.meta.url), 'utf8');
  ck('树的展开只调 listNodeFiles(那一个路径),不另起遍历', /listNodeFiles\(cfg, target, d\)/.test(comp) && !/readdir|walk\(/.test(comp));
  ck('刷新会作废树缓存', /invalidateTree\(/.test(comp));
  ck('打开文件时展开祖先', /revealPath\(/.test(comp));
  ck('树里点文件复用同一个 openFile', /onOpen: \(path: string, name: string, secret: boolean\) => void openFile\(path, name, secret\)/.test(comp));
  const screen = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
  ck('节点页按内容列宽度决定树的模式', /filesTreeMode\(\{ contentWidth:/.test(screen) && /treeMode=\{filesTree\}/.test(screen));
}

void (null as unknown as FilesTreeState);
console.log(`\n${pass}/${total} passed`);
if (pass !== total) process.exit(1);
