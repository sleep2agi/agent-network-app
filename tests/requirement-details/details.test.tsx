import { afterEach, expect, mock, test } from 'bun:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { setLanguagePreference } from './src/i18n';
// Existing component assertions deliberately exercise the Chinese UI.
setLanguagePreference('zh');

// 组件级:手机 / 触屏分支(没有 Tauri 桥 ⇒ pointerUi() = false)。没有 onLayout ⇒ 宽度 0 ⇒ 详情是推入页(Modal)。
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
mock.module('react-native', () => ({
  View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator', Image: 'Image', PixelRatio: { get: () => 2 },
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Keyboard: { addListener: () => ({ remove() {} }), dismiss() {} },
  Modal: ({ visible, children }: any) => visible ? children : null,
  StyleSheet: { create: (styles: any) => styles, hairlineWidth: 1, absoluteFill: {} },
  Platform: { OS: 'android', select: (o: any) => o.android ?? o.default },
  AppState: { addEventListener: () => ({ remove() {} }), currentState: 'active' },
  useWindowDimensions: () => ({ width: 390, height: 844, scale: 1, fontScale: 1 }),
  // 手机行的左滑(TaskSwipeRow):手势本身由 drive.mjs 在浏览器里拖;这里直接调 onOpenChange 打开。
  PanResponder: { create: () => ({ panHandlers: {} }) },
}));
mock.module('./src/ui-text', () => ({ Text: 'Text', TextInput: 'TextInput' }));
mock.module('./src/icons', () => ({ Ionicons: () => null }));
// 镜像里没装 expo-clipboard(只装 react):桩成记录写入内容,详情头的 ID 复制在这里断言。
const copied: string[] = [];
mock.module('expo-clipboard', () => ({ setStringAsync: async (text: string) => { copied.push(text); return true; } }));
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
mock.module('./src/open-external', () => ({ openExternal: async (url: string) => { opened.push(url); return true; } }));
// The detail's description preview renders MarkdownMessage (image assets, native text selection…).
mock.module('./src/MarkdownMessage', () => ({ default: ({ children }: any) => React.createElement('Text', { testID: 'markdown' }, children) }));
// Description voice input: recording / ASR are platform code. The stub records the insert callback so a test can
// play a recognition result; `voiceAvailable` switches the platform support on and off.
let voiceAvailable = false;
let voiceInsert: ((text: string) => void) | null = null;
let voicePresses = 0;
mock.module('./src/useVoiceInput', () => ({
  useVoiceInput: (opts: any) => {
    voiceInsert = opts.onInsert;
    return {
      available: voiceAvailable, configured: true, state: { phase: 'idle' }, level: 0, elapsedMs: 0, interim: '', settingsPrompt: false, dismissSettingsPrompt() {},
      micHandlers: { onStartShouldSetResponder: () => true, onMoveShouldSetResponder: () => false, onResponderTerminationRequest: () => false, onResponderGrant: () => { voicePresses++; }, onResponderMove() {}, onResponderRelease() {}, onResponderTerminate() {} },
    };
  },
}));
mock.module('./src/VoiceInputUI', () => ({
  VoiceHoldBar: ({ handlers }: any) => React.createElement('View', { testID: 'voice-hold-bar', ...handlers }),
  VoiceHoldOverlay: () => null,
  VoiceSettingsPrompt: () => null,
}));
mock.module('./src/DesktopVoiceBar', () => ({ DesktopMicButton: () => React.createElement('View', { testID: 'voice-mic' }), DesktopVoiceBar: () => null }));
mock.module('./src/SplitEditorParts', () => ({ FocusRing: 'Pressable', ModeToggle: () => null, SplitDivider: () => null, useDebounced: (v: any) => v, prefersReducedMotion: () => false, EDITOR_BTN_HEIGHT: 30, EditorHeaderButton: () => null }));
// 「更多」展开状态(本机偏好,expo-file-system):默认按「上次展开过」,老用例照旧能点到里面的字段;
// 渐进展开的用例把它设成没存过(null = 收起)。
let moreStored: boolean | null = true;
const moreSaves: boolean[] = [];
mock.module('./src/task-detail-prefs', () => ({ loadDetailMoreOpen: async () => moreStored, saveDetailMoreOpen: async (v: boolean) => { moreSaves.push(v); } }));
mock.module('./src/mac-title-strip', () => ({ default: () => null }));
mock.module('./src/win-title-bar', () => ({ default: () => null }));

