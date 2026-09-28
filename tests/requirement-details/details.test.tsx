import { afterEach, expect, mock, test } from 'bun:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
mock.module('react-native', () => ({
  View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator',
  Modal: ({ visible, children }: any) => visible ? children : null,
  StyleSheet: { create: (styles: any) => styles },
}));
mock.module('./src/ui-text', () => ({ Text: 'Text', TextInput: 'TextInput' }));
mock.module('./src/safe-area-runtime', () => ({ useModalSafePadding: () => ({ paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 }) }));
mock.module('./src/theme', () => ({ colors: {}, onThemeChange: () => () => {}, radius: { sm: 4, md: 8 }, spacing: { xs: 4, sm: 8, md: 12, lg: 16 } }));
mock.module('./src/requirements-store', () => ({ requirementsKey: (s: string) => s, readRequirements: () => [], writeRequirements: () => {} }));
mock.module('./src/api', () => ({ fetchHubNodes: async () => ({ nodes: [] }) }));

const card = { id: 'r1', name: '验证需求详情', assignee: '负责人甲', priority: 'normal', due: '', column: 'pool', createdAt: '' };
let typedCards = false;
let requests: any[] = [];
let creates: any[] = [];
let edits: any[] = [];
let reply: (value: any) => void;
let reject: (error: Error) => void;
class HubError extends Error { constructor(public status: number) { super('HTTP ' + status); } }
mock.module('./src/requirements-hub', () => ({
  filterAssigneeChoices: () => [],
  listRequirements: async () => [{ ...card, ...(typedCards ? { owner: null, participants: [] } : {}) }, { ...card, id: 'r2', name: '另一个需求' }], migrateLocalRequirements: async () => {},
  createRequirementOnHub: async (_cfg: any, input: any) => { creates.push(input); return { ...card, ...input, id: 'new', owner: input.owner || null, participants: [] }; },
  RequirementsHubError: HubError,
  requirementEditPatch: (current: { name: string; priority: string; due: string }, next: { name: string; priority: string; due: string }) => {
    const patch: { name?: string; priority?: string; due?: string } = {};
    if (next.name !== current.name) patch.name = next.name;
    if (next.priority !== current.priority) patch.priority = next.priority;
    if (next.due !== current.due) patch.due = next.due;
    return Object.keys(patch).length ? patch : null;
  },
  updateRequirementOnHub: async (_cfg: any, id: string, patch: any) => { edits.push({ id, patch }); return { ...card, id, ...patch, owner: null, participants: [] }; },
  moveRequirementOnHub: (cfg: any, id: string, column: string) => {
    requests.push({ network: cfg.networkId, id, column });
    return new Promise((resolve, fail) => { reply = resolve; reject = fail; });
  },
}));
const { default: Board } = await import('./src/RequirementBoard');
const { default: PeoplePicker } = await import('./src/RequirementPeoplePicker');
let saveAssignment: (result: any) => void;
const assignmentWrites: any[] = [];
mock.module('./src/requirement-people-api', () => ({
  listRequirementPeople: async () => [{ kind: 'user', id: 'u', name: '成员', networkId: 'a' }],
  saveRequirementAssignments: (_cfg: unknown, id: string, value: unknown) => {
    assignmentWrites.push({ id, value });
    return new Promise(resolve => { saveAssignment = resolve; });
  },
}));
const { default: AssignmentsEditor } = await import('./src/RequirementAssignmentsEditor');
const cfg = { serverUrl: 'http://isolated.test', token: 'test', networkId: 'a' };
let renderer: ReactTestRenderer;
const byId = (id: string) => renderer.root.findByProps({ testID: id });
async function mount() { requests = []; creates = []; edits = []; await act(async () => { renderer = create(<Board cfg={cfg} />); }); }
afterEach(async () => { typedCards = false; if (renderer) await act(async () => renderer.unmount()); });

test('new card binds stable owner and displays the acknowledged human name', async () => {
  await mount();
  await act(async () => byId('req-name').props.onChangeText('新需求'));
  await act(async () => byId('req-assignee').props.onPress());
  await act(async () => byId('person-user:u').props.onPress());
  await act(async () => byId('people-confirm').props.onPress());
  expect(creates).toHaveLength(0);
  await act(async () => byId('req-add').props.onPress());
  expect(creates[0].owner).toEqual({ kind: 'user', id: 'u' });
  expect(creates[0].assignee).toBe('');
  expect(JSON.stringify(byId('req-card-new').findAllByType('Text').map(node => node.props.children))).toContain('成员（人类）');
});

