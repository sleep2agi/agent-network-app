// JS 面:原生模块只在安卓 APK 里有(本地 Expo 模块,expo 自动链接 ./modules)。
// 网页 / iOS / 没重新构建的旧 APK 上 requireOptionalNativeModule 返回 null —— 调用方据此显示「不可用」。
import { requireOptionalNativeModule } from 'expo';

export type AnetKeepAliveNative = {
  /** 起前台服务(带一条低优先级常驻通知)。返回 null = 成功,否则是错误说明。 */
  start(title: string, text: string): string | null;
  stop(): void;
  isRunning(): boolean;
};

export const AnetKeepAlive = requireOptionalNativeModule<AnetKeepAliveNative>('AnetKeepAlive');
