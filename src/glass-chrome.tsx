import { createContext, useContext } from 'react';

// 桌面主窗口整窗一层渐变（chat-glow-gradient.ts）时，里面的会话列表、聊天页要把自己的底色让出来，
// 光才能连成一片。只在桌面 shell 里打开；手机和独立弹出的聊天窗仍用各自的实底 / 自带光斑。
const GlassChrome = createContext(false);
export const GlassChromeProvider = GlassChrome.Provider;
export const useGlassChrome = (): boolean => useContext(GlassChrome);
