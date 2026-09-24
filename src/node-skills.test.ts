// 设置里看节点技能(只读)— run: bun src/node-skills.test.ts
import { readFileSync } from 'node:fs';
import { listNodeSkills, readNodeSkill, type HubConfig } from './api';
import { isValidSkillName, parseSkillDetail, parseSkillsList, scopeLabel, skillsStatusMessage, skillsTarget, stripFrontmatter } from './node-skills';

let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) { pass++; console.log('✅', name); }
  else console.log('❌', name, extra);
};

// ── 显示条件 / 请求目标:只认 skills_capable,不猜 ──
ck('未上报 skills_capable → 不显示', skillsTarget({ node: { node_id: 'n1', alias: 'a' }, session: { alias: 'a' } }) === null);
ck('skills_capable=false → 不显示', skillsTarget({ node: { node_id: 'n1', alias: 'a' }, session: { alias: 'a', skills_capable: false } }) === null);
ck('有 nodes 行 → 按 node_id 发', skillsTarget({ node: { node_id: 'n1', alias: 'a', runtime: 'codex' }, session: { alias: 'a', skills_capable: true } })?.node_id === 'n1');
{
  const t = skillsTarget({ node: null, session: { alias: 'sess-a', skills_capable: true } });
  ck('没有 nodes 行(claude-code 会话)→ 按 alias 发', !!t && t.alias === 'sess-a' && !t.node_id, JSON.stringify(t));
}

// ── 名字规则与 hub / 节点一致 ──
ck('合法名', isValidSkillName('release-notes') && isValidSkillName('a.b_c-1'));
ck('路径穿越/分隔符/点名被拒', !isValidSkillName('../x') && !isValidSkillName('a/b') && !isValidSkillName('.') && !isValidSkillName('..') && !isValidSkillName(''));
ck('超过 64 字符被拒', !isValidSkillName('x'.repeat(65)) && isValidSkillName('x'.repeat(64)));

// ── 列表载荷容错 ──
{
  const list = parseSkillsList(JSON.stringify({ skills: [
    { name: 'deploy', scope: 'project', path_rel: '.claude/skills/deploy/SKILL.md', description: 'Ship it' },
    { name: '../evil', scope: 'user', path_rel: 'x', description: '' },
    { name: 'mystery', scope: 'weird' },
    null,
  ] }));
  ck('坏名字/空条目丢掉,好条目保留', list.length === 2 && list[0]!.name === 'deploy' && list[1]!.name === 'mystery', JSON.stringify(list));
  ck('未知 scope 归到 project,缺字段补空串', list[1]!.scope === 'project' && list[1]!.description === '' && list[1]!.path_rel === '');
  ck('非 JSON / 空 → 空列表不抛', parseSkillsList('not json').length === 0 && parseSkillsList(undefined).length === 0 && parseSkillsList('{}').length === 0);
}
{
  const d = parseSkillDetail(JSON.stringify({ name: 'deploy', scope: 'user', path_rel: '~/.claude/skills/deploy/SKILL.md', description: 'd', content: '# Deploy' }));
  ck('详情解析', d?.name === 'deploy' && d.scope === 'user' && d.content === '# Deploy');
  ck('详情缺 content → null', parseSkillDetail(JSON.stringify({ name: 'x' })) === null && parseSkillDetail('nope') === null);
}

ck('scope 中文标签', scopeLabel('project') === '项目' && scopeLabel('user') === '用户' && scopeLabel('system') === '内置');
ck('去掉 frontmatter', stripFrontmatter('---\nname: a\ndescription: b\n---\n\n# Body\ntext') === '# Body\ntext');
ck('没有 frontmatter 原样返回', stripFrontmatter('# Title\n---\nx') === '# Title\n---\nx');
ck('frontmatter 未闭合原样返回', stripFrontmatter('---\nname: a\n# Body') === '---\nname: a\n# Body');
ck('空列表有说明、超时有说明', skillsStatusMessage('done', null, 0).length > 0 && skillsStatusMessage('done', null, 3) === '' && /60 秒/.test(skillsStatusMessage('timeout', null)));
ck('失败带节点原因', skillsStatusMessage('failed', 'skill not found: x').includes('skill not found: x'));

