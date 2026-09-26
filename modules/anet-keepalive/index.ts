// JS 面:原生模块只在安卓 APK 里有(本地 Expo 模块,expo 自动链接 ./modules)。
// 网页 / iOS / 没重新构建的旧 APK 上 requireOptionalNativeModule 返回 null —— 调用方据此显示「不可用」。
import { requireOptionalNativeModule } from 'expo';

export type AnetKeepAliveNative = {
  /** 起前台服务(带一条低优先级常驻通知)。返回 null = 成功,否则是错误说明。 */
  start(title: string, text: string): string | null;
  stop(): void;
  isRunning(): boolean;
  /** 0.2.109:用户是否授予了「勿扰权限」(渠道 bypassDnd 只有授权后才生效)。旧 APK 上没有这个函数。 */
  isNotificationPolicyAccessGranted?(): boolean | null;
  /** 0.2.109:当前勿扰状态(1=关 2=仅优先 3=完全静音 4=仅闹钟)。旧 APK 上没有。 */
  currentInterruptionFilter?(): number | null;
};

export const AnetKeepAlive = requireOptionalNativeModule<AnetKeepAliveNative>('AnetKeepAlive');
