// 「在新窗口打开」任务:Tauri 那一半(模型与理由见 task-window-model.ts;页面是 TaskWindow.tsx)。
//
// 开窗的一方:openTaskWindow(payload) → true = 窗口显示了这个任务;false = 开不了(调用方留在抽屉里,什么都不丢)。
// 窗口的一方:subscribeTaskWindow(onShow) —— 先订阅 SHOW,再发 READY。
// payload 里没有 token;这个文件也不碰 token(window-capabilities-contract.test.ts 查)。
import {
  TASK_WINDOW_CHANGED_EVENT,
  TASK_WINDOW_MIN,
  TASK_WINDOW_READY_EVENT,
  TASK_WINDOW_SHOW_EVENT,
  TASK_WINDOW_SIZE,
  TASK_WINDOW_URL,
  taskWindowLabel,
  taskWindowTitle,
  type TaskChanged,
  type TaskWindowPayload,
} from './task-window-model';

/** 新窗口页面启动要一会儿:点了之后这么久之内它来要,都给。 */
const PENDING_TTL_MS = 20_000;
/** 建窗口最多等这么久。 */
const CREATE_TIMEOUT_MS = 6_000;
const pending = new Map<string, TaskWindowPayload>();
let readyListener: Promise<void> | null = null;

const tauri = () => !!(globalThis as any).__TAURI_INTERNALS__;

function ensureReadyListener(): Promise<void> {
  readyListener ??= (async () => {
    const { listen, emitTo } = await import('@tauri-apps/api/event');
    await listen(TASK_WINDOW_READY_EVENT, event => {
      const label = (event.payload as { label?: unknown } | null)?.label;
      if (typeof label !== 'string') return;
      const p = pending.get(label);
      if (!p || Date.now() - p.at > PENDING_TTL_MS) return;
      void emitTo(label, TASK_WINDOW_SHOW_EVENT, p).catch(error => console.warn('[task-window] answer ready failed', error));
    });
  })().catch(error => { readyListener = null; throw error; });
  return readyListener;
}

export async function openTaskWindow(payload: TaskWindowPayload): Promise<boolean> {
  if (!tauri()) return false;
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const { emitTo } = await import('@tauri-apps/api/event');
    const label = taskWindowLabel(payload.profileId, payload.taskId);
    pending.set(label, payload);
    await ensureReadyListener();
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await emitTo(label, TASK_WINDOW_SHOW_EVENT, payload);
      await existing.unminimize().catch(() => {});
      await existing.show();
      await existing.setFocus();
      return true;
    }
    const win = new WebviewWindow(label, {
      url: TASK_WINDOW_URL,
      title: taskWindowTitle(payload.title),
      width: TASK_WINDOW_SIZE.width,
      height: TASK_WINDOW_SIZE.height,
      minWidth: TASK_WINDOW_MIN.width,
      minHeight: TASK_WINDOW_MIN.height,
      center: true,
      resizable: true,
      focus: true,
      // 和分离聊天窗一样:macOS 隐藏原生标题栏(页面自己挂 MacTitleStrip),Windows 忽略这两个键。
      titleBarStyle: 'overlay',
      hiddenTitle: true,
      // 描述里要能拖入图片:开着的话 Tauri 自己截走 drop 事件。
      dragDropEnabled: false,
    });
    return await new Promise<boolean>(resolve => {
      let settled = false;
      const done = (ok: boolean) => { if (!settled) { settled = true; clearTimeout(timer); resolve(ok); } };
      // 两个事件都没来(窗口系统卡住):不让按钮一直挂着,当作开不了、留在抽屉。
      const timer = setTimeout(() => { console.warn('[task-window] no created/error event, staying in the drawer'); pending.delete(label); done(false); }, CREATE_TIMEOUT_MS);
      void win.once('tauri://created', () => done(true));
      void win.once('tauri://error', event => {
        console.warn('[task-window] create failed, staying in the drawer', event?.payload ?? event);
        pending.delete(label);
        done(false);
      });
    });
  } catch (error) {
    console.warn('[task-window] unavailable, staying in the drawer', error);
    return false;
  }
}

// ── 窗口一方 ───────────────────────────────────────────────────────────────

export async function subscribeTaskWindow(onShow: (raw: unknown) => void): Promise<() => void> {
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const { emit } = await import('@tauri-apps/api/event');
  const self = getCurrentWebviewWindow();
  const off = await self.listen(TASK_WINDOW_SHOW_EVENT, event => onShow(event.payload));
  await emit(TASK_WINDOW_READY_EVENT, { label: self.label });
  return off;
}

// ── 任何窗口:写成功了告诉别的窗口 ─────────────────────────────────────────────

export async function currentWindowLabel(): Promise<string> {
  if (!tauri()) return '';
  try {
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    return getCurrentWebviewWindow().label;
  } catch { return ''; }
}

export async function emitTaskChanged(change: Omit<TaskChanged, 'from'>): Promise<void> {
  if (!tauri()) return;
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit(TASK_WINDOW_CHANGED_EVENT, { ...change, from: await currentWindowLabel() });
  } catch { /* 只是提示别的窗口早点刷新;它们还有 15 秒一次的轮询 */ }
}

export async function listenTaskChanged(handler: (raw: unknown) => void): Promise<() => void> {
  if (!tauri()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen(TASK_WINDOW_CHANGED_EVENT, event => handler(event.payload));
}

export async function closeTaskWindow(): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().close();
}

export async function setTaskWindowTitle(name: string): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setTitle(taskWindowTitle(name));
  } catch { /* 标题只是锦上添花 */ }
}
