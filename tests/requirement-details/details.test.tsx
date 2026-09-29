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
mock.module('./src/elevation', () => ({ elevated: () => ({}), shadowOnly: () => ({}), buttonStyle: () => ({}), buttonTextStyle: () => ({}), controlHeight: () => 40 }));
mock.module('./src/requirements-store', () => ({ requirementsKey: (s: string) => s, readRequirements: () => [], writeRequirements: () => {} }));
mock.module('./src/api', () => ({ fetchHubNodes: async () => ({ nodes: [] }) }));
// The picker renders AliasAvatar. The real module pulls image assets and ui-scale,
// which this isolated theme mock does not provide.
mock.module('./src/AliasAvatar', () => ({ default: () => null }));
// Description images: picking / uploading and the authed thumbnails are platform code; stub them.
let picked: any[] = [];
let uploads: any[] = [];
mock.module('./src/attach', () => ({
  pickImages: async () => picked,
  uploadImage: async (_cfg: any, img: any, opts: any) => { uploads.push({ name: img.fileName, networkId: opts?.networkId }); return { file_id: `f_${uploads.length}`, path: '/x', url: `/api/files/f_${uploads.length}`, size: 1, mime: 'image/png' }; },
}));
mock.module('./src/AuthedThumb', () => ({ default: () => null }));
mock.module('./src/AuthedWebThumb', () => ({ default: () => null }));
mock.module('./src/ImageViewer', () => ({ default: () => null }));
mock.module('./src/image-window', () => ({ openImageWindow: async () => false }));
// The detail's description preview renders MarkdownMessage (image assets, native text selection…).
mock.module('./src/MarkdownMessage', () => ({ default: ({ children }: any) => React.createElement('Text', { testID: 'markdown' }, children) }));

const card = { id: 'r1', name: '验证需求详情', assignee: '负责人甲', priority: 'normal', due: '', column: 'pool', createdAt: '' };
let typedCards = false;
let roleCards = false;
let detailCards = false;
let projectsMock: any[] | null = null;
let dueCaps = false;
let participantCards = false;
let itemWrites: any[] = [];
let requests: any[] = [];
let creates: any[] = [];
let edits: any[] = [];
let editReply: ((v: any) => any) | null = null;
let reply: (value: any) => void;
let reject: (error: Error) => void;
class HubError extends Error { constructor(public status: number, message = 'HTTP ' + status) { super(message); } }
const listRows = async () => [
    { ...card, ...(typedCards || roleCards ? { owner: null, participants: [] } : {}),
      ...(participantCards ? { owner: { kind: 'user', id: 'u' }, participants: [{ kind: 'user', id: 'u' }, { kind: 'node', id: 'n1' }, { kind: 'user', id: 'u_a4944afaa30b' }, { kind: 'node', id: 'n_e06d936d' }] } : {}), ...(roleCards ? { agentOwner: null } : {}),
      ...(projectsMock ? { projectId: 'p1' } : {}),
      ...(detailCards ? { description: '## 目标', checklist: [{ id: 'a', text: '写接口', done: false }, { id: 'b', text: '写测试', done: true }] } : {}) },
    { ...card, id: 'r2', name: '另一个需求', ...(roleCards ? { owner: null, participants: [], agentOwner: null } : {}) },
  ];