// ── 真打 api:工具名、参数形状(只传技能名,不传路径)、旧 hub/单飞映射 ──
const originalFetch = globalThis.fetch;
const calls: any[] = [];
let mode: 'ok' | 'unknown_tool' | 'in_flight' = 'ok';
globalThis.fetch = (async (input: any, init?: any) => {
  const body = init?.body ? JSON.parse(init.body) : undefined;
  calls.push({ url: String(input), body });
  const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
  if (mode === 'unknown_tool') return json({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: `Tool ${body.params.name} not found` } });
  const payload = mode === 'in_flight' ? { ok: false, error: 'request_in_flight', existing_request_id: 'r-prev' } : { ok: true, request_id: 'r1', op: body.params.name === 'read_node_skill' ? 'skill_read' : 'skills_list' };
  return json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } });
}) as typeof fetch;
try {
  const cfg: HubConfig = { serverUrl: 'https://hub.example.test', token: 'utok_test', networkId: 'net_main', username: 'admin' } as HubConfig;
  const l = await listNodeSkills(cfg, { node_id: 'n1', alias: 'a' });
  const lc = calls.at(-1)?.body?.params;
  ck('list 走 list_node_skills', lc?.name === 'list_node_skills' && l.ok === true && l.request_id === 'r1', JSON.stringify(lc));
  ck('list 参数只有目标 + network_id', JSON.stringify(Object.keys(lc?.arguments ?? {}).sort()) === JSON.stringify(['network_id', 'node_id']), JSON.stringify(lc?.arguments));
  await readNodeSkill(cfg, { alias: 'sess-a' }, 'deploy');
  const rc = calls.at(-1)?.body?.params;
  ck('read 走 read_node_skill 且只带 name', rc?.name === 'read_node_skill' && rc.arguments.name === 'deploy' && rc.arguments.alias === 'sess-a' && !('path' in rc.arguments) && !('content' in rc.arguments), JSON.stringify(rc));
  mode = 'unknown_tool';
  const u = await listNodeSkills(cfg, { node_id: 'n1', alias: 'a' });
  ck('旧 hub(没有这个工具)→ unsupported,文案说技能而不是规则文件', !u.ok && u.unsupported === true && /技能/.test(u.error) && !/规则文件/.test(u.error), JSON.stringify(u));
  mode = 'in_flight';
  const f = await readNodeSkill(cfg, { node_id: 'n1', alias: 'a' }, 'deploy');
  ck('单飞被拒 → 带回 existing_request_id', !f.ok && f.existing_request_id === 'r-prev', JSON.stringify(f));
} finally {
  globalThis.fetch = originalFetch;
}

// ── 挂载契约:另一个 agent 在重做节点页,约定的就是这个导出名 + props ──
{
  const comp = readFileSync(new URL('./NodeSkillsSection.tsx', import.meta.url), 'utf8');
  ck('导出 NodeSkillsSection(命名 + 默认),props { cfg, alias, node, session, readOnly }', /export type NodeSkillsSectionProps = \{ cfg: HubConfig; alias\?: string; node\?: RulesTarget \| null; session: Session; readOnly\?: boolean \};/.test(comp) && /export function NodeSkillsSection\(/.test(comp) && /export default NodeSkillsSection;/.test(comp));
  ck('组件复用聊天的 MarkdownMessage 渲染', /import MarkdownMessage from '\.\/MarkdownMessage'/.test(comp) && /<MarkdownMessage>/.test(comp));
  ck('组件不显示时直接 return null(由 skillsTarget 决定)', /const target = skillsTarget\(\{ node: node \?\? null, session: \{ \.\.\.session, alias: session\.alias \|\| alias \|\| '' \} \}\);\s*if \(!target\) return null;/.test(comp));
  const screen = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
  ck('节点页「技能」分区挂载,带权威 node(rulesTarget)与 readOnly', /section === 'skills'[\s\S]{0,300}<NodeSkillsSection cfg=\{cfg\} alias=\{alias\} node=\{rulesTarget\} session=\{s\} readOnly=\{readOnly\} \/>/.test(screen));
  ck('只挂载一次', (screen.match(/<NodeSkillsSection /g) ?? []).length === 1);
}

console.log(`\n${pass}/${total} passed`);
if (pass !== total) process.exit(1);
