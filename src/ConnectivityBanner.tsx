import { useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';

import { bannerText, connectivityState, connectivityVersion, subscribeConnectivity } from './connectivity';

// 全局连接状态横幅(通信龙 App战线①):App 连不上 hub 时,一条细横幅出现在所有
// 已登录界面顶部,声明"你看到的是缓存数据 + 截至何时"。数据源 src/connectivity.ts
// (api.ts 共享读路径上报);🔴 时间戳=最后一次**成功**,不是最后一次尝试。
// 在线时返回 null,零占位、零开销。
export default function ConnectivityBanner() {
  useSyncExternalStore(subscribeConnectivity, connectivityVersion, connectivityVersion);
  const text = bannerText(connectivityState());
  if (!text) return null;
  return (
    <View
      testID="connectivity-banner"
      style={{ backgroundColor: '#7c2d12', paddingVertical: 4, paddingHorizontal: 12 }}
    >
      <Text style={{ color: '#fed7aa', fontSize: 12, textAlign: 'center' }}>{text}</Text>
    </View>
  );
}