test('existing card can change title priority and due without writing before save', async () => {
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  expect(byId('req-edit-name').props.value).toBe('验证需求详情');
  expect(edits).toHaveLength(0);
  await act(async () => byId('req-edit-name').props.onChangeText('改过的标题'));
  await act(async () => byId('req-edit-priority-high').props.onPress());
  await act(async () => byId('req-edit-due').props.onChangeText('2026-12-01'));
  expect(edits).toHaveLength(0);
  await act(async () => byId('req-edit-save').props.onPress());
  expect(edits).toEqual([{ id: 'r1', patch: { name: '改过的标题', priority: 'high', due: '2026-12-01' } }]);
  expect(JSON.stringify(byId('req-card-r1').findAllByType('Text').map(node => node.props.children))).toContain('改过的标题');
});

test('opening and closing details never writes; explicit move waits for Hub and prevents duplicates', async () => {
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  expect(requests).toHaveLength(0);
  expect(byId('req-detail')).toBeTruthy();
  expect(byId('req-move-pool').props.disabled).toBe(true);
  await act(async () => { byId('req-move-doing').props.onPress(); byId('req-move-doing').props.onPress(); });
  expect(requests).toEqual([{ network: 'a', id: 'r1', column: 'doing' }]);
  expect(byId('req-move-done').props.disabled).toBe(true);
  await act(async () => reply({ ...card, column: 'doing' }));
  expect(byId('req-move-doing').props.accessibilityState.selected).toBe(true);
  await act(async () => byId('req-detail-close').props.onPress());
  expect(renderer.root.findAllByProps({ testID: 'req-detail' })).toHaveLength(0);
  expect(requests).toHaveLength(1);
});

test('failed move preserves state and allows a retry', async () => {
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  await act(async () => byId('req-move-done').props.onPress());
  await act(async () => reject(new HubError(403)));
  expect(byId('req-move-pool').props.accessibilityState.selected).toBe(true);
  expect(JSON.stringify(renderer.toJSON())).toContain('你没有修改这条需求的权限');
  await act(async () => byId('req-move-doing').props.onPress());
  expect(requests).toHaveLength(2);
  await act(async () => reply({ ...card, column: 'doing' }));
});

test('switching network closes old details and ignores its late mutation response', async () => {
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  await act(async () => byId('req-move-done').props.onPress());
  await act(async () => renderer.update(<Board cfg={{ ...cfg, networkId: 'b' }} />));
  expect(renderer.root.findAllByProps({ testID: 'req-detail' })).toHaveLength(0);
  await act(async () => reply({ ...card, name: '旧网络回复', column: 'done' }));
  expect(JSON.stringify(renderer.toJSON())).not.toContain('旧网络回复');
});

test('people picker separates identical user/node names, stages selection, and confirms stable references', async () => {
  const people = [
    { kind: 'user' as const, id: 'same', name: '同名', networkId: 'a' },
    { kind: 'node' as const, id: 'same', name: '同名', networkId: 'a' },
    { kind: 'node' as const, id: 'foreign', name: '其他网络', networkId: 'b' },
  ];
  const saved: any[] = [];
  await act(async () => { renderer = create(<PeoplePicker networkId="a" mode="participants" people={people} selected={[]} onConfirm={value => saved.push(value)} onClose={() => {}} />); });
  expect(renderer.root.findAllByProps({ testID: 'person-node:foreign' })).toHaveLength(0);
  await act(async () => byId('person-user:same').props.onPress());
  await act(async () => byId('person-node:same').props.onPress());
  expect(saved).toHaveLength(0);
  await act(async () => byId('people-confirm').props.onPress());
  expect(saved).toEqual([[{ kind: 'user', id: 'same' }, { kind: 'node', id: 'same' }]]);
});

test('owner picker replaces owner and cancellation never persists', async () => {
  let closed = 0;
  let saved = 0;
  const people = [{ kind: 'user' as const, id: 'u', name: '人', networkId: 'a' }, { kind: 'node' as const, id: 'n', name: 'Agent', networkId: 'a' }];
  await act(async () => { renderer = create(<PeoplePicker networkId="a" mode="owner" people={people} selected={[people[0]]} onConfirm={() => saved++} onClose={() => closed++} />); });
  await act(async () => byId('person-node:n').props.onPress());
  expect(byId('person-user:u').props.accessibilityState.checked).toBe(false);
  expect(byId('person-node:n').props.accessibilityState.checked).toBe(true);
  await act(async () => byId('people-cancel').props.onPress());
  expect(saved).toBe(0);
  expect(closed).toBe(1);
});

test('removed members cannot be silently saved', async () => {
  let saved = 0;
  await act(async () => { renderer = create(<PeoplePicker networkId="a" mode="owner" people={[]} selected={[{ kind: 'user', id: 'gone' }]} onConfirm={() => saved++} onClose={() => {}} />); });
  expect(byId('people-confirm').props.disabled).toBe(true);
  await act(async () => byId('people-confirm').props.onPress());
  expect(saved).toBe(0);
});

