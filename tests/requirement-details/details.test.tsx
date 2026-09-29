import { afterEach, expect, mock, test } from 'bun:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

// 组件级:手机 / 触屏分支(没有 Tauri 桥 ⇒ pointerUi() = false)。没有 onLayout ⇒ 宽度 0 ⇒ 详情是推入页(Modal)。
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
mock.module('react-native', () => ({
  View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Modal: ({ visible, children }: any) => visible ? children : null,
  StyleSheet: { create: (styles: any) => styles, hairlineWidth: 1, absoluteFill: {} },
  Platform: { OS: 'android', select: (o: any) => o.android ?? o.default },
  AppState: { addEventListener: () => ({ remove() {} }), currentState: 'active' },
  useWindowDimensions: () => ({ width: 390, height: 844, scale: 1, fontScale: 1 }),
}));
mock.module('./src/ui-text', () => ({ Text: 'Text', TextInput: 'TextInput' }));
mock.module('./src/icons', () => ({ Ionicons: () => null }));
mock.module('./src/ui-scale', () => ({ uiScale: () => ({ densityFactor: 1, denseFontMultiplier: 1, fontMultiplier: 1 }), ds: (n: number) => n }));
mock.module('./src/safe-area-runtime', () => ({ useModalSafePadding: () => ({ paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 }) }));
mock.module('./src/theme', () => ({
  colors: {}, onThemeChange: () => () => {}, themeMode: () => 'light',
  radius: { inline: 2, mark: 4, item: 8, control: 12, thumb: 12, surface: 16, bubble: 18, pill: 999, sm: 8, md: 12, lg: 16 },
  avatarRadius: () => 999, spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  type: { caption: 11, small: 12, body: 14, title: 16, heading: 20 }, weight: { regular: '400', medium: '500', strong: '600' },
}));
// elevation.ts reads tokens this isolated theme mock does not carry (ELEVATION, CONTROL_HEIGHT, …).
mock.module('./src/elevation', () => ({ elevated: () => ({}), buttonStyle: () => ({}), buttonTextStyle: () => ({}), controlHeight: () => 40 }));
mock.module('./src/requirements-store', () => ({ requirementsKey: (s: string) => s, readRequirements: () => [], writeRequirements: () => {} }));
mock.module('./src/api', () => ({ fetchHubNodes: async () => ({ nodes: [] }) }));
// The picker renders AliasAvatar. The real module pulls image assets and ui-scale,
// which this isolated theme mock does not provide.
mock.module('./src/AliasAvatar', () => ({ default: () => null }));

const card = { id: 'r1', name: '验证需求详情', assignee: '负责人甲', priority: 'normal', due: '', column: 'pool', createdAt: '' };
let typedCards = false;
let requests: any[] = [];
let creates: any[] = [];
let edits: any[] = [];
let editReply: ((v: any) => any) | null = null;
let reply: (value: any) => void;
let reject: (error: Error) => void;
class HubError extends Error { constructor(public status: number, message = 'HTTP ' + status) { super(message); } }
mock.module('./src/requirements-hub', () => ({
  listRequirements: async () => [{ ...card, ...(typedCards ? { owner: null, participants: [] } : {}) }, { ...card, id: 'r2', name: '另一个需求' }], migrateLocalRequirements: async () => {},
  createRequirementOnHub: async (_cfg: any, input: any) => { creates.push(input); return { ...card, ...input, id: 'new', owner: input.owner || null, participants: [] }; },
  updateRequirementOnHub: async (_cfg: any, id: string, patch: any) => {
    edits.push({ id, patch });
    if (editReply) return editReply(patch);
    return { ...card, id, ...patch, owner: patch.owner === undefined ? null : patch.owner, participants: [] };
  },
  fetchMyUserId: async () => 'u',
  RequirementsHubError: HubError,
  moveRequirementOnHub: (cfg: any, id: string, column: string) => {
    requests.push({ network: cfg.networkId, id, column });
    return new Promise((resolve, fail) => { reply = resolve; reject = fail; });
  },
}));
let saveAssignment: (result: any) => void;
const assignmentWrites: any[] = [];
mock.module('./src/requirement-people-api', () => ({
  listRequirementPeople: async () => [{ kind: 'user', id: 'u', name: '成员', networkId: 'a' }],
  saveRequirementAssignments: (_cfg: unknown, id: string, value: unknown) => {
    assignmentWrites.push({ id, value });
    return new Promise(resolve => { saveAssignment = resolve; });
  },
}));
const { default: Board } = await import('./src/RequirementBoard');
const { default: PeoplePicker } = await import('./src/RequirementPeoplePicker');
const { default: AssignmentsEditor } = await import('./src/RequirementAssignmentsEditor');
const { setTaskSection } = await import('./src/task-board-store');
// 每个用例一个新 token ⇒ 新的看板作用域(共享 store 不串用例)。
let seq = 0;
let cfg = { serverUrl: 'http://isolated.test', token: 'test', networkId: 'a' };
let renderer: ReactTestRenderer;
const byId = (id: string) => renderer.root.findByProps({ testID: id });
const texts = (id: string) => JSON.stringify(byId(id).findAllByType('Text').map(node => node.props.children));
async function mount() {
  requests = []; creates = []; edits = []; editReply = null;
  cfg = { ...cfg, token: `test-${++seq}` };
  setTaskSection('board');
  await act(async () => { renderer = create(<Board cfg={cfg} />); });
}
afterEach(async () => { typedCards = false; if (renderer) await act(async () => renderer.unmount()); });

