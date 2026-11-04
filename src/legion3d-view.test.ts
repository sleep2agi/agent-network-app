// 军团 3D 视图的断言(2026-11-05)。
// 这一版是「看得见」的第一版:没有 canvas、没有新依赖,靠 RN 基础元素画。
// 断言钉住的是**不能悄悄退化**的几件事:数据来源、相机、遮挡顺序、环的密度、
// 空/错状态不被「军团没人」掩盖、以及入口默认收起(不给设置页加请求)。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildLegionLayout } from './legion/legion-layout';
import { legionInputFromOrg } from './legion-input-from-org';
import { buildLegionScene, sceneCounts, nextYaw, nodeRefValue, pickBody, SPIN_RAD_PER_SEC, parseSpinSpeed, spinRate } from './legion3d-scene';

let pass = 0;
const names: string[] = [];
function ck(name: string, ok: boolean) {
  names.push(name);
  if (ok) { pass += 1; return; }
  console.log(`FAIL: ${name}`);
}

// Windows 检出是 CRLF:不归一化的话,所有跨行正则/多行字符串断言在 windows-latest 上必红
// (2026-11-05 真红过一次)。
const read = (name: string) => readFileSync(path.join(import.meta.dir, name), 'utf8').replace(/\r\n?/g, '\n');
const view = read('legion3d-view.tsx');
const settings = read('SettingsScreen.tsx');

ck('数据走客户端已有的组织架构接口（不另起一套请求）',
  view.includes("import { loadAgentOrg } from './agent-org-api'") && view.includes('loadAgentOrg(p.cfg, net)'));

ck('布局与图元都走已搬入的纯函数（不在这里重算投影）',
  view.includes('buildLegionLayout(legionInputFromOrg(org))') && view.includes('buildLegionScene(shownLayout, cam,' + ' { width, height })'));