test('duplicate initial participants are confirmed once and include only identity fields', async () => {
  const person = { kind: 'user' as const, id: 'u', name: '成员', networkId: 'a' };
  const saved: any[] = [];
  await act(async () => { renderer = create(<PeoplePicker networkId="a" mode="participants" people={[person]} selected={[person, person]} onConfirm={value => saved.push(value)} onClose={() => {}} />); });
  await act(async () => byId('people-confirm').props.onPress());
  expect(saved).toEqual([[{ kind: 'user', id: 'u' }]]);
});

test('member removed while picker is open immediately blocks confirmation', async () => {
  const person = { kind: 'user' as const, id: 'u', name: '成员', networkId: 'a' };
  const props = { networkId: 'a', mode: 'participants' as const, selected: [], onConfirm: () => {}, onClose: () => {} };
  await act(async () => { renderer = create(<PeoplePicker {...props} people={[person]} />); });
  await act(async () => byId('person-user:u').props.onPress());
  await act(async () => renderer.update(<PeoplePicker {...props} people={[]} />));
  expect(byId('people-confirm').props.disabled).toBe(true);
});

test('changing network discards unconfirmed people selection', async () => {
  const person = { kind: 'node' as const, id: 'n', name: 'Agent', networkId: 'a' };
  const props = { mode: 'participants' as const, selected: [], onConfirm: () => {}, onClose: () => {} };
  await act(async () => { renderer = create(<PeoplePicker {...props} networkId="a" people={[person]} />); });
  await act(async () => byId('person-node:n').props.onPress());
  await act(async () => renderer.update(<PeoplePicker {...props} networkId="b" people={[{ ...person, networkId: 'b' }]} />));
  expect(byId('person-node:n').props.accessibilityState.checked).toBe(false);
});

test('late failure belongs to the original card, not newly opened details', async () => {
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  await act(async () => byId('req-move-doing').props.onPress());
  await act(async () => byId('req-detail-close').props.onPress());
  await act(async () => byId('req-card-r2').props.onPress());
  await act(async () => reject(new HubError(403)));
  expect(JSON.stringify(renderer.toJSON())).not.toContain('你没有修改这条需求的权限');
  await act(async () => byId('req-detail-close').props.onPress());
  await act(async () => byId('req-card-r1').props.onPress());
  expect(JSON.stringify(renderer.toJSON())).toContain('你没有修改这条需求的权限');
});

test('assignment editor only reports saved bindings after Hub acknowledgement', async () => {
  const saved: any[] = [];
  assignmentWrites.length = 0;
  await act(async () => { renderer = create(<AssignmentsEditor cfg={cfg} item={{ ...card, priority: 'normal', column: 'pool', owner: null, participants: [] }} onSaved={value => saved.push(value)} />); });
  await act(async () => byId('edit-owner').props.onPress());
  await act(async () => byId('person-user:u').props.onPress());
  await act(async () => byId('people-confirm').props.onPress());
  expect(saved).toHaveLength(0);
  expect(assignmentWrites).toEqual([{ id: 'r1', value: { owner: { kind: 'user', id: 'u' } } }]);
  expect(byId('edit-participants').props.disabled).toBe(true);
  await act(async () => saveAssignment({ owner: { kind: 'user', id: 'u' }, participants: [] }));
  expect(saved).toHaveLength(1);
});

test('old Hub cards show unsupported instead of a working assignment editor', async () => {
  await act(async () => { renderer = create(<AssignmentsEditor cfg={cfg} item={{ ...card, priority: 'normal', column: 'pool' }} onSaved={() => { throw new Error('must not save'); }} />); });
  expect(byId('assignments-unsupported')).toBeTruthy();
  expect(renderer.root.findAllByProps({ testID: 'edit-owner' })).toHaveLength(0);
});

test('saving after closing details updates typed owner on board and reopened detail', async () => {
  typedCards = true;
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  await act(async () => byId('edit-owner').props.onPress());
  await act(async () => byId('person-user:u').props.onPress());
  await act(async () => byId('people-confirm').props.onPress());
  await act(async () => byId('req-detail-close').props.onPress());
  await act(async () => saveAssignment({ owner: { kind: 'user', id: 'u' }, participants: [] }));
  expect(JSON.stringify(byId('req-card-r1').findAllByType('Text').map(node => node.props.children))).toContain('成员（人类）');
  await act(async () => byId('req-card-r1').props.onPress());
  expect(JSON.stringify(byId('req-detail').findAllByType('Text').map(node => node.props.children))).toContain('成员（人类）');
});
