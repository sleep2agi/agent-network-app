import { registerRootComponent } from 'expo';

import App from './App';
import { registerKeepAliveTask } from './src/keep-alive';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

// 0.2.107「后台保持连接」:前台服务启动的 headless JS 任务要在 AppRegistry 上登记(安卓以外空操作)。
// 必须在入口顶层 —— 进程被系统重启、由服务直接拉起时,不会经过任何组件。
registerKeepAliveTask();
