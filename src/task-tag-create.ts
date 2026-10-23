import type { HubConfig } from './api';
import { appFetch } from './app-fetch';
import { withDeadline } from './deadline';
import { ACCEPT_COLUMNS_HEADERS } from './requirement-columns';
import { canManageTags, tagName, TagOpError, type TagNode, type TagCatalog } from './task-tag-catalog';

/** PR2935: tag_tree enables atomic name-keyed creation, independently of tag_ops. */
export function tagCreateSupported(cat: TagCatalog | null, parent: string | null, capabilities: readonly string[]): boolean {
  return capabilities.includes('tag_tree') && canManageTags(capabilities, cat)
    && (parent === null || cat!.tags.includes(parent));
}

export function tagCreateError(cat: TagCatalog | null, raw: string, parent: string | null, capabilities: readonly string[]): string | null {
  if (!capabilities.includes('tag_tree')) return 'tags.createUnsupported';
  if (!canManageTags(capabilities, cat)) return 'tags.noPermission';
  if (parent !== null && !cat!.tags.includes(parent)) return 'tags.parentMissing';
  const name = tagName(raw);
  if (!name) return 'tags.invalidName';
  if (cat!.tags.includes(name)) return 'tags.nameTaken';
  if (parent !== null && (cat!.nodes?.find(n => n.name === parent)?.depth ?? 1) >= 4) return 'tags.depthExceeded';
  return null;
}

export interface TagCreateReceipt { tag: Pick<TagNode, 'name' | 'parent_id' | 'depth'>; parent_registered: boolean }

export async function createTag(cfg: HubConfig, cat: TagCatalog, raw: string, parent: string | null, capabilities: readonly string[]): Promise<TagCreateReceipt> {
  const error = tagCreateError(cat, raw, parent, capabilities);
  if (error) throw new TagOpError(error, 0);
  const name = tagName(raw)!;
  const query = cfg.networkId ? `?network_id=${encodeURIComponent(cfg.networkId)}` : '';
  const got = await withDeadline((async () => {
    const res = await appFetch(`${cfg.serverUrl}/api/requirements/tags/create${query}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', ...ACCEPT_COLUMNS_HEADERS },
      body: JSON.stringify({ name, parent_id: parent }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  })(), 20_000, () => null);
  if (!got) throw new TagOpError('tags.createUnconfirmed', 0);
  if (got.status === 403) throw new TagOpError('tags.noPermission', 403);
  if (got.data?.error === 'tag_parent_not_found' || got.data?.error === 'invalid_tag_parent_id') throw new TagOpError('tags.parentMissing', got.status);
  if (got.data?.error === 'invalid_tag') throw new TagOpError('tags.invalidName', got.status);
  if (got.data?.error === 'tag_parent_cycle') throw new TagOpError('tags.parentCycle', got.status);
  if (got.data?.error === 'tag_depth_exceeded') throw new TagOpError('tags.depthExceeded', got.status);
  if (got.status === 409 && got.data?.error === 'tag_exists') throw new TagOpError('tags.nameTaken', 409);
  if (got.status === 404 || got.status === 405) throw new TagOpError('tags.createUnsupported', got.status);
  if (got.status !== 201 || got.data?.ok !== true) throw new TagOpError(got.status >= 200 && got.status < 300 ? 'tags.createUnconfirmed' : 'tags.opFailed', got.status);
  const tag = got.data.tag;
  const expectedDepth = parent === null ? 1 : (cat.nodes?.find(n => n.name === parent)?.depth ?? 1) + 1;
  if (!tag || tag.name !== name || tag.parent_id !== parent || !Number.isInteger(tag.depth) || tag.depth < 1 || tag.depth > 4
    || tag.depth !== expectedDepth || typeof got.data.parent_registered !== 'boolean'
    || (got.data.parent_registered && (parent === null || tag.depth !== 2))) throw new TagOpError('tags.createUnconfirmed', got.status);
  return { tag: { name: tag.name, parent_id: tag.parent_id, depth: tag.depth }, parent_registered: got.data.parent_registered };
}

/** Install only a confirmed receipt. A legacy card-only parent stays attached. */
export function catalogWithCreatedTag(cat: TagCatalog, receipt: TagCreateReceipt): TagCatalog {
  const { tag, parent_registered } = receipt;
  const nodes = [...(cat.nodes ?? []).filter(n => n.name !== tag.name)];
  if (parent_registered && tag.parent_id !== null) {
    const old = nodes.find(n => n.name === tag.parent_id);
    const registered: TagNode = { name: tag.parent_id, parent_id: null, depth: 1, registered: true, count: old?.count ?? cat.counts[tag.parent_id] ?? 0 };
    if (old) nodes[nodes.indexOf(old)] = registered; else nodes.push(registered);
  }
  nodes.push({ ...tag, registered: true, count: 0 });
  return { ...cat, tags: [...new Set([...cat.tags, ...(tag.parent_id === null ? [] : [tag.parent_id]), tag.name])],
    counts: { ...cat.counts, [tag.name]: 0 }, nodes,
    parents: { ...cat.parents, ...(parent_registered && tag.parent_id !== null ? { [tag.parent_id]: null } : {}), [tag.name]: tag.parent_id },
    depths: { ...cat.depths, ...(parent_registered && tag.parent_id !== null ? { [tag.parent_id]: 0 } : {}), [tag.name]: tag.depth - 1 } };
}
