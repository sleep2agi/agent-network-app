/**
 * iOS 的「软件更新」(owner 2026-10-01 iPhone 截图,v0.2.174):iOS 包走 TestFlight 分发,应用内没有
 * 自更新通道,原来这一行落到 describeUpdateRow 的 unsupported ——「当前环境不支持自动更新」,不能点,
 * 对 iOS 用户没有任何用处。iOS 上改成「通过 TestFlight 更新 ›」,点一下打开 TestFlight。
 *
 * 纯逻辑:Linking 由调用方注入(测试里换成桩)。安卓 / 桌面不走这里。
 */
import type { UpdateRowView } from './update-check-state';

/** TestFlight App 的 URL scheme。canOpenURL 要它在 Info.plist 的 LSApplicationQueriesSchemes 里(app.json)。 */
export const TESTFLIGHT_APP_URL = 'itms-beta://';
/** 公开测试链接:没装 TestFlight(或 scheme 打不开)时退到这里,Safari 会引导安装 TestFlight。 */
export const TESTFLIGHT_PUBLIC_URL = 'https://testflight.apple.com/join/ZvqYnCA9';

export const IOS_UPDATE_ROW: UpdateRowView = { label: '通过 TestFlight 更新', tone: 'muted', busy: false, actionable: true };

export type LinkingLike = {
  canOpenURL: (url: string) => Promise<boolean>;
  openURL: (url: string) => Promise<unknown>;
};

/** 打开 TestFlight;返回实际打开的地址。scheme 打不开 / 抛错都退到公开链接。 */
export async function openTestFlight(linking: LinkingLike): Promise<string> {
  try {
    if (await linking.canOpenURL(TESTFLIGHT_APP_URL)) {
      await linking.openURL(TESTFLIGHT_APP_URL);
      return TESTFLIGHT_APP_URL;
    }
  } catch { /* 落到公开链接 */ }
  await linking.openURL(TESTFLIGHT_PUBLIC_URL);
  return TESTFLIGHT_PUBLIC_URL;
}
