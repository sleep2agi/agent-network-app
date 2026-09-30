// 手机原生端的「生成分享图」:把 ShareCardNative 截成 PNG(react-native-view-shot),再交给系统分享面板
// (expo-sharing:微信 / 小红书 / 存到相册都在那里)。web / 桌面用 Canvas 版(task-share-card.ts),不走这里。
//
// 尺寸:卡片按 1080 / PixelRatio 的逻辑宽画(= 1080 物理像素),截出来再用 expo-image-manipulator 缩放到**正好**
// 1080 × 1920 / 1350 —— 逻辑宽乘回像素比会差出一两个像素(1080 / 2.625 不是整数),分享图尺寸要精确。
// 依赖都用动态 import:只在手机上点了才加载,web 包和组件测试(tests/requirement-details)不需要它们。
import type { View } from 'react-native';
import { SHARE_H, SHARE_W, type ShareSize } from './task-share-card';

export async function captureShareCard(view: View, size: ShareSize): Promise<string> {
  const { captureRef } = await import('react-native-view-shot');
  const raw = await captureRef(view, { format: 'png', quality: 1, result: 'tmpfile' });
  const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
  const image = await ImageManipulator.manipulate(raw).resize({ width: SHARE_W, height: SHARE_H[size] }).renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.PNG });
  return saved.uri;
}

export async function shareCardFile(uri: string, title: string): Promise<void> {
  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) throw new Error('sharing unavailable');
  await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: title });
}