mock.module('./src/requirements-hub', () => ({
  listRequirements: async () => listRows(),
  migrateLocalRequirements: async () => {},
  probeAgentOwnerSupport: async () => roleCards,
  listProjects: async () => projectsMock,
  listRequirementsFull: async () => ({ rows: await listRows(), capabilities: dueCaps ? ['due_datetime'] : [] }),
  createProject: async () => { throw new Error('not used'); },
  updateProject: async () => { throw new Error('not used'); },
  createRequirementOnHub: async (_cfg: any, input: any) => { creates.push(input); return { ...card, ...input, id: 'new', owner: input.owner || null, participants: [], ...(roleCards ? { agentOwner: input.agentOwner || null } : {}) }; },
  updateRequirementOnHub: async (_cfg: any, id: string, patch: any) => {
    edits.push({ id, patch });
    if (editReply) return editReply(patch);
    const { agent_owner, ...rest } = patch;
    if (detailCards) return { ...card, id, description: '## 目标', checklist: [], ...rest };
    if (projectsMock) { const { project_id, ...others } = rest; return { ...card, id, ...others, owner: null, participants: [], projectId: project_id === undefined ? 'p1' : project_id }; }
    return { ...card, id, ...rest, owner: patch.owner === undefined ? null : patch.owner, participants: [], ...(roleCards ? { agentOwner: agent_owner === undefined ? null : agent_owner } : {}) };
  },
  fetchMyUserId: async () => 'u',
  setChecklistItemOnHub: async (_cfg: any, id: string, itemId: string, done: boolean) => {
    itemWrites.push({ id, itemId, done });
    return { ...card, id, description: '## 目标', checklist: [{ id: 'a', text: '写接口', done: itemId === 'a' ? done : false }, { id: 'b', text: '写测试', done: itemId === 'b' ? done : true }] };
  },
  RequirementsHubError: HubError,
  moveRequirementOnHub: (cfg: any, id: string, column: string) => {
    requests.push({ network: cfg.networkId, id, column });
    return new Promise((resolve, fail) => { reply = resolve; reject = fail; });
  },
}));
let saveAssignment: (result: any) => void;
const assignmentWrites: any[] = [];
mock.module('./src/requirement-people-api', () => ({
  listRequirementPeople: async () => [{ kind: 'user', id: 'u', name: '成员', networkId: 'a' }, { kind: 'node', id: 'n1', name: '执行节点', networkId: 'a' }],
  saveRequirementAssignments: (_cfg: unknown, id: string, value: unknown) => {
    assignmentWrites.push({ id, value });
    return new Promise(resolve => { saveAssignment = resolve; });
  },
}));
const { default: Board } = await import('./src/RequirementBoard');
const { default: PeoplePicker } = await import('./src/RequirementPeoplePicker');
const { default: AssignmentsEditor } = await import('./src/RequirementAssignmentsEditor');
const { setTaskSection } = await import('./src/task-board-store');
const { addDays, dueFromLocal, localDateOf } = await import('./src/due-time');
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
afterEach(async () => { dueCaps = false; participantCards = false; typedCards = false; roleCards = false; detailCards = false; itemWrites = []; projectsMock = null; if (renderer) await act(async () => renderer.unmount()); });

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

test('create dialog validates the title before any write; the calendar picks a date (all day)', async () => {
  await mount();
  await act(async () => byId('req-new').props.onPress());
  await act(async () => byId('req-add').props.onPress());
  expect(creates).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).toContain('先写任务标题');
  await act(async () => byId('req-name').props.onChangeText('甲'));
  // 月历:打开 → 下个月 → 点 15 号 → 确定
  await act(async () => byId('req-due').props.onPress());
  expect(byId('req-due-calendar')).toBeTruthy();
  await act(async () => byId('req-due-next').props.onPress());
  const month = String(byId('req-due-month').props.children.join(''));
  const [y, m] = month.replace('月', '').split('年').map(Number);
  const day = `${y}-${String(m).padStart(2, '0')}-15`;
  await act(async () => byId(`req-due-day-${day}`).props.onPress());
  // 旧 Hub(没有 due_datetime 能力):没有时刻那一栏,存的是全天
  expect(renderer.root.findAllByProps({ testID: 'req-due-time' })).toHaveLength(0);
  await act(async () => byId('req-due-ok').props.onPress());
  await act(async () => byId('req-add').props.onPress());
  expect(creates[0].due).toBe(day);
});

