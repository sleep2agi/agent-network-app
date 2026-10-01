// 弹层的 Esc(web / 桌面壳)。不 import react-native。
//
// 为什么不在 keydown 上直接关:react-native-web 的 Modal 在 document 的 keyup(冒泡)上对「最上层」Modal 调
// onRequestClose。弹层在 keydown 上就卸掉的话,同一下的 keyup 会落到下面那层 Modal(窄窗口的整页任务详情、
// 新建对话框)上,把它也关了。
// 为什么也不全交给 Modal 的 onRequestClose:Modal 要等打开动画放完(onShow)才算「最上层」,动画期间按 Esc
// 关的是下面那层;没有 Modal 垫底时(抽屉详情)这一下就谁也没关。
// 所以:keydown(捕获)布防并吞掉,keyup(捕获)才关,并且吞掉 keyup —— 下面那层的 Modal 收不到。
// 组字中的 Esc 是取消输入法,不算。

export function escapeCloseHandlers(onClose: () => void): { onKeyDown: (e: any) => void; onKeyUp: (e: any) => void } {
  let armed = false;
  return {
    onKeyDown: (e) => {
      if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault?.(); e.stopPropagation?.();
      armed = true;
    },
    onKeyUp: (e) => {
      if (e.key !== 'Escape' || !armed) return;
      armed = false;
      e.preventDefault?.(); e.stopPropagation?.();
      onClose();
    },
  };
}

/** 挂到 document 的捕获阶段;返回卸载函数。没有 document(原生)时什么都不做。 */
export function listenEscapeClose(onClose: () => void): () => void {
  const doc = (globalThis as any).document;
  if (!doc?.addEventListener) return () => {};
  const h = escapeCloseHandlers(onClose);
  doc.addEventListener('keydown', h.onKeyDown, true);
  doc.addEventListener('keyup', h.onKeyUp, true);
  return () => { doc.removeEventListener('keydown', h.onKeyDown, true); doc.removeEventListener('keyup', h.onKeyUp, true); };
}