const card = { id: 'r1', name: '验证需求详情', assignee: '负责人甲', priority: 'normal', due: '', column: 'pool', createdAt: '' };
let typedCards = false;
let roleCards = false;
let detailCards = false;
let projectsMock: any[] | null = null;
let dueCaps = false;
let tagCaps = false;
let participantCards = false;
let subCards = false;
let opened: string[] = [];
let itemWrites: any[] = [];
let requests: any[] = [];
let creates: any[] = [];
let edits: any[] = [];
let editReply: ((v: any) => any) | null = null;
let reply: (value: any) => void;
let reject: (error: Error) => void;
class HubError extends Error { constructor(public status: number, message = 'HTTP ' + status) { super(message); } }
const listRows = async () => subCards ? [
    { ...card, owner: null, participants: [], parentId: null, children: { total: 2, done: 1 }, externalRef: 'github:acme/widgets#7', externalUrl: 'https://github.com/acme/widgets/issues/7' },
    { ...card, id: 'r2', name: '子需求甲', owner: null, participants: [], parentId: 'r1', column: 'done' },
    { ...card, id: 'r3', name: '子需求乙', owner: null, participants: [], parentId: 'r1', column: 'doing' },
  ] : [
    { ...card, ...(typedCards || roleCards ? { owner: null, participants: [] } : {}),
      ...(participantCards ? { owner: { kind: 'user', id: 'u' }, participants: [{ kind: 'user', id: 'u' }, { kind: 'node', id: 'n1' }, { kind: 'user', id: 'u_a4944afaa30b' }, { kind: 'node', id: 'n_e06d936d' }] } : {}), ...(roleCards ? { agentOwner: null } : {}),
      ...(projectsMock ? { projectId: 'p1' } : {}),
      ...(detailCards ? { description: '## 目标', checklist: [{ id: 'a', text: '写接口', done: false }, { id: 'b', text: '写测试', done: true }] } : {}) },
    { ...card, id: 'r2', name: '另一个需求', ...(roleCards ? { owner: null, participants: [], agentOwner: null } : {}) },
  ];