test('hub with due_datetime: the calendar has 全天 + HH:MM:SS and stores UTC to the second', async () => {
  dueCaps = true;
  await mount();
  await act(async () => byId('req-new').props.onPress());
  await act(async () => byId('req-name').props.onChangeText('带时刻'));
  await act(async () => byId('req-due').props.onPress());
  expect(byId('req-due-time')).toBeTruthy();
  const today = localDateOf(Date.now());
  await act(async () => byId(`req-due-day-${today}`).props.onPress());
  await act(async () => byId('req-due-allday').props.onPress());
  await act(async () => byId('req-due-hh').props.onChangeText('18'));
  await act(async () => byId('req-due-mm').props.onChangeText('30'));
  await act(async () => byId('req-due-ss').props.onChangeText('45'));
  await act(async () => byId('req-due-ok').props.onPress());
  await act(async () => byId('req-add').props.onPress());
  expect(creates[0].due).toBe(dueFromLocal(today, { hh: 18, mm: 30, ss: 45 }));
  expect(creates[0].due).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
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
  await act(async () => byId('req-edit-due-tomorrow').props.onPress());
  expect(edits).toHaveLength(0);
  await act(async () => byId('req-edit-save').props.onPress());
  expect(edits).toEqual([{ id: 'r1', patch: { name: '改过的标题', priority: 'high', due: addDays(localDateOf(Date.now()), 1) } }]);
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

test('two-role hub: 负责人 lists only humans, 负责 Agent only agents; both go out as {kind,id}', async () => {
  roleCards = true;
  await mount();
  await act(async () => byId('req-new').props.onPress());
  await act(async () => byId('req-name').props.onChangeText('分两个角色'));
  await act(async () => byId('req-assignee').props.onPress());
  expect(renderer.root.findAllByProps({ testID: 'person-node:n1' })).toHaveLength(0);
  await act(async () => byId('person-user:u').props.onPress());
  await act(async () => byId('people-confirm').props.onPress());
  await act(async () => byId('req-assignee-agent').props.onPress());
  expect(renderer.root.findAllByProps({ testID: 'person-user:u' })).toHaveLength(0);
  await act(async () => byId('person-node:n1').props.onPress());
  await act(async () => byId('people-confirm').props.onPress());
  await act(async () => byId('req-add').props.onPress());
  expect(creates[0].owner).toEqual({ kind: 'user', id: 'u' });
  expect(creates[0].agentOwner).toEqual({ kind: 'node', id: 'n1' });
  expect(creates[0].assignee).toBe('');
  const avatars = byId('req-card-new').findAll(n => typeof n.props.testID === 'string' && n.props.testID.startsWith('task-avatar-')).map(n => n.props.testID);
  expect([...new Set(avatars)]).toEqual(['task-avatar-owner', 'task-avatar-agent']);
});

test('two-role hub: detail changes 负责 Agent alone with 保存修改', async () => {
  roleCards = true;
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  await act(async () => byId('req-edit-owner-agent').props.onPress());
  await act(async () => byId('person-node:n1').props.onPress());
  await act(async () => byId('people-confirm').props.onPress());
  expect(edits).toHaveLength(0);
  await act(async () => byId('req-edit-save').props.onPress());
  expect(edits).toEqual([{ id: 'r1', patch: { agent_owner: { kind: 'node', id: 'n1' } } }]);
});

test('hub without agent_owner keeps the single 负责人 picker (humans and agents)', async () => {
  typedCards = true;
  await mount();
  await act(async () => byId('req-new').props.onPress());
  expect(renderer.root.findAllByProps({ testID: 'req-assignee-agent' })).toHaveLength(0);
  await act(async () => byId('req-assignee').props.onPress());
  expect(byId('person-node:n1')).toBeTruthy();
  expect(byId('person-user:u')).toBeTruthy();
});

test('description and checklist: card progress, per-item toggle, add/delete replace the list, description saves with 保存修改', async () => {
  detailCards = true;
  await mount();
  expect(texts('req-card-r1')).toContain('1');
  expect(byId('req-card-r1').findAll(n => n.props.testID === 'task-checklist-progress').length).toBeGreaterThan(0);
  await act(async () => byId('req-card-r1').props.onPress());
  expect(byId('req-description')).toBeTruthy();
  expect(JSON.stringify(byId('req-description-preview').findAllByType('Text').map(n => n.props.children))).toContain('## 目标');
  // 勾一项:单项接口,只带那一项
  await act(async () => byId('req-checklist-item-a').props.onPress());
  expect(itemWrites).toEqual([{ id: 'r1', itemId: 'a', done: true }]);
  expect(edits).toHaveLength(0);
  // 加一项:整张清单
  await act(async () => byId('req-checklist-input').props.onChangeText('发版'));
  await act(async () => byId('req-checklist-add').props.onPress());
  expect(edits[0].patch.checklist.map((i: any) => i.text)).toEqual(['写接口', '写测试', '发版']);
  expect(edits[0].patch.checklist[2].id).toMatch(/^ck_[0-9a-f]{16}$/);
  // 删一项(手机:删除按钮常驻)
  await act(async () => byId('req-checklist-delete-b').props.onPress());
  expect(edits[1].patch.checklist.map((i: any) => i.id)).not.toContain('b');
  // 描述:编辑后跟「保存修改」一起发
  await act(async () => byId('req-description-mode-edit').props.onPress());
  await act(async () => byId('req-description-input').props.onChangeText('## 目标\n- 新的验收标准'));
  await act(async () => byId('req-edit-save').props.onPress());
  expect(edits[2].patch).toEqual({ description: '## 目标\n- 新的验收标准' });
});

test('hub without description/checklist hides both sections and says to upgrade', async () => {
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  expect(byId('req-details-unsupported')).toBeTruthy();
  expect(renderer.root.findAllByProps({ testID: 'req-checklist' })).toHaveLength(0);
  expect(renderer.root.findAllByProps({ testID: 'req-description' })).toHaveLength(0);
});

test('projects: create defaults to the selected project; detail moves a card to another project', async () => {
  projectsMock = [{ id: 'p1', name: '军团项目', color: '#2563eb', sort: 0, archived: false }, { id: 'p2', name: 'TMAI', color: '#7c3aed', sort: 1, archived: false }, { id: 'p3', name: '旧', color: '#4b5563', sort: 2, archived: true }];
  const { setTaskFilter } = await import('./src/task-board-store');
  await mount();
  await act(async () => setTaskFilter({ owners: [], priorities: [], project: 'p2' }));
  await act(async () => byId('req-new').props.onPress());
  expect(byId('req-project-p2').props.accessibilityState.checked).toBe(true);
  expect(renderer.root.findAllByProps({ testID: 'req-project-p3' })).toHaveLength(0);
  await act(async () => byId('req-name').props.onChangeText('TMAI 的任务'));
  await act(async () => byId('req-add').props.onPress());
  expect(creates[0].projectId).toBe('p2');
  await act(async () => setTaskFilter({ owners: [], priorities: [], project: '' }));
  await act(async () => byId('req-card-r1').props.onPress());
  expect(byId('req-edit-project-p1').props.accessibilityState.checked).toBe(true);
  await act(async () => byId('req-edit-project-p2').props.onPress());
  await act(async () => byId('req-edit-save').props.onPress());
  expect(edits).toEqual([{ id: 'r1', patch: { project_id: 'p2' } }]);
});

test('hub without projects: no project picker, no project chip filter', async () => {
  await mount();
  expect(renderer.root.findAllByProps({ testID: 'task-filter-project' })).toHaveLength(0);
  await act(async () => byId('req-new').props.onPress());
  expect(renderer.root.findAllByProps({ testID: 'req-project-none' })).toHaveLength(0);
});

test('participants: avatar chips in detail, stack of 3 + 「+N」 on cards, unknown members never show a raw id', async () => {
  participantCards = true;
  await mount();
  const stack = byId('req-card-r1').findAll(n => n.props.testID === 'task-participant-avatar');
  expect(stack.length).toBe(3);
  expect(JSON.stringify(byId('req-card-r1').findAll(n => n.props.testID === 'task-participants-more').map(n => n.props.children))).toContain('1');
  await act(async () => byId('req-card-r1').props.onPress());
  const chips = JSON.stringify(byId('participants-chips').findAllByType('Text').map(n => n.props.children));
  expect(chips).toContain('成员');
  expect(chips).toContain('执行节点');
  expect(chips).toContain('未知成员（faa30b）');
  expect(chips).not.toContain('u_a4944afaa30b');
  expect(chips).not.toContain('n_e06d936d');
  expect(renderer.root.findAllByType('ActivityIndicator').filter(n => n.props.testID === undefined)).toHaveLength(0);
});

test('description images: 🖼 uploads with network_id and inserts ![name](/api/files/<id>) on its own line; oversize shows inline error', async () => {
  detailCards = true;
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  await act(async () => byId('req-description-mode-edit').props.onPress());
  await act(async () => byId('req-description-input').props.onSelectionChange({ nativeEvent: { selection: { start: 5, end: 5 } } }));
  picked = [{ uri: 'blob:1', fileName: '截图.png', mimeType: 'image/png', fileSize: 1000 }, { uri: 'blob:2', fileName: '大图.png', mimeType: 'image/png', fileSize: 13 * 1024 * 1024 }];
  uploads = [];
  await act(async () => { await byId('req-description-image-button').props.onPress(); });
  expect(uploads).toEqual([{ name: '截图.png', networkId: 'a' }]);
  expect(byId('req-description-input').props.value).toBe('## 目标\n![截图.png](/api/files/f_1)');
  expect(JSON.stringify(renderer.toJSON())).toContain('超过 12MB 上限');
  await act(async () => byId('req-edit-save').props.onPress());
  expect(edits[0].patch).toEqual({ description: '## 目标\n![截图.png](/api/files/f_1)' });
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
