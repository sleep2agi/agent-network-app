// 规则文件「阅读 / 编辑 / 全屏」的纯模型(2026-09-25,Vincent「这个规则文件也太少了」:
// 48 KB 的 AGENTS.md 挤在一个等宽编辑框里,读不动)。
// 默认阅读模式 = 用聊天同一个 MarkdownMessage 渲染;编辑模式 = 原来的等宽编辑框。
// 纯逻辑,不 import react-native。
import { parseMarkdownBlocks } from './markdown-model';

export type RulesViewMode = 'read' | 'edit';

/** 打开规则文件时默认的模式:读得多、改得少,先给能读的样子。 */
export const RULES_DEFAULT_MODE: RulesViewMode = 'read';

export interface RulesViewState {
  /** 阅读模式渲染哪份文字:永远是编辑中的草稿(没改过时草稿就等于节点上的原文)。 */
  readonly renderSource: string;
  /** 草稿和节点上的不一样时,阅读模式也要标「未保存」,免得以为看的是节点上的版本。 */
  readonly unsaved: boolean;
}

/**
 * 两种模式共用同一份草稿:切到阅读不丢改动,切回编辑接着改。
 * onNode 为 null = 还没读到(不算未保存);'' = 节点上文件不存在。
 */
export function rulesViewState(draft: string, onNode: string | null): RulesViewState {
  return { renderSource: draft, unsaved: onNode !== null && draft !== onNode };
}

export interface OutlineEntry {
  /** 在全文所有标题里的序号(0 起),与 MarkdownMessage 的 onHeadingLayout 序号一致。 */
  readonly index: number;
  readonly level: number;
  readonly text: string;
}

/** 目录只收 h1–h3,再深就不是目录是全文了。 */
export const OUTLINE_MAX_LEVEL = 3;

/** 目录里显示纯文字:去掉行内 markdown 记号(`代码`、**粗**、*斜*、[链接](url))。 */
export function outlineText(raw: string): string {
  return raw
    .replace(/\[([^\]\n]+)\]\([^\s)]+\)/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/g, (_m, a, b) => a ?? b)
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 全屏左侧目录。复用渲染用的同一个解析器,所以代码块里的 `# 注释` 不会被当成标题,
 * 序号也和渲染出来的标题一一对应(点目录滚到的就是那一个)。
 */
export function buildRulesOutline(source: string): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  let index = 0;
  for (const block of parseMarkdownBlocks(source)) {
    if (block.kind !== 'heading') continue;
    if (block.level <= OUTLINE_MAX_LEVEL) out.push({ index, level: block.level, text: outlineText(block.text) });
    index++;
  }
  return out;
}

/**
 * 什么时候该**重新**向节点读规则文件。节点页每次刷新都会新造一个 target 对象(rulesFileTarget),
 * 以前读取挂在对象身份上 ⇒ 页面一刷新就重读一次、把编辑框里没保存的草稿冲掉。
 * 只在「读的是不是同一个文件」变了时才重读:同一台 hub、同一个网络、同一个节点。
 */
export function rulesReadKey(
  cfg: { serverUrl: string; networkId?: string; profileId?: string },
  node: { node_id?: string | null; alias: string },
): string {
  return JSON.stringify([cfg.serverUrl, cfg.networkId ?? null, cfg.profileId ?? null, node.node_id ?? null, node.alias]);
}