ck('相机在组件内算（模块级会冻结密度；yaw 由自转状态驱动）',
  /const cam = useMemo\(\(\) => \(\{ yaw, pitch: [\d.]+, dist: [\d.]+/.test(view)
  && view.includes('}), [width, yaw]);')
  && !/^const CAMERA/m.test(view));

ck('体按命令顺序渲染即可得到遮挡关系（不在视图里重排）',
  view.includes("state.commands.filter((c) => c.kind === 'body')") && !view.includes('.sort('));

ck('环是采样点而不是 96 段折线（视图数量可控）',
  view.includes('RING_DOT_STRIDE') && view.includes('i % RING_DOT_STRIDE === 0'));

ck('空/错误状态各自成屏，且不被「军团没人」掩盖',
  view.includes("phase: 'empty'") && view.includes("phase: 'error'") && view.includes('legion3d-retry'));

ck('没有网络时不发请求、直接说明原因',
  view.includes("if (!net) { setState({ phase: 'empty'") && view.includes("'还没选网络，先在上面选一个网络'"));

ck('设置页入口可折叠，且只有展开时才挂载 3D 视图（不展开不发请求）',
  settings.includes('settings-legion3d-toggle') && settings.includes('{showLegion3D ? <Legion3DView'));

ck('自转有帧率上限（定时器 50ms，不用 rAF 60fps）',
  view.includes('SPIN_TICK_MS') && view.includes('setInterval') && !view.includes('requestAnimationFrame'));

ck('自转默认关闭，用户点了才转（先看清静态图）',
  view.includes('const [spinning, setSpinning] = useState(false)') && view.includes('legion3d-spin-toggle'));

ck('App 切后台就停转（不白烧电）',
  view.includes("AppState.addEventListener('change'") && view.includes('clearInterval(timer)'));

ck('自转只重算投影，不重排部门树（布局按数据算一次）',
  view.includes('const [layout, setLayout] = useState') && view.includes('if (!shownLayout) return;')
  && view.includes('useMemo(() => (layout ? focusLayout(layout, focusId) : null)'));

ck('角度推进是纯函数（会转、会绕回、负时间不倒退）', (() => {
  const a = nextYaw(0, 1000);
  return Math.abs(a - SPIN_RAD_PER_SEC) < 1e-9
    && Math.abs(nextYaw(0, 0) - 0) < 1e-12
    && Math.abs(nextYaw(1, -100) - 1) < 1e-12
    && nextYaw(Math.PI * 2 - 0.01, 1000) < Math.PI * 2;
})());

ck('失败原因分得开（没网络 / 没组织架构 / 请求失败 / 真没人），而不是一律「军团没人」',
  view.includes("reason: 'no-network'") && view.includes("reason: 'no-org-data'")
  && view.includes("reason: 'fetch-failed'") && view.includes("reason: 'no-people'")
  && view.includes('legion3d-${state.phase}-${state.reason}'));

ck('默认展开，但存过的选择优先（三态：没存过 ≠ 选过收起）',
  settings.includes('useState(true)') && settings.includes('loadLegion3DOpen')
  && settings.includes('saveLegion3DOpen') && settings.includes('open !== null'));

ck('汇总行用布局统计的全量口径（不是图元数）',
  view.includes('layout.stats.people') && view.includes('layout.stats.agents')
  && view.includes('layout.stats.groups'));

// 不 import agent-list-prefs:它拉 expo-file-system/react-native,在这个 runner 里会炸;
// 用源码断言代替(该模块没有可单独测的纯逻辑依赖)。
ck('三态解析：只有明确的 1/0 才算用户选过', (() => {
  const prefs = readFileSync(path.join(import.meta.dir, 'agent-list-prefs.ts'), 'utf8');
  return prefs.includes("if (raw === '1') return true;") && prefs.includes("if (raw === '0') return false;")
    && prefs.includes('return null;') && prefs.includes('Promise<boolean | null>');
})());

ck('速度三档（慢/中/快）只改角速度，帧率上限不变',
  view.includes("testID=\"legion3d-speed\"") && view.includes('spinRate(speed)')
  && view.includes('SPIN_TICK_MS'));

ck('速度档是纯函数解析（未知值退回 normal）', (() => {
  return parseSpinSpeed('fast') === 'fast' && parseSpinSpeed('slow') === 'slow'
    && parseSpinSpeed('turbo') === 'normal' && parseSpinSpeed(undefined) === 'normal'
    && spinRate('fast') > spinRate('normal') && spinRate('normal') > spinRate('slow');
})());

ck('自转转一圈的时间在 11–45 秒之间（慢/中/快都还能看）', (() => {
  const secs = (s: string) => (Math.PI * 2) / spinRate(s);
  return ['slow', 'normal', 'fast'].every((k) => secs(k) >= 11 && secs(k) <= 45);
})());

ck('点节点能查到是谁（底部一行 + 选中描边）',
  view.includes('pickBody(') && view.includes('legion3d-selected')
  && view.includes('selectedId') && view.includes('legion3d-canvas'));

ck('pickBody：命中取最近（深度小）的那个，远处点不着', (() => {
  const bodies = [
    { kind: 'body', id: 'far', nodeKind: 'agent', x: 100, y: 100, rx: 10, ry: 10, depth: 9, scale: 1, dimmed: false },
    { kind: 'body', id: 'near', nodeKind: 'person', x: 100, y: 100, rx: 10, ry: 10, depth: 2, scale: 1, dimmed: false },
  ] as never;
  const hit = pickBody(bodies, 102, 101);
  const miss = pickBody(bodies, 300, 300);
  return hit?.id === 'near' && miss === null;
})());

ck('pickBody：小目标有最小命中半径（看得见就点得着）', (() => {
  const tiny = [{ kind: 'body', id: 't', nodeKind: 'agent', x: 50, y: 50, rx: 1, ry: 1, depth: 1, scale: 1, dimmed: false }] as never;
  return pickBody(tiny, 58, 50) !== null && pickBody(tiny, 80, 50) === null;
})());

ck('选中行点一下就复制标识（并给可见反馈）',
  view.includes('nodeRefValue(selected.id)') && view.includes("'（已复制 id）'")
  && view.includes('expo-clipboard'));

ck('长按空白处取消选中（只在非 web 绑定：桌面按住鼠标是拖选文字）',
  view.includes('onLongPress=') && view.includes("Platform.OS === 'web' ? undefined")
  && view.includes('setSelectedId(null)'));

ck('nodeRefValue 去掉图元前缀（agent:/person:/dept:）', (() => {
  return nodeRefValue('agent:n_abc') === 'n_abc'
    && nodeRefValue('person:u1') === 'u1'
    && nodeRefValue('dept:d9') === 'd9'
    && nodeRefValue('nodash') === 'nodash'
    && nodeRefValue('  agent:n_x  ') === 'n_x';
})());

ck('选中部门时可「只看这个部门」，聚焦后可「看全图」',
  view.includes('legion3d-focus-dept') && view.includes('legion3d-focus-clear')
  && view.includes('focusLayout(layout, focusId)') && view.includes('focusLabel(layout ?? null, focusId)'));

ck('不引新依赖：视图只用 RN 基础元素', (() => {
  const imports = (view.match(/^import .*$/gm) ?? []).join('\n');
  return !/react-native-svg|skia|webview|three/i.test(imports);
})());

ck('端到端：同一份组织数据能算出非空图元（体数 = 布局节点数）', (() => {
  const org = {
    departments: [{ id: 'd1', name: '平台', parent_id: null, leader_user_id: null, sort: 0, member_count: 0 }],
    owners: [{ userId: 'u1', username: 'v', displayName: 'V', departmentId: 'd1', agents: [{ nodeId: 'n1', alias: '通信欧' }] }],
    unowned: [], directory: true, departmentsApi: true, agentDepartmentSupported: true,
  } as never;
  const layout = buildLegionLayout(legionInputFromOrg(org));
  const scene = buildLegionScene(layout, { yaw: 0.6, pitch: 0.45, dist: 6.2, focal: 780 }, { width: 520, height: 360 });
  const c = sceneCounts(scene);
  return c.rings === 3 && c.bodies === layout.nodes.length && c.labels > 0;
})());

console.log(`legion 3d view: ${pass}/${names.length} checks passed`);
if (pass !== names.length) process.exit(1);