test('header has no permanent inputs or dev note; 新建 opens the dialog', async () => {
  await mount();
  expect(renderer.root.findAllByProps({ testID: 'req-name' })).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).not.toContain('存在 Hub 上');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('查看详情');
  await act(async () => byId('req-new').props.onPress());
  expect(byId('req-create')).toBeTruthy();
  expect(byId('req-name').props.autoFocus).toBe(true);
});

test('new card binds stable owner {kind,id}, keeps assignee empty and shows the owner name', async () => {
  await mount();
  await act(async () => byId('req-new').props.onPress());
  await act(async () => byId('req-name').props.onChangeText('新需求'));
  await act(async () => byId('req-assignee').props.onPress());
  await act(async () => byId('person-user:u').props.onPress());
  await act(async () => byId('people-confirm').props.onPress());
  expect(creates).toHaveLength(0);
  await act(async () => byId('req-add').props.onPress());
  expect(creates[0].owner).toEqual({ kind: 'user', id: 'u' });
  expect(creates[0].assignee).toBe('');
  expect(renderer.root.findAllByProps({ testID: 'req-create' })).toHaveLength(0);
  expect(texts('req-card-new')).toContain('成员');
});

test('create dialog validates title and date before any write', async () => {
  await mount();
  await act(async () => byId('req-new').props.onPress());
  await act(async () => byId('req-add').props.onPress());
  expect(creates).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).toContain('先写任务标题');
  await act(async () => byId('req-name').props.onChangeText('甲'));
  await act(async () => byId('req-due').props.onChangeText('2026-02-30'));
  await act(async () => byId('req-add').props.onPress());
  expect(creates).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).toContain('日期写成 2026-10-01');
});

test('column quick-add creates in that column (touch: through the dialog)', async () => {
  await mount();
  await act(async () => byId('req-quick-add-doing').props.onPress());
  await act(async () => byId('req-name').props.onChangeText('进行中的新任务'));
  await act(async () => byId('req-add').props.onPress());
  expect(creates[0].column).toBe('doing');
});

test('opening and closing details never writes; explicit move waits for Hub, counts move at once, no duplicates', async () => {
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  expect(requests).toHaveLength(0);
  expect(byId('req-detail')).toBeTruthy();
  expect(byId('req-move-pool').props.disabled).toBe(true);
  await act(async () => { byId('req-move-doing').props.onPress(); byId('req-move-doing').props.onPress(); });
  expect(requests).toEqual([{ network: 'a', id: 'r1', column: 'doing' }]);
  expect(byId('req-move-done').props.disabled).toBe(true);
  expect(texts('req-count-doing')).toContain('1');
  expect(texts('req-count-pool')).toContain('1');
  await act(async () => reply({ ...card, column: 'doing' }));
  expect(byId('req-move-doing').props.accessibilityState.selected).toBe(true);
  await act(async () => byId('req-detail-close').props.onPress());
  expect(renderer.root.findAllByProps({ testID: 'req-detail' })).toHaveLength(0);
  expect(requests).toHaveLength(1);
});

test('failed move reverts the card and allows a retry', async () => {
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  await act(async () => byId('req-move-done').props.onPress());
  await act(async () => reject(new HubError(403)));
  expect(byId('req-move-pool').props.accessibilityState.selected).toBe(true);
  expect(texts('req-count-done')).toContain('0');
  expect(JSON.stringify(renderer.toJSON())).toContain('你没有修改这条需求的权限');
  await act(async () => byId('req-move-doing').props.onPress());
  expect(requests).toHaveLength(2);
  await act(async () => reply({ ...card, column: 'doing' }));
});

