import { AppState } from 'react-native';
import { noteAppSuspended } from './connectivity';

// 离开前台(后台 / 锁屏 / iOS 多任务切换器 = inactive;web 上 RN-web 的 AppState 跟 document 可见性走)
// ⇒ 记一次挂起,跨过它的读不计入「连接较慢」的判断(connectivity.ts noteAppSuspended)。
// 只挂一次;usePoll 引入它,所以任何轮询页面一出现就生效。
let installed = false;
export function installConnectivityLifecycle(): void {
  if (installed) return;
  installed = true;
  try {
    AppState.addEventListener('change', s => { if (s !== 'active') noteAppSuspended(); });
  } catch { /* 没有 AppState(测试桩):不装,行为同从前 */ }
}
