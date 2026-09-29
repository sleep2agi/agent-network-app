import { useSyncExternalStore } from 'react';
import { Pressable } from 'react-native';
import { Text } from './ui-text';

import { bannerText, connectivityState, connectivityVersion, requestReconnect, subscribeConnectivity } from './connectivity';

// 全局连接状态横幅(通信龙 App战线①):App 连不上 hub 时,一条细横幅出现在所有
// 已登录界面顶部,声明"你看到的是缓存数据 + 截至何时"。数据源 src/connectivity.ts
// (api.ts 共享读路径上报);🔴 时间戳=最后一次**成功**,不是最后一次尝试。
// 两档:「连接较慢」(琥珀,数据在到只是慢/正在重试)和「无法连接」(棕,屏上是缓存)。
// 按一下 = 立即重试(不用等退避后的下一轮)。在线时返回 null,零占位、零开销。
export default function ConnectivityBanner() {
  useSyncExternalStore(subscribeConnectivity, connectivityVersion, connectivityVersion);
  const s = connectivityState();
  const text = bannerText(s);
  if (!text) return null;
  const offline = s.level === 'offline';
  return (
    <Pressable
      testID="connectivity-banner"
      accessibilityRole="button"
      accessibilityHint="立即重试"
      onPress={requestReconnect}
      style={{ backgroundColor: offline ? '#7c2d12' : '#78350f', paddingVertical: 4, paddingHorizontal: 12 }}
    >
      <Text testID={`connectivity-banner-${s.level}`} style={{ color: offline ? '#fed7aa' : '#fde68a', fontSize: 12, textAlign: 'center' }}>
        {text}{offline ? ' · 重试' : ''}
      </Text>
    </Pressable>
  );
}
