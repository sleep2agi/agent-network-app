import { readFileSync } from 'node:fs';
import { applyTagOpToCatalog, catalogFromHub, canManageTags, sidebarTagNames, TagOpError } from './task-tag-catalog';
import { catalogWithCreatedTag, createTag, tagCreateError, tagCreateSupported } from './task-tag-create';
import { includeTagAncestors } from './task-tree';
import { ACCEPT_COLUMNS_HEADERS } from './requirement-columns';
import type { HubConfig } from './api';

let passed = 0, total = 0;
const ck = (name: string, ok: boolean) => { total++; if (ok) passed++; else console.error(`FAIL ${name}`); };
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
const capabilities = ['tag_ops', 'tag_tree'];
const parent = { name: 'Parent label', parent_id: null, depth: 1, registered: true, count: 12 };
const child = { name: 'Child label', parent_id: parent.name, depth: 2 };
const payload = { tags: [parent.name], counts: { [parent.name]: 12 }, colors: { [parent.name]: '#123456' }, can_manage: true, nodes: [parent] };
const cat = catalogFromHub(payload)!;
const old = catalogFromHub({ tags: [parent.name], can_manage: true })!;
ck('name-keyed nodes preserve count/registration and zero-based display depth', eq(cat.nodes, [parent]) && cat.depths?.[parent.name] === 0 && cat.parents?.[parent.name] === null);
ck('tag_tree enables child creation, no IDs needed', tagCreateSupported(cat, parent.name, capabilities));
ck('old Hub can manage but cannot create', canManageTags(['tag_ops'], old) && !tagCreateSupported(old, parent.name, ['tag_ops']));
ck('read nodes never advertise write capability', !tagCreateSupported(cat, parent.name, ['tag_ops']));
ck('discarded provisional flags do not enable creation', !tagCreateSupported(catalogFromHub({ ...payload, can_create: true, tag_entities: [{ id: 'obsolete', name: parent.name, parent_id: null }] }), parent.name, ['tag_ops']));
ck('card-only parent is a legal name target', tagCreateSupported(old, parent.name, capabilities));
ck('missing parent never falls back to root', !tagCreateSupported(cat, 'missing', capabilities));
ck('create still needs both management rights and tag_ops', !tagCreateSupported({ ...cat, canManage: false }, parent.name, capabilities) && !tagCreateSupported(cat, parent.name, ['tag_tree']));
ck('duplicate name rejected locally', tagCreateError(cat, parent.name, parent.name, capabilities) === 'tags.nameTaken');
ck('unicode code point boundary, trim and controls', tagCreateError(cat, '  ' + '\u{1f600}'.repeat(20), null, capabilities) === null
  && tagCreateError(cat, '\u{1f600}'.repeat(21), null, capabilities) === 'tags.invalidName' && tagCreateError(cat, 'bad\nname', null, capabilities) === 'tags.invalidName');
const deep = catalogFromHub({ ...payload, nodes: [{ ...parent, depth: 4 }] })!;
ck('depth 4 parent cannot grow deeper', tagCreateError(deep, child.name, parent.name, capabilities) === 'tags.depthExceeded');
const zero = catalogFromHub({ ...payload, tags: [parent.name, 'Historical unused'], nodes: [parent, { ...child, registered: true, count: 0 }] })!;
const registered = zero.nodes!.filter(n => n.registered).map(n => n.name);
ck('registered zero-task nodes visible without selecting, historical unused stays hidden', eq(sidebarTagNames(new Map(), '', registered).sort(), [child.name, parent.name].sort()));
ck('delete fallback cannot resurrect removed registered node', !applyTagOpToCatalog(zero, { op: 'delete', tag: child.name }).nodes?.some(n => n.name === child.name));

