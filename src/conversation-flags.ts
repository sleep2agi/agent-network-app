// 会话行菜单本机状态的接线:web 用 localStorage,原生用 documentDirectory 里一个按账号分的 JSON 文件。
// 读写 / 订阅 / 排队的逻辑在 conversation-flags-core.ts(无 RN 依赖,有测试)。
import * as FileSystem from 'expo-file-system/legacy';
import { createConversationFlagsStore } from './conversation-flags-core';

const nativeFile = (scope: string) => `${FileSystem.documentDirectory}conversation_flags_v1_${scope}.json`;

const store = createConversationFlagsStore({
  web: () => {
    const ls = (globalThis as any).localStorage as Storage | undefined;
    return ls && typeof ls.getItem === 'function' ? ls : null;
  },
  native: {
    read: async scope => {
      if (!FileSystem.documentDirectory) return null;
      const file = nativeFile(scope);
      const info = await FileSystem.getInfoAsync(file);
      return info.exists ? FileSystem.readAsStringAsync(file) : null;
    },
    write: async (scope, body) => {
      if (!FileSystem.documentDirectory) return;
      await FileSystem.writeAsStringAsync(nativeFile(scope), body);
    },
  },
});

export const getConversationFlags = store.get;
export const subscribeConversationFlags = store.subscribe;
export const bindConversationFlags = store.bind;
export const updateConversationFlags = store.update;
export const conversationOpened = store.opened;
