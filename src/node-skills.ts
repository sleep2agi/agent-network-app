// 节点「技能」区块的纯逻辑(只读)。
//
// 节点按自己的运行时枚举技能(主仓 agent-node/src/runtime/node-skills.ts,claude-code
// 会话的通道进程用同一份逐字节复制),经 rules-file 同一条门铃回来:
//   list_node_skills → get_rules_file_result.content = JSON {skills:[{name,scope,path_rel,description}]}
//   read_node_skill  → content = JSON {name,scope,path_rel,description,content}
// 🔴 桌面端只传技能名,不传路径;名字规则与 hub / 节点一致。

import type { RulesTarget, Session } from './api';

export type SkillScope = 'project' | 'user' | 'system';

export interface SkillSummary {
  name: string;
  scope: SkillScope;
  path_rel: string;
  description: string;
}

export interface SkillDetail extends SkillSummary {
  content: string;
}

const SKILL_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

export function isValidSkillName(name: unknown): name is string {
  return typeof name === 'string' && SKILL_NAME_RE.test(name) && name !== '.' && name !== '..';
}

/**
 * 技能区块显示给谁、请求发给谁:只看会话是否上报了 skills_capable
 * (老节点不认识 skills_list,发过去只会 60 秒超时,所以不做「猜它会答」的兜底)。
 * 有 nodes 行按 node_id 发,没有(claude-code 会话)按 alias 发。
 */
export function skillsTarget(args: {
  node: Pick<RulesTarget, 'node_id' | 'alias' | 'runtime'> | null | undefined;
  session: Pick<Session, 'alias' | 'skills_capable'> | null | undefined;
}): RulesTarget | null {
  const { node, session } = args;
  if (session?.skills_capable !== true) return null;
  if (node?.node_id) return { node_id: node.node_id, alias: node.alias, runtime: node.runtime ?? null };
  return { alias: session.alias };
}

const asScope = (v: unknown): SkillScope => (v === 'user' || v === 'system' ? v : 'project');

/** 容错解析列表载荷;坏条目丢掉,不抛。 */
export function parseSkillsList(content: string | undefined | null): SkillSummary[] {
  if (!content) return [];
  let data: any;
  try { data = JSON.parse(content); } catch { return []; }
  const list = Array.isArray(data?.skills) ? data.skills : [];
  const out: SkillSummary[] = [];
  for (const s of list) {
    if (!s || !isValidSkillName(s.name)) continue;
    out.push({
      name: s.name,
      scope: asScope(s.scope),
      path_rel: typeof s.path_rel === 'string' ? s.path_rel : '',
      description: typeof s.description === 'string' ? s.description : '',
    });
  }
  return out;
}

export function parseSkillDetail(content: string | undefined | null): SkillDetail | null {
  if (!content) return null;
  let s: any;
  try { s = JSON.parse(content); } catch { return null; }
  if (!s || !isValidSkillName(s.name) || typeof s.content !== 'string') return null;
  return {
    name: s.name,
    scope: asScope(s.scope),
    path_rel: typeof s.path_rel === 'string' ? s.path_rel : '',
    description: typeof s.description === 'string' ? s.description : '',
    content: s.content,
  };
}

export function scopeLabel(scope: SkillScope): string {
  return scope === 'user' ? '用户' : scope === 'system' ? '内置' : '项目';
}

/** 渲染 SKILL.md 正文前去掉开头的 YAML frontmatter(名字和描述已单独显示)。 */
export function stripFrontmatter(text: string): string {
  const t = text.replace(/^﻿/, '');
  if (!t.startsWith('---')) return t;
  const lines = t.split(/\r?\n/);
  if (lines[0]!.trim() !== '---') return t;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) return t;
  return lines.slice(end + 1).join('\n').replace(/^\s*\n/, '');
}

/** hub 终态 → 给人看的一句话。 */
export function skillsStatusMessage(status: 'pending' | 'in_progress' | 'done' | 'failed' | 'timeout', error: string | null, count?: number): string {
  switch (status) {
    case 'pending':
    case 'in_progress':
      return '正在向节点读取技能…';
    case 'done':
      return count === 0 ? '这个节点的运行时目录下还没有技能' : '';
    case 'failed':
      return `节点读取技能失败:${error ?? '未说明原因'}`;
    case 'timeout':
      // 技能区只对上报了 skills_capable 的会话显示,所以超时不是版本问题,是连接/节点状态问题。
      return '节点 60 秒内没有取走这次请求:多半是节点和服务器之间的实时连接断了,或节点卡住了;重启这个节点通常能恢复';
  }
}