const cfg = { serverUrl: 'https://hub.invalid', token: 'local-test-token', networkId: 'net /one' } as HubConfig;
const originalFetch = globalThis.fetch;
const requests: { url: string; init?: RequestInit }[] = [];
let status = 201;
let response: unknown = { ok: true, tag: child, parent_registered: false };
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  requests.push({ url: String(url), init });
  return new Response(JSON.stringify(response), { status, headers: { 'Content-Type': 'application/json' } });
}) as typeof fetch;
const failed = async (fn: () => Promise<unknown>, key: string) => {
  try { await fn(); return false; } catch (e) { return e instanceof TagOpError && e.key === key; }
};
const create = (catalog = cat, name = child.name, p: string | null = parent.name, caps = capabilities) => createTag(cfg, catalog, name, p, caps);
try {
  const receipt = await createTag(cfg, cat, ' Child label ', parent.name, capabilities);
  ck('confirmed receipt only', eq(receipt, { tag: child, parent_registered: false }));
  ck('exact full atomic scoped request: parent NAME, one write', eq(requests, [{ url: 'https://hub.invalid/api/requirements/tags/create?network_id=net%20%2Fone', init: {
    method: 'POST', headers: { Authorization: 'Bearer local-test-token', 'Content-Type': 'application/json', ...ACCEPT_COLUMNS_HEADERS }, body: JSON.stringify({ name: child.name, parent_id: parent.name }),
  } }]));
  const next = catalogWithCreatedTag(cat, receipt);
  ck('confirmed catalog preserves counts/colors and child hierarchy', next.counts[parent.name] === 12 && next.counts[child.name] === 0 && next.colors[parent.name] === '#123456'
    && next.parents?.[child.name] === parent.name && next.nodes?.some(n => n.name === child.name && n.registered) === true && next.depths?.[child.name] === 1);
  ck('selected empty child includes authorized parent', eq(includeTagAncestors(sidebarTagNames(new Map(), child.name), next.parents, new Set(next.tags)), [parent.name, child.name]));
  const before = requests.length;
  ck('old Hub makes no request', await failed(() => create(old, child.name, parent.name, ['tag_ops']), 'tags.createUnsupported'));
  ck('missing parent makes no request', await failed(() => create(cat, child.name, 'missing'), 'tags.parentMissing'));
  ck('local duplicate makes no request', await failed(() => create(cat, parent.name), 'tags.nameTaken'));
  ck('permission gate makes no request', await failed(() => create({ ...cat, canManage: false }), 'tags.noPermission'));
  ck('no root fallback writes', requests.length === before);
  status = 403; response = { ok: false };
  ck('403 stays failure, including node-token denial', await failed(() => create(), 'tags.noPermission'));
  status = 409; response = { ok: false, error: 'tag_exists' };
  ck('server duplicate stays failure', await failed(() => create(), 'tags.nameTaken'));
  status = 404; response = { ok: false, error: 'tag_parent_not_found' };
  ck('parent 404 is not unsupported and cannot create a root', await failed(() => create(), 'tags.parentMissing'));
  status = 400; response = { ok: false, error: 'invalid_tag_parent_id' };
  ck('invalid parent stays failure', await failed(() => create(), 'tags.parentMissing'));
  response = { ok: false, error: 'tag_depth_exceeded' };
  ck('server depth limit stays failure', await failed(() => create(), 'tags.depthExceeded'));
  response = { ok: false, error: 'tag_parent_cycle' };
  ck('server parent cycle stays failure', await failed(() => create(), 'tags.parentCycle'));
  response = { ok: false, error: 'invalid_tag' };
  ck('server name validation stays failure', await failed(() => create(), 'tags.invalidName'));
  for (const error of ['permission_denied', 'user_token_required']) {
    status = 403; response = { ok: false, error };
    ck(`${error} stays permission failure`, await failed(() => create(), 'tags.noPermission'));
  }
  status = 200; response = { ok: true, tag: child, parent_registered: false };
  ck('strict 201 required', await failed(() => create(), 'tags.createUnconfirmed'));
  status = 201;
  for (const bad of [{ ok: true }, { ok: true, tag: { ...child, parent_id: null }, parent_registered: false },
    { ok: true, tag: { ...child, name: 'Other' }, parent_registered: false }, { ok: true, tag: { ...child, depth: 5 }, parent_registered: false },
    { ok: true, tag: { ...child, depth: 1 }, parent_registered: false }, { ok: true, tag: child }]) {
    response = bad;
    ck('invalid/mismatched receipt never succeeds', await failed(() => create(), 'tags.createUnconfirmed'));
  }
  response = { ok: true, tag: child, parent_registered: true };
  const legacyReceipt = await create(old);
  const legacy = catalogWithCreatedTag(old, legacyReceipt);
  ck('legacy parent atomically registered as root, child remains attached', legacy.nodes?.some(n => n.name === parent.name && n.registered && n.depth === 1 && n.parent_id === null) === true
    && legacy.parents?.[child.name] === parent.name && legacy.depths?.[child.name] === 1);
  response = { ok: true, tag: { ...child, parent_id: null, depth: 1 }, parent_registered: false };
  await create(cat, child.name, null);
  ck('explicit root uses null and depth 1', requests[requests.length - 1].init?.body === JSON.stringify({ name: child.name, parent_id: null }));
  response = { ok: true, tag: { ...child, parent_id: null, depth: 1 }, parent_registered: true };
  ck('root cannot claim to register a parent', await failed(() => create(cat, child.name, null), 'tags.createUnconfirmed'));
} finally { globalThis.fetch = originalFetch; }

const menu = read('./TaskSideItemMenu.tsx');
const dialog = read('./TaskTagCreateDialog.tsx');
const board = read('./RequirementBoard.tsx');
const sidebar = read('./TaskFilterSidebar.tsx');
// #2220：项目也能「新建子项目」了，所以判据从"只有标签能建"变成"按 kind 各看各的能力位"；
// 意图不变：没有能力位时「新建子项目」这一项必须被过滤掉。
ck('menu hides child action without creation capability',
  menu.includes("a !== 'createChild' || (target.kind === 'project' ? canCreateProjectChild : canCreate)"));
ck('menu capability comes from board state', menu.includes('useTaskBoard(s => s.capabilities)') && menu.includes('tagCreateSupported(catalog, target.key, capabilities)'));
ck('menu transfers human-readable parent to dialog', menu.includes('setCreatingTag(target.key)') && board.includes('initialParent={creatingTag.parent}'));
ck('native-safe bounded dialog with fixed footer and Enter submission', dialog.includes('<DialogFrame') && dialog.includes('footer={') && !dialog.includes('<Modal') && dialog.includes('onSubmitEditing={() => { void submit(); }}'));
ck('submit-once ref guards Enter/button and busy cancellation', dialog.includes('if (submitting.current) return;') && dialog.includes('submitting.current = true;') && dialog.includes('if (!submitting.current) onClose();'));
ck('searchable name-keyed parents, Unicode limit not UTF16 maxLength', dialog.includes("parent ?? tr('tags.root')") && dialog.includes('[null, ...catalog.tags.filter(') && dialog.includes('tag-create-parent-search') && !dialog.includes('maxLength='));
ck('catalog and exact selection published together, authoritative reread after ops', board.includes('tagCatalog: catalogWithCreatedTag(') && board.includes('tag: receipt.tag.name, untagged: false, tagDescendants: undefined') && board.includes('refreshedCatalog ?? applyTagOpToCatalog'));
ck('sidebar includes only registered extra nodes', sidebar.includes('tagCatalog?.nodes?.filter(n => n.registered).map(n => n.name)'));
console.log(`tag create: ${passed}/${total}`);
if (passed !== total) process.exit(1);
