/**
 * 「点击更新好像没用」(Vincent 2026-09-24,v0.2.86):启动时的自动检查已经把设置页那一行变成
 * 「已是最新版」,手动点一下只闪过一个几百毫秒的转圈又回到**同一句话** —— 看起来像没反应;失败时
 * 也只写「检查失败」,不说为什么。这里是纯逻辑:手动检查的每一次都落到一个看得见的结果上。
 */

/** 桌面更新包从哪个来源下(内部,不展示):清单里平台地址的主机决定(见 desktop-updater.ts desktopUpdateSource)。 */
export type DesktopUpdateSource = 'mirror' | 'github';

export type DesktopUpdateState =
  | { kind: 'idle' | 'unsupported' | 'checking' | 'up-to-date' }
  | { kind: 'available'; version: string; notes: string; currentVersion?: string; source?: DesktopUpdateSource }
  | { kind: 'downloading'; version: string; percent?: number; currentVersion?: string; source?: DesktopUpdateSource; downloaded?: number; total?: number }
  | { kind: 'error'; message: string };

export type UpdateRowView = {
  /** 右侧主文案 */
  label: string;
  /** 右侧下方一行小字(上次检查时间 / 失败原因的补充);没有就不画 */
  detail?: string;
  tone: 'muted' | 'accent' | 'danger';
  /** 检查中:按钮禁用 + 转圈 */
  busy: boolean;
  /** 能不能点(unsupported / downloading 不能点) */
  actionable: boolean;
};

/** 把插件抛出的英文/底层错误翻成一句人能看懂的原因。原始 message 仍保留在状态里给日志用。 */
export function updateErrorReason(message: string | null | undefined): string {
  const raw = String(message ?? '').trim();
  const m = raw.toLowerCase();
  if (!raw) return '未知错误';
  if (/signature|verify|minisign|pubkey|public key/.test(m)) return '更新包签名校验失败';
  if (/\b404\b|not found/.test(m)) return '更新地址不可用（404）';
  if (/\b(5\d\d)\b/.test(m)) return '更新服务器暂时不可用';
  if (/timed? ?out|timeout/.test(m)) return '连接超时';
  if (/network|unreachable|dns|resolve|connect|offline|fetch|socket|tls|certificate/.test(m)) return '网络不通';
  if (/json|parse|deserializ|invalid (response|manifest)|unexpected token/.test(m)) return '更新清单格式错误';
  if (/permission|not allowed|denied/.test(m)) return '没有检查更新的权限';
  return raw.length > 60 ? `${raw.slice(0, 57)}…` : raw;
}

export function formatCheckedAt(lastCheckedAt: number | undefined, now: number): string | undefined {
  if (!lastCheckedAt) return undefined;
  const diff = Math.max(0, now - lastCheckedAt);
  if (diff < 60_000) return '刚刚检查';
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)} 分钟前检查`;
  const d = new Date(lastCheckedAt);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm} 检查`;
}

export function describeUpdateRow(
  state: DesktopUpdateState,
  opts: { currentVersion: string; lastCheckedAt?: number; now: number },
): UpdateRowView {
  const checked = formatCheckedAt(opts.lastCheckedAt, opts.now);
  switch (state.kind) {
    case 'checking':
      return { label: '检查中…', tone: 'muted', busy: true, actionable: false };
    case 'up-to-date':
      return { label: `已是最新版本 v${opts.currentVersion}`, detail: checked, tone: 'muted', busy: false, actionable: true };
    case 'available':
      return { label: `发现新版本 v${state.version}`, detail: '点击查看并安装', tone: 'accent', busy: false, actionable: true };
    case 'downloading':
      return {
        label: `正在下载 v${state.version}${state.percent == null ? '' : ` ${state.percent}%`}`,
        tone: 'accent', busy: true, actionable: false,
      };
    case 'error':
      return { label: `检查更新失败：${updateErrorReason(state.message)}`, detail: '点击重试', tone: 'danger', busy: false, actionable: true };
    case 'unsupported':
      return { label: '当前环境不支持自动更新', tone: 'muted', busy: false, actionable: false };
    case 'idle':
    default:
      return { label: '检查更新', detail: checked, tone: 'muted', busy: false, actionable: true };
  }
}

/**
 * 让一次手动检查的「检查中…」至少可见 minMs:结果回来得太快(几十毫秒)时,人根本看不见转圈,
 * 只看到一句没变的话。只延迟**展示**,不延迟检查本身。
 */
export async function atLeast<T>(
  work: Promise<T>,
  minMs: number,
  deps: { now: () => number; sleep: (ms: number) => Promise<void> },
): Promise<T> {
  const start = deps.now();
  let value: T;
  let failed = false;
  let err: unknown;
  try { value = await work; } catch (e) { failed = true; err = e; }
  const elapsed = deps.now() - start;
  if (elapsed < minMs) await deps.sleep(minMs - elapsed);
  if (failed) throw err;
  return value!;
}