mock.module('./src/requirements-hub', () => ({
  listRequirements: async () => listRows(),
  // 任务搜索「包含已归档」(task-search.ts,默认开):这里的 Hub 没有 archived 能力,不会读;读到也当没有归档的卡。
  listArchivedRequirements: async () => [],
  // 服务端搜索(Hub capability search):这里的 Hub 没有 search,不会被调用。
  searchRequirementsOnHub: async () => ({ rows: [], next: null }),
  // 仪表盘(TaskDashboard.tsx):这里的用例不切到仪表盘,不会被调用。
  listAllRequirementsForDashboard: async () => ({ rows: await listRows(), partial: false }),
  fetchRequirementStats: async () => { throw new Error('not used'); },
  // 动态(TaskActivity.tsx,Hub capability events):这里的 Hub 不声明 events,不出这个视图,不会被调用。
  fetchRequirementEvents: async () => { throw new Error('this Hub does not advertise events'); },
  getRequirementOnHub: async () => null,
  // 增量读(Hub capability changes,board-sync.ts):这里的 Hub 不声明 list_summary / changes,看板只整读。
  // 这个模块被整个替换,RequirementBoard 导入的每个名字都要在这里有一份,否则整个文件在导入时就 SyntaxError。
  listRequirementChanges: async () => { throw new Error('this Hub does not advertise changes'); },
  migrateLocalRequirements: async () => {},
  probeAgentOwnerSupport: async () => roleCards,
  listProjects: async () => projectsMock,
  listRequirementsFull: async () => ({ rows: await listRows(), capabilities: [...(dueCaps ? ['due_datetime'] : []), ...(tagCaps ? ['tags'] : [])] }),
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
  // 归档 / 恢复(任务页审计 H2)。这个套件的看板没有 archived capability,入口不出现;只要导出在,模块加载不报错。
  setRequirementArchivedOnHub: async (_cfg: any, id: string, archived: boolean) => { edits.push({ id, patch: { archived } }); return { ...card, id, ...(archived ? { archived: true } : {}) }; },
  setChecklistItemOnHub: async (_cfg: any, id: string, itemId: string, done: boolean) => {
    itemWrites.push({ id, itemId, done });
    return { ...card, id, description: '## 目标', checklist: [{ id: 'a', text: '写接口', done: itemId === 'a' ? done : false }, { id: 'b', text: '写测试', done: itemId === 'b' ? done : true }] };
  },
  RequirementsHubError: HubError,
  PARENT_TOO_DEEP: '子任务最多 5 层',
  PARENT_REJECTED: '不能挂到这个母任务下(会形成循环,或它已不存在)',
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
const { default: IssueBindings } = await import('./src/TaskIssueBindings');
const { setTaskSection } = await import('./src/task-board-store');
const { addDays, dueFromLocal, localDateOf } = await import('./src/due-time');
// 每个用例一个新 token ⇒ 新的看板作用域(共享 store 不串用例)。
let seq = 0;
let cfg = { serverUrl: 'http://isolated.test', token: 'test', networkId: 'a' };
let renderer: ReactTestRenderer;
const byId = (id: string) => renderer.root.findByProps({ testID: id });
// The pressable host under a component that forwards the same testID (SelectField → Pressable).
const pressable = (id: string) => renderer.root.findAll(n => n.props.testID === id && typeof n.props.onPress === 'function')[0];
const texts = (id: string) => JSON.stringify(byId(id).findAllByType('Text').map(node => node.props.children));
async function mount() {
  requests = []; creates = []; edits = []; editReply = null;
  cfg = { ...cfg, token: `test-${++seq}` };
  setTaskSection('board');
  await act(async () => { renderer = create(<Board cfg={cfg} />); });
}
afterEach(async () => { moreStored = true; moreSaves.length = 0; voiceAvailable = false; voiceInsert = null; voicePresses = 0; dueCaps = false; tagCaps = false; participantCards = false; subCards = false; opened = []; typedCards = false; roleCards = false; detailCards = false; itemWrites = []; projectsMock = null; if (renderer) await act(async () => renderer.unmount()); });

test('issue links: canonical PATCH only, duplicate click lock, rejection stays local, source read-only', async () => {
  const writes: any[]=[];
  let finish: (result: string|null)=>void = () => {};
  const item={...card,column:'pool' as const,priority:'normal' as const,issues:[{repo:'acme/repo',number:7,title:'keep title'}],externalUrl:'https://github.com/acme/source/issues/9',externalRef:'github:acme/source#9'};
  const save=(patch:any)=>{writes.push(patch);return new Promise<string|null>(r=>{finish=r;});};
  await act(async()=>{renderer=create(<IssueBindings item={item} onSave={save}/>);});
  await act(async()=>byId('req-issue-link-0').props.onPress());
  expect(opened).toEqual(['https://github.com/acme/repo/issues/7']);
  await act(async()=>byId('req-issue-add').props.onPress());
  await act(async()=>byId('req-issue-input').props.onChangeText('javascript:alert(1)'));
  await act(async()=>byId('req-issue-confirm').props.onPress());
  expect(writes).toHaveLength(0);
  await act(async()=>byId('req-issue-input').props.onChangeText('acme/repo#8'));
  await act(async()=>{byId('req-issue-confirm').props.onPress();byId('req-issue-confirm').props.onPress();});
  expect(writes).toEqual([{issues:[{url:'https://github.com/acme/repo/issues/7',title:'keep title'},{url:'https://github.com/acme/repo/issues/8',title:''}]}]);
  await act(async()=>finish('invalid_issues'));
  expect(texts('req-issue-error')).toContain('invalid_issues');
  expect(byId('req-issue-input').props.value).toBe('acme/repo#8');
  expect(byId('req-issue-link-0')).toBeTruthy();
  await act(async()=>byId('req-issue-remove-0').props.onPress());
  expect(writes[1]).toEqual({issues:[]});
  await act(async()=>finish(null));
  expect(byId('req-issue-source-link')).toBeTruthy();
  expect(renderer.root.findAllByProps({testID:'req-issue-source-remove'})).toHaveLength(0);
});

test('issue editor: old Hub is read-only; switching cards drops old request error', async () => {
 const save=()=>new Promise<string|null>(r=>{reply=r;});
 const item={...card,column:'pool' as const,priority:'normal' as const,issues:[]};
 await act(async()=>{renderer=create(<IssueBindings key="a" item={item} onSave={save}/>);});
 await act(async()=>byId('req-issue-add').props.onPress());
 await act(async()=>byId('req-issue-input').props.onChangeText('a/b#1'));
 await act(async()=>byId('req-issue-confirm').props.onPress());
 await act(async()=>renderer.update(<IssueBindings key="b" item={{...item,id:'b',issues:undefined}} onSave={save}/>));
 await act(async()=>reply('invalid_issues'));
 expect(renderer.root.findAllByProps({testID:'req-issue-error'})).toHaveLength(0);
 expect(renderer.root.findAllByProps({testID:'req-issue-add'})).toHaveLength(0);
});

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

test('create dialog tags: a tags hub gets the field and the POST carries them; an old hub has no field and no tags key', async () => {
  await mount();
  await act(async () => byId('req-new').props.onPress());
  expect(renderer.root.findAllByProps({ testID: 'req-create-tags' })).toHaveLength(0);
  await act(async () => byId('req-name').props.onChangeText('旧 Hub'));
  await act(async () => byId('req-add').props.onPress());
  expect('tags' in creates[0]).toBe(false);
  await act(async () => renderer.unmount());
  creates.length = 0;
  tagCaps = true;
  await mount();
  await act(async () => byId('req-new').props.onPress());
  expect(byId('req-create-tags')).toBeTruthy();
  await act(async () => byId('req-name').props.onChangeText('带标签'));
  await act(async () => byId('req-create-tag-input').props.onChangeText(' UI '));
  await act(async () => byId('req-create-tag-add').props.onPress());
  await act(async () => byId('req-create-tag-input').props.onChangeText('交互'));
  await act(async () => byId('req-create-tag-input').props.onSubmitEditing());
  expect(byId('req-create-tag-UI')).toBeTruthy();
  // 点 × 去掉,再加回来:去重、保序
  await act(async () => byId('req-create-tag-UI').props.onPress());
  await act(async () => byId('req-create-tag-input').props.onChangeText('UI'));
  await act(async () => byId('req-create-tag-add').props.onPress());
  await act(async () => byId('req-add').props.onPress());
  expect(creates[0].tags).toEqual(['交互', 'UI']);
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

test('phone long-press menu 改状态… moves a card without opening details', async () => {
  await mount();
  expect(byId('req-card-r2').props.onLongPress).toBeDefined();
  await act(async () => byId('req-card-r2').props.onLongPress({ nativeEvent: { pageX: 100, pageY: 200 } }));
  expect(byId('task-menu')).toBeTruthy();
  // 手机菜单:三个「移到」换成「改状态…」「改优先级…」两个选择器。
  expect(renderer.root.findAllByProps({ testID: 'task-menu-move-done' })).toHaveLength(0);
  expect(byId('task-menu-priority').props.disabled).toBe(false);
  await act(async () => byId('task-menu-status').props.onPress());
  await act(async () => byId('quick-status-opt-done').props.onPress());
  expect(requests).toEqual([{ network: 'a', id: 'r2', column: 'done' }]);
  expect(renderer.root.findAllByProps({ testID: 'req-detail' })).toHaveLength(0);
  expect(texts('req-count-done')).toContain('1');
  await act(async () => reply({ ...card, id: 'r2', name: '另一个需求', column: 'done' }));
});

test('phone swipe 完成 saves {column} at once; undo puts it back', async () => {
  await mount();
  const row = renderer.root.find((n: any) => n.props.id === 'r2' && typeof n.props.onOpenChange === 'function');
  expect(row.props.actions).toEqual(['doing', 'done', 'more']);
  await act(async () => row.props.onOpenChange(true));
  await act(async () => byId('task-swipe-done-r2').props.onPress({ nativeEvent: { pageX: 300, pageY: 200 } }));
  expect(requests).toEqual([{ network: 'a', id: 'r2', column: 'done' }]);
  expect(renderer.root.findAllByProps({ testID: 'req-detail' })).toHaveLength(0);
  expect(texts('quick-undo')).toContain('已移到「完成」');
  await act(async () => reply({ ...card, id: 'r2', name: '另一个需求', column: 'done' }));
  await act(async () => byId('quick-undo-button').props.onPress());
  expect(requests).toEqual([{ network: 'a', id: 'r2', column: 'done' }, { network: 'a', id: 'r2', column: 'pool' }]);
  expect(renderer.root.findAllByProps({ testID: 'quick-undo' })).toHaveLength(0);
  await act(async () => reply({ ...card, id: 'r2', name: '另一个需求', column: 'pool' }));
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

test('existing card: priority and due save at once (one field each, like status / owner); the title waits for 保存修改', async () => {
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  expect(byId('req-edit-name').props.value).toBe('验证需求详情');
  expect(byId('req-edit-save').props.disabled).toBe(true);
  await act(async () => byId('req-edit-name').props.onChangeText('改过的标题'));
  expect(edits).toHaveLength(0);
  await act(async () => byId('req-edit-priority-high').props.onPress());
  await act(async () => byId('req-edit-due-tomorrow').props.onPress());
  expect(edits).toEqual([
    { id: 'r1', patch: { priority: 'high' } },
    { id: 'r1', patch: { due: addDays(localDateOf(Date.now()), 1) } },
  ]);
  // the typed title is still a draft and is the only thing 保存修改 sends
  expect(byId('req-edit-save').props.disabled).toBe(false);
  await act(async () => byId('req-edit-save').props.onPress());
  expect(edits[2]).toEqual({ id: 'r1', patch: { name: '改过的标题' } });
  expect(texts('req-card-r1')).toContain('改过的标题');
});

test('closing the detail with an unsaved title saves it first instead of dropping it', async () => {
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  await act(async () => byId('req-edit-name').props.onChangeText('关之前改的标题'));
  await act(async () => byId('req-detail-close').props.onPress());
  expect(edits).toEqual([{ id: 'r1', patch: { name: '关之前改的标题' } }]);
  expect(renderer.root.findAllByProps({ testID: 'req-detail' })).toHaveLength(0);
  expect(texts('req-card-r1')).toContain('关之前改的标题');
});

test('switching to another card saves the first card\'s unsaved title (by its own id) instead of dropping it', async () => {
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  await act(async () => byId('req-edit-name').props.onChangeText('换卡之前改的标题'));
  await act(async () => byId('req-card-r2').props.onPress());
  expect(edits).toEqual([{ id: 'r1', patch: { name: '换卡之前改的标题' } }]);
  expect(texts('req-card-r1')).toContain('换卡之前改的标题');
  // the detail now shows r2 with its own, untouched draft — and closing it sends nothing more
  expect(byId('req-edit-name').props.value).not.toBe('换卡之前改的标题');
  await act(async () => byId('req-detail-close').props.onPress());
  expect(edits).toHaveLength(1);
});

test('a title saved with 保存修改 and then closed is not sent a second time', async () => {
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  await act(async () => byId('req-edit-name').props.onChangeText('只发一次'));
  await act(async () => byId('req-edit-save').props.onPress());
  await act(async () => byId('req-detail-close').props.onPress());
  expect(edits).toEqual([{ id: 'r1', patch: { name: '只发一次' } }]);
});

test('closing with a title the Hub rejects keeps the detail open and says why', async () => {
  await mount();
  editReply = () => { throw new HubError(400, '这个 Hub 还不能修改已有需求的内容，升级 Hub 后再试'); };
  await act(async () => byId('req-card-r1').props.onPress());
  await act(async () => byId('req-edit-name').props.onChangeText('存不上的标题'));
  await act(async () => byId('req-detail-close').props.onPress());
  expect(renderer.root.findAllByProps({ testID: 'req-detail' }).length).toBeGreaterThan(0);
  expect(JSON.stringify(renderer.toJSON())).toContain('这个 Hub 还不能修改已有需求的内容');
  editReply = null;
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

test('owner changed in details saves immediately as {kind,id} (like participants), no 保存修改, and shows on the card', async () => {
  typedCards = true;
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  await act(async () => byId('req-edit-owner').props.onPress());
  await act(async () => byId('person-user:u').props.onPress());
  await act(async () => byId('people-confirm').props.onPress());
  expect(edits).toEqual([{ id: 'r1', patch: { owner: { kind: 'user', id: 'u' } } }]);
  expect(texts('req-assign-status')).toContain('已保存');
  // The draft never carries the owner: 保存修改 stays disabled, nothing is sent twice.
  expect(byId('req-edit-save').props.disabled).toBe(true);
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

test('two-role hub: detail changes 负责 Agent alone, immediately', async () => {
  roleCards = true;
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  await act(async () => byId('req-edit-owner-agent').props.onPress());
  await act(async () => byId('person-node:n1').props.onPress());
  await act(async () => byId('people-confirm').props.onPress());
  expect(edits).toEqual([{ id: 'r1', patch: { agent_owner: { kind: 'node', id: 'n1' } } }]);
  expect(byId('req-edit-save').props.disabled).toBe(true);
});

test('owner save failure in details reverts the card and says why; title draft is untouched', async () => {
  typedCards = true;
  await mount();
  editReply = () => { throw new HubError(400, '这个负责人已不在当前网络'); };
  await act(async () => byId('req-card-r1').props.onPress());
  await act(async () => byId('req-edit-name').props.onChangeText('草稿标题'));
  await act(async () => byId('req-edit-owner').props.onPress());
  await act(async () => byId('person-user:u').props.onPress());
  await act(async () => byId('people-confirm').props.onPress());
  expect(edits).toEqual([{ id: 'r1', patch: { owner: { kind: 'user', id: 'u' } } }]);
  expect(texts('req-assign-error')).toContain('这个负责人已不在当前网络');
  expect(byId('req-edit-name').props.value).toBe('草稿标题');
  expect(texts('req-card-r1')).not.toContain('成员');
});

test('board card menu: 指派负责人… / 设置参与人… save immediately with only that field', async () => {
  participantCards = true;
  await mount();
  // 参与人:只列人类;Agent 参与人原样保留,体里只有 participants。
  await act(async () => byId('req-card-r1').props.onLongPress({ nativeEvent: { pageX: 10, pageY: 10 } }));
  expect(byId('task-menu-assign-participants').props.disabled).toBeFalsy();
  await act(async () => byId('task-menu-assign-participants').props.onPress());
  expect(renderer.root.findAllByProps({ testID: 'person-node:n1' })).toHaveLength(0);
  await act(async () => byId('person-user:u').props.onPress());
  // 已离开网络的成员挡住保存,点那一行移除(选择器原有行为)。
  const gone = renderer.root.findAll(n => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function' && JSON.stringify(n.findAllByType('Text').map(t => t.props.children)).includes('u_a4944afaa30b'))[0];
  await act(async () => gone.props.onPress());
  await act(async () => byId('people-confirm').props.onPress());
  expect(assignmentWrites.at(-1)).toEqual({ id: 'r1', value: { participants: [{ kind: 'node', id: 'n1' }, { kind: 'node', id: 'n_e06d936d' }] } });
  await act(async () => byId('req-card-r1').props.onLongPress({ nativeEvent: { pageX: 10, pageY: 10 } }));
  await act(async () => byId('task-menu-assign-owner').props.onPress());
  await act(async () => byId('person-user:u').props.onPress()); // unselect the current owner
  await act(async () => byId('people-confirm').props.onPress());
  expect(edits).toEqual([{ id: 'r1', patch: { owner: null } }]);
});

test('board: tapping the participant avatars opens 设置参与人', async () => {
  participantCards = true;
  await mount();
  const stack = byId('req-card-r1').findAll(n => n.props.testID === 'task-participants' && typeof n.props.onPress === 'function')[0];
  await act(async () => stack.props.onPress());
  expect(byId('people-confirm')).toBeTruthy();
  expect(renderer.root.findAllByProps({ testID: 'req-detail' })).toHaveLength(0);
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
  // 项目是下拉:当前值显示在按钮上;列表里没有已归档的 p3
  expect(byId('req-project-value').props.children).toBe('TMAI');
  await act(async () => pressable('req-project').props.onPress());
  expect(renderer.root.findAllByProps({ testID: 'req-project-menu-opt-p3' })).toHaveLength(0);
  expect(byId('req-project-menu-opt-p1')).toBeTruthy();
  await act(async () => byId('req-project-menu-scrim').props.onPress());
  await act(async () => byId('req-name').props.onChangeText('TMAI 的任务'));
  await act(async () => byId('req-add').props.onPress());
  expect(creates[0].projectId).toBe('p2');
  await act(async () => setTaskFilter({ owners: [], priorities: [], project: '' }));
  await act(async () => byId('req-card-r1').props.onPress());
  expect(byId('req-edit-project-value').props.children).toBe('军团项目');
  await act(async () => pressable('req-edit-project').props.onPress());
  await act(async () => byId('req-edit-project-menu-opt-p2').props.onPress());
  expect(byId('req-edit-project-value').props.children).toBe('TMAI');
  await act(async () => byId('req-edit-save').props.onPress());
  expect(edits).toEqual([{ id: 'r1', patch: { project_id: 'p2' } }]);
});

test('hub without projects: no project picker, no project chip filter', async () => {
  await mount();
  expect(renderer.root.findAllByProps({ testID: 'task-filter-project' })).toHaveLength(0);
  await act(async () => byId('req-new').props.onPress());
  expect(renderer.root.findAllByProps({ testID: 'req-project' })).toHaveLength(0);
});

test('母任务: pick a parent (not itself or its descendants), saved at once as parent_id; hub rejection shows under the field', async () => {
  subCards = true;
  await mount();
  await act(async () => byId('req-card-r2').props.onPress());
  expect(byId('req-edit-parent-value').props.children).toBe('验证需求详情');
  await act(async () => pressable('req-edit-parent').props.onPress());
  // r2 自己不在;r1(现在的母任务)、r3 在;「无」在
  expect(renderer.root.findAllByProps({ testID: 'req-edit-parent-menu-opt-r2' })).toHaveLength(0);
  expect(byId('req-edit-parent-menu-opt-r3')).toBeTruthy();
  expect(byId('req-edit-parent-menu-opt-none')).toBeTruthy();
  editReply = () => { throw new HubError(400, '不能挂到这个母任务下(会形成循环,或它已不存在)'); };
  await act(async () => byId('req-edit-parent-menu-opt-r3').props.onPress());
  expect(edits[0].patch).toEqual({ parent_id: 'r3' });
  expect(byId('req-edit-parent-error').props.children).toBe('不能挂到这个母任务下(会形成循环,或它已不存在)');
  expect(renderer.root.findAllByProps({ testID: 'req-edit-error' })).toHaveLength(0);
  // 没存上:字段退回卡上的值
  expect(byId('req-edit-parent-value').props.children).toBe('验证需求详情');
  editReply = null;
  // 清成顶层
  await act(async () => pressable('req-edit-parent').props.onPress());
  await act(async () => byId('req-edit-parent-menu-opt-none').props.onPress());
  expect(edits[1].patch).toEqual({ parent_id: null });
});

test('母任务 on a parent: its own child is not offered (no cycles); cards show 「↳ 母任务」', async () => {
  subCards = true;
  await mount();
  expect(JSON.stringify(byId('req-card-r3').findAll(n => n.props.testID === 'task-card-parent').map(n => n.props.children))).toContain('验证需求详情');
  expect(byId('req-card-r1').findAll(n => n.props.testID === 'task-card-parent')).toHaveLength(0);
  await act(async () => byId('req-card-r1').props.onPress());
  await act(async () => pressable('req-edit-parent').props.onPress());
  expect(renderer.root.findAllByProps({ testID: 'req-edit-parent-menu-opt-r2' })).toHaveLength(0);
  expect(renderer.root.findAllByProps({ testID: 'req-edit-parent-menu-opt-r3' })).toHaveLength(0);
});

test('old hub without parent_id: 母任务 says 升级 Hub 后可用 and sends nothing', async () => {
  detailCards = true;
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  expect(byId('req-edit-parent-upgrade')).toBeTruthy();
  expect(renderer.root.findAllByProps({ testID: 'req-edit-parent' })).toHaveLength(0);
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

test('description full screen (phone): ⤢ opens a page with ‹, 编辑/预览 and 🖼; 按住说话 inserts at the caret and keeps going from there', async () => {
  detailCards = true;
  voiceAvailable = true;
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  await act(async () => byId('req-description-mode-edit').props.onPress());
  // The small editor inside the detail page has no mic on a phone: voice lives on the full-screen page.
  expect(renderer.root.findAllByProps({ testID: 'voice-mic' })).toHaveLength(0);
  expect(renderer.root.findAllByProps({ testID: 'voice-hold-bar' })).toHaveLength(0);
  await act(async () => byId('req-description-fullscreen').props.onPress());
  expect(byId('req-description-page')).toBeTruthy();
  expect(byId('req-description-page-back')).toBeTruthy();
  expect(byId('req-description-page-image')).toBeTruthy();
  const input = () => byId('req-description-page-input');
  expect(input().props.value).toBe('## 目标');
  await act(async () => input().props.onSelectionChange({ nativeEvent: { selection: { start: 3, end: 3 } } }));
  await act(async () => byId('voice-hold-bar').props.onResponderGrant({ nativeEvent: { pageX: 0, pageY: 0 } }));
  await act(async () => voiceInsert!('新'));
  expect(input().props.value).toBe('## 新目标');
  // The next utterance continues right after the inserted text (not at the end).
  await act(async () => byId('voice-hold-bar').props.onResponderGrant({ nativeEvent: { pageX: 0, pageY: 0 } }));
  await act(async () => voiceInsert!('的'));
  expect(input().props.value).toBe('## 新的目标');
  expect(voicePresses).toBe(2);
  expect(byId('req-description-page-dirty')).toBeTruthy();
  // Preview: no hold bar, no 🖼.
  await act(async () => byId('req-description-page-mode-preview').props.onPress());
  expect(renderer.root.findAllByProps({ testID: 'voice-hold-bar' })).toHaveLength(0);
  expect(renderer.root.findAllByProps({ testID: 'req-description-page-image' })).toHaveLength(0);
  // ‹ closes the page; the draft is kept and 保存修改 sends it.
  await act(async () => byId('req-description-page-back').props.onPress());
  expect(renderer.root.findAllByProps({ testID: 'req-description-page' })).toHaveLength(0);
  await act(async () => byId('req-edit-save').props.onPress());
  expect(edits[0].patch).toEqual({ description: '## 新的目标' });
});

test('description full screen (phone) without voice support: no hold bar, 🖼 still there', async () => {
  detailCards = true;
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  await act(async () => byId('req-description-fullscreen').props.onPress());
  await act(async () => byId('req-description-page-mode-edit').props.onPress());
  expect(byId('req-description-page-image')).toBeTruthy();
  expect(renderer.root.findAllByProps({ testID: 'voice-hold-bar' })).toHaveLength(0);
});

test('详情渐进展开: 常显字段在前,其余收进「更多」(默认收起),收起时一行摘要,展开状态本机记住', async () => {
  moreStored = null;
  subCards = true;
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  // 收起:母任务 / 子任务 看不到;优先级常显(owner 10-01:放在描述前面);摘要说「2 子任务」(r1 的 children.total = 2)
  expect(renderer.root.findAllByProps({ testID: 'req-more' })).toHaveLength(0);
  expect(byId('req-edit-priority-high')).toBeTruthy();
  expect(renderer.root.findAllByProps({ testID: 'req-subrequirements' })).toHaveLength(0);
  expect(byId('req-more-summary').props.children).toBe('2 子任务');
  expect(byId('req-edit-due')).toBeTruthy();
  await act(async () => byId('req-more-toggle').props.onPress());
  expect(byId('req-more')).toBeTruthy();
  expect(byId('req-subrequirements')).toBeTruthy();
  expect(renderer.root.findAllByProps({ testID: 'req-more-summary' })).toHaveLength(0);
  expect(moreSaves).toEqual([true]);
  await act(async () => byId('req-more-toggle').props.onPress());
  expect(moreSaves).toEqual([true, false]);
});

test('sub-requirements: progress chip on the parent card, children in detail, breadcrumb to the parent, 新建子需求 prefilled, GitHub link', async () => {
  subCards = true;
  await mount();
  expect(JSON.stringify(byId('req-card-r1').findAll(n => n.props.testID === 'task-subreq-progress').map(n => n.props.accessibilityLabel))).toContain('子任务 1/2 完成');
  await act(async () => byId('req-card-r1').props.onPress());
  expect(byId('req-subrequirements')).toBeTruthy();
  expect(byId('req-child-r3')).toBeTruthy();
  expect(byId('req-child-r2')).toBeTruthy();
  // GitHub 链接走 openExternal,外部引用显示出来
  await act(async () => byId('req-issue-source-link').props.onPress());
  expect(opened).toEqual(['https://github.com/acme/widgets/issues/7']);
  expect(texts('req-issue-source')).toContain('同步来源');
  // 打开子需求 → 面包屑回到父需求
  await act(async () => byId('req-child-r3').props.onPress());
  expect(byId('req-edit-name').props.value).toBe('子需求乙');
  expect(byId('req-parent-breadcrumb')).toBeTruthy();
  await act(async () => byId('req-parent-link').props.onPress());
  expect(byId('req-edit-name').props.value).toBe('验证需求详情');
  // 新建子需求:parentId 预填,对话框说「属于:…」
  await act(async () => byId('req-new-child').props.onPress());
  expect(JSON.stringify(byId('req-create-parent').findAllByType('Text').map(n => n.props.children))).toContain('验证需求详情');
  await act(async () => byId('req-name').props.onChangeText('新的子需求'));
  await act(async () => byId('req-add').props.onPress());
  expect(creates[0].parentId).toBe('r1');
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

test('detail ID chip (phone): tap copies #N, long-press copies the full id; old hub copies the full id', async () => {
  const { default: TaskIdChip } = await import('./src/TaskIdChip');
  copied.length = 0;
  await act(async () => { renderer = create(<TaskIdChip item={{ id: 'req_0f3a9c2e-1111', seq: 7 }} pointer={false} />); });
  expect(byId('req-detail-id-text').props.children).toBe('#7');
  expect(renderer.root.findAllByProps({ testID: 'req-detail-id-copy-full' })).toHaveLength(0);
  await act(async () => { await pressable('req-detail-id-copy').props.onPress(); });
  await act(async () => { await pressable('req-detail-id-copy').props.onLongPress(); });
  expect(copied).toEqual(['#7', 'req_0f3a9c2e-1111']);
  // 换一张旧 Hub 的卡(没有 seq):「已复制」随卡片切换清掉,显示 uuid 前 8 位
  await act(async () => renderer.update(<TaskIdChip item={{ id: 'req_9b8c7d6e-2222' }} pointer={false} />));
  expect(byId('req-detail-id-text').props.children).toBe('9b8c7d6e');
  await act(async () => { await pressable('req-detail-id-copy').props.onPress(); });
  expect(copied[2]).toBe('req_9b8c7d6e-2222');
});
