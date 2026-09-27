// 新建节点向导「工作目录」一行的纯函数(供 CreateNodeWizardScreen 与测试共用)。
//
// 节点建在哪个目录,决定了它的文件工具能看见什么:落在 $HOME 会扫到家目录里的密钥和别的项目。
// daemon 新版本会在 /api/host-supervisors 里带 `default_workdir_root`(hub+daemon 都是新版本、
// 且调用者是 admin/owner 才有);默认规则 = <default_workdir_root>/<节点名>,每个节点一个子目录。
//
// 🔴 没有 `default_workdir_root` = 老 daemon 或老 hub:它们不认 node_spec.workdir(老 daemon 会
//    静默忽略、节点照旧落在 daemon 的 cwd)。这时整行隐藏、请求里不带该字段 —— 不能显示一个
//    「将建在 X」却实际建在别处的路径。
// daemon 是最终裁决者(是否为 $HOME / 系统目录 / 已有别的节点 都在 daemon 侧判);这里只挡明显的形状错误。

import type { HostSupervisorDaemon } from './api';

/** daemon 是否支持指定工作目录;支持时返回它的默认根目录。 */
export function workdirRootOf(daemon: Pick<HostSupervisorDaemon, 'default_workdir_root'>): string | null {
  const root = daemon.default_workdir_root;
  return typeof root === 'string' && root.trim() !== '' ? root.trim() : null;
}

const WIN_DRIVE = /^[A-Za-z]:[\\/]/;

/** 默认工作目录:<root>/<name>。Windows 形状的根(含反斜杠)用反斜杠拼。 */
export function defaultWorkdir(root: string, name: string): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  const base = root.endsWith('/') || root.endsWith('\\') ? root.slice(0, -1) : root;
  return `${base}${sep}${name}`;
}

/** 去掉末尾分隔符(根 `/` 与盘符根 `C:\` 保留),用来比较「是不是就是根目录本身」。 */
function trimTrailingSep(p: string): string {
  let s = p;
  while (s.length > 1 && (s.endsWith('/') || s.endsWith('\\')) && !/^[A-Za-z]:[\\/]$/.test(s)) s = s.slice(0, -1);
  return s;
}

/** 客户端轻校验。返回错误文案;null = 通过(以 daemon 的判断为准)。 */
export function workdirError(value: string, root: string): string | null {
  const v = value.trim();
  if (v === '') return '请填写工作目录';
  if (!(v.startsWith('/') || v === '~' || v.startsWith('~/') || WIN_DRIVE.test(v))) {
    return '需要绝对路径（以 / 或 ~/ 开头）';
  }
  if (v === '~' || trimTrailingSep(v) === trimTrailingSep(root)) {
    return '不能直接用家目录，请用它下面的子目录';
  }
  return null;
}

/** 提交时 node_spec 里要不要带 workdir:只在 daemon 支持时带。 */
export function workdirForRequest(root: string | null, value: string): { workdir: string } | Record<string, never> {
  if (!root) return {};
  return { workdir: value.trim() };
}

/** 把 hub / daemon 回的 workdir 错误码翻成一句话;不是 workdir 错误返回 null。 */
export function describeWorkdirError(error: string | null | undefined): string | null {
  const e = (error ?? '').trim();
  const m = /workdir_[a-z_]+(?::\S+)?/.exec(e);
  if (!m) return null;
  const [code, detail] = m[0].split(':');
  switch (code) {
    case 'workdir_is_home': return '工作目录不能是家目录本身';
    case 'workdir_is_system_dir': return '工作目录不能是根目录或系统目录';
    case 'workdir_has_other_node': return `该目录里已有别的节点${detail ? `（${detail}）` : ''}，请换一个目录`;
    case 'workdir_create_failed': return '无法创建工作目录（权限不足？）';
    case 'workdir_not_supported_by_daemon': return '该 daemon 版本不支持指定工作目录，请升级 daemon';
    case 'workdir_invalid': return '工作目录格式不对（需要绝对路径）';
    default: return `工作目录不可用（${code}）`;
  }
}