test('phone long-press menu moves a card without opening details', async () => {
  await mount();
  expect(byId('req-card-r2').props.onLongPress).toBeDefined();
  await act(async () => byId('req-card-r2').props.onLongPress({ nativeEvent: { pageX: 100, pageY: 200 } }));
  expect(byId('task-menu')).toBeTruthy();
  expect(byId('task-menu-move-pool').props.disabled).toBe(true);
  await act(async () => byId('task-menu-move-done').props.onPress());
  expect(requests).toEqual([{ network: 'a', id: 'r2', column: 'done' }]);
  expect(renderer.root.findAllByProps({ testID: 'req-detail' })).toHaveLength(0);
  expect(texts('req-count-done')).toContain('1');
  await act(async () => reply({ ...card, id: 'r2', name: '另一个需求', column: 'done' }));
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

test('existing card can change title, priority and due; nothing is written before 保存修改 and only changed fields go', async () => {
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  expect(byId('req-edit-name').props.value).toBe('验证需求详情');
  expect(byId('req-edit-save').props.disabled).toBe(true);
  await act(async () => byId('req-edit-name').props.onChangeText('改过的标题'));
  await act(async () => byId('req-edit-priority-high').props.onPress());
  await act(async () => byId('req-edit-due').props.onChangeText('2026-12-01'));
  expect(edits).toHaveLength(0);
  await act(async () => byId('req-edit-save').props.onPress());
  expect(edits).toEqual([{ id: 'r1', patch: { name: '改过的标题', priority: 'high', due: '2026-12-01' } }]);
  expect(texts('req-card-r1')).toContain('改过的标题');
});

test('an old Hub that cannot edit keeps the draft and says so', async () => {
  await mount();
  editReply = () => { throw new HubError(400, '这个 Hub 还不能修改已有需求的内容，升级 Hub 后再试'); };
  await act(async () => byId('req-card-r1').props.onPress());
  await act(async () => byId('req-edit-name').props.onChangeText('新标题'));
  await act(async () => byId('req-edit-save').props.onPress());
  expect(JSON.stringify(renderer.toJSON())).toContain('这个 Hub 还不能修改已有需求的内容');
  expect(byId('req-edit-name').props.value).toBe('新标题');
  expect(texts('req-card-r1')).not.toContain('新标题');
  // 旧 Hub(没有稳定负责人)不给负责人选择器
  expect(byId('req-owner-unsupported')).toBeTruthy();
});

test('owner changed in details is saved as {kind,id} with 保存修改 and shows on the card', async () => {
  typedCards = true;
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  await act(async () => byId('req-edit-owner').props.onPress());
  await act(async () => byId('person-user:u').props.onPress());
  await act(async () => byId('people-confirm').props.onPress());
  expect(edits).toHaveLength(0);
  await act(async () => byId('req-edit-save').props.onPress());
  expect(edits).toEqual([{ id: 'r1', patch: { owner: { kind: 'user', id: 'u' } } }]);
  await act(async () => byId('req-detail-close').props.onPress());
  expect(texts('req-card-r1')).toContain('成员');
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
  expect(JSON.stringify(byId('req-detail').findAllByType('Text').map(n => n.props.children))).not.toContain('你没有修改这条需求的权限');
  await act(async () => byId('req-detail-close').props.onPress());
  await act(async () => byId('req-card-r1').props.onPress());
  expect(JSON.stringify(byId('req-detail').findAllByType('Text').map(n => n.props.children))).toContain('你没有修改这条需求的权限');
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

test('details only edit participants through the assignment editor (owner lives in the draft)', async () => {
  await act(async () => { renderer = create(<AssignmentsEditor cfg={cfg} fields="participants" item={{ ...card, priority: 'normal', column: 'pool', owner: null, participants: [] }} onSaved={() => {}} />); });
  expect(renderer.root.findAllByProps({ testID: 'edit-owner' })).toHaveLength(0);
  expect(byId('edit-participants')).toBeTruthy();
});

test('old Hub cards show unsupported instead of a working assignment editor', async () => {
  await act(async () => { renderer = create(<AssignmentsEditor cfg={cfg} item={{ ...card, priority: 'normal', column: 'pool' }} onSaved={() => { throw new Error('must not save'); }} />); });
  expect(byId('assignments-unsupported')).toBeTruthy();
  expect(renderer.root.findAllByProps({ testID: 'edit-owner' })).toHaveLength(0);
});
