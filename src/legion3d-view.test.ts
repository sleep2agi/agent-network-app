// 军团 3D 视图的断言(2026-11-05)。
// 这一版是「看得见」的第一版:没有 canvas、没有新依赖,靠 RN 基础元素画。
// 断言钉住的是**不能悄悄退化**的几件事:数据来源、相机、遮挡顺序、环的密度、
// 空/错状态不被「军团没人」掩盖、以及入口默认收起(不给设置页加请求)。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildLegionLayout } from './legion/legion-layout';
import { legionInputFromOrg } from './legion-input-from-org';
import { buildLegionScene, sceneCounts, nextYaw, SPIN_RAD_PER_SEC } from './legion3d-scene';

let pass = 0;
const names: string[] = [];
function ck(name: string, ok: boolean) {
  names.push(name);
  if (ok) { pass += 1; return; }
  console.log(`FAIL: ${name}`);
}

const view = readFileSync(path.join(import.meta.dir, 'legion3d-view.tsx'), 'utf8');
const settings = readFileSync(path.join(import.meta.dir, 'SettingsScreen.tsx'), 'utf8');

ck('数据走客户端已有的组织架构接口（不另起一套请求）',
  view.includes("import { loadAgentOrg } from './agent-org-api'") && view.includes('loadAgentOrg(p.cfg, net)'));

ck('布局与图元都走已搬入的纯函数（不在这里重算投影）',
  view.includes('buildLegionLayout(legionInputFromOrg(org))') && view.includes('buildLegionScene(layout, cam,'));

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
  view.includes("if (!net) { setState({ phase: 'empty'") && view.includes("note: '还没选网络'"));

ck('设置页入口默认收起（不给每次进设置加一次组织架构请求）',
  settings.includes('const [showLegion3D, setShowLegion3D] = useState(false)')
  && settings.includes('settings-legion3d-toggle')
  && settings.includes('{showLegion3D ? <Legion3DView'));

ck('自转有帧率上限（定时器 50ms，不用 rAF 60fps）',
  view.includes('SPIN_TICK_MS') && view.includes('setInterval') && !view.includes('requestAnimationFrame'));

ck('自转默认关闭，用户点了才转（先看清静态图）',
  view.includes('const [spinning, setSpinning] = useState(false)') && view.includes('legion3d-spin-toggle'));

ck('App 切后台就停转（不白烧电）',
  view.includes("AppState.addEventListener('change'") && view.includes('clearInterval(timer)'));

ck('自转只重算投影，不重排部门树（布局按数据算一次）',
  view.includes('const [layout, setLayout] = useState') && /useEffect\(\(\) => \{\n    if \(!layout\) return;/.test(view));

ck('角度推进是纯函数（会转、会绕回、负时间不倒退）', (() => {
  const a = nextYaw(0, 1000);
  return Math.abs(a - SPIN_RAD_PER_SEC) < 1e-9
    && Math.abs(nextYaw(0, 0) - 0) < 1e-12
    && Math.abs(nextYaw(1, -100) - 1) < 1e-12
    && nextYaw(Math.PI * 2 - 0.01, 1000) < Math.PI * 2;
})());

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
