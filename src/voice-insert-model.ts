// 语音识别结果「插到光标处」(owner:「语音输入只能从无到有…我选择光标在哪个地方继续输入，这个功能有问题」)。
//
//   · 键盘模式的输入框里有一个小麦克风(手机 / 双栏),桌面是工具栏的麦克风:按住说话,松手把
//     识别文字插到**按下那一刻**的光标处;选中了一段就替换那一段。插完光标落在插入文字之后。
//   · 语音模式的「按住 说话」大条:插到**草稿卡片**里的选区(owner:「在语音模式下也能选插入位置，
//     键盘模式的麦克风太小不好按」)。卡片可以点着放光标、长按 / 拖动选中,但不弹软键盘;没点过卡片 =
//     末尾,插完光标落在插入文字之后 → 连着按就是依次往后接(#422 的「接着说」不变)。
//
// 为什么要在「按下那一刻」冻结选区:安卓上按麦克风可能让输入框失焦,失焦 / 键盘收起时还可能
// 再报一次 onSelectionChange;网页上 mousedown 会把焦点挪走。录音期间之后到的选区事件一律不算数。
//
// 纯逻辑,不 import react-native。

export type TextSelection = { start: number; end: number };

/** 这次按住说话是从哪个按钮发起的。 */
export type VoiceSource = 'holdBar' | 'fieldMic' | 'desktopMic';

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;
/** index 落在一个代理对(emoji 等)中间吗:左边是高位、右边是低位。 */
const splitsPair = (s: string, i: number) => i > 0 && i < s.length && isHigh(s.charCodeAt(i - 1)) && isLow(s.charCodeAt(i));

/**
 * 把一个(可能过期 / 越界 / 反向 / 劈开 emoji 的)选区规整成对当前文本合法的选区。
 * 没有选区(从没报过)= 光标在末尾。光标劈开 emoji → 挪到 emoji 之后;范围劈开 emoji → 向外扩到整个字。
 */
export function clampSelection(sel: TextSelection | null | undefined, text: string): TextSelection {
  const len = text.length;
  if (!sel || !Number.isFinite(sel.start) || !Number.isFinite(sel.end)) return { start: len, end: len };
  let start = Math.max(0, Math.min(len, Math.trunc(Math.min(sel.start, sel.end))));
  let end = Math.max(0, Math.min(len, Math.trunc(Math.max(sel.start, sel.end))));
  if (start === end) {
    if (splitsPair(text, start)) start = end = start + 1;
    return { start, end };
  }
  if (splitsPair(text, start)) start -= 1;
  if (splitsPair(text, end)) end += 1;
  return { start, end };
}

const LATIN_WORD = /[A-Za-z0-9]/;

/**
 * 把识别文字插进 draft 的选区(替换选中的部分),返回新文本和插入后光标位置(紧跟插入文字)。
 * 空格规则(和 #418 的末尾追加同一条):只有交界两侧都是拉丁字母 / 数字时才补一个空格;
 * 中文、标点、已有空白处直接相接。左右两边各自判断。识别文字首尾空白去掉;为空时原样返回。
 */
export function insertAtSelection(draft: string, text: string, sel: TextSelection | null | undefined): { value: string; cursor: number } {
  const base = draft || '';
  const s = clampSelection(sel, base);
  const t = (text || '').trim();
  if (!t) return { value: base, cursor: s.end };
  const before = base.slice(0, s.start);
  const after = base.slice(s.end);
  const leftSpace = before.length > 0 && LATIN_WORD.test(before[before.length - 1]) && LATIN_WORD.test(t[0]) ? ' ' : '';
  const rightSpace = after.length > 0 && LATIN_WORD.test(after[0]) && LATIN_WORD.test(t[t.length - 1]) ? ' ' : '';
  const inserted = leftSpace + t;
  return { value: before + inserted + rightSpace + after, cursor: before.length + inserted.length };
}

/**
 * 输入框选区的跟踪器:onSelectionChange 一直喂 track();按下麦克风时 freeze() 拍一张快照;
 * 松手识别完 take() 取走快照(只取一次)。录音期间到的 track() 只更新「当前」,不碰快照。
 */
export type SelectionCapture = {
  track(sel: TextSelection): void;
  /** 选区失效(草稿被别处整体改写,例如全屏编辑器):当作光标在末尾。 */
  reset(): void;
  freeze(): void;
  take(): TextSelection | null;
  /** 调试 / 测试用。 */
  peek(): { live: TextSelection | null; frozen: TextSelection | null };
};

export function createSelectionCapture(): SelectionCapture {
  let live: TextSelection | null = null;
  let frozen: TextSelection | null = null;
  return {
    track(sel) { live = sel && Number.isFinite(sel.start) && Number.isFinite(sel.end) ? { start: sel.start, end: sel.end } : null; },
    reset() { live = null; },
    freeze() { frozen = live ? { ...live } : null; },
    take() { const f = frozen; frozen = null; return f; },
    peek: () => ({ live, frozen }),
  };
}

/**
 * 识别结果插到哪:三个麦克风都插到按下时冻结的选区(大条 = 草稿卡片的选区,另两个 = 输入框的选区);
 * 没有快照(从没点过卡片 / 输入框)= 末尾。返回 null 表示末尾。
 */
export function voiceInsertTarget(_source: VoiceSource, frozen: TextSelection | null): TextSelection | null {
  return frozen;
}

/**
 * 插完之后要不要把焦点还给输入框:输入框麦克风 / 桌面麦克风要(用户本来就在打字);大条不要(#422:不弹键盘 ——
 * 光标由草稿卡片自己显示,卡片不弹软键盘)。
 */
export function refocusAfterInsert(source: VoiceSource): boolean {
  return source !== 'holdBar';
}

/**
 * 给麦克风的 responder 手势包一层:在**按下的第一时间**(onResponderGrant,早于任何失焦)执行 onPressStart
 * (记下来源 + 冻结选区),再交给原来的处理。canStart() 为 false(还在识别上一句)时不覆盖快照 ——
 * 否则上一句的结果会插到这一次按下时的位置。
 */
export function withPressStart<H extends { onResponderGrant: (e: any) => void }>(handlers: H, onPressStart: () => void, canStart: () => boolean): H {
  return {
    ...handlers,
    onResponderGrant: (e: any) => {
      if (canStart()) onPressStart();
      handlers.onResponderGrant(e);
    },
  };
}

/** 按下麦克风的第一时间冻结当前选区(三个麦克风都是;大条冻结的是草稿卡片的选区)。返回本次来源。 */
export function beginVoicePress(source: VoiceSource, capture: SelectionCapture): VoiceSource {
  capture.freeze();
  return source;
}

/**
 * 网页 / 桌面 webview 上 TextInput 的宿主是 <textarea>:按下时直接读它的 selectionStart/End,比等 onSelect
 * 事件可靠(事件异步,程序化 setSelectionRange 甚至不报)。原生 ref 没有这两个数字属性 → null。
 */
export function hostSelection(el: unknown): TextSelection | null {
  const n = el as { selectionStart?: unknown; selectionEnd?: unknown } | null | undefined;
  if (!n || typeof n.selectionStart !== 'number' || typeof n.selectionEnd !== 'number') return null;
  return { start: n.selectionStart, end: n.selectionEnd };
}

/**
 * 语音模式按住期间,流式中间结果在草稿卡片的光标处预览:只画、不进草稿(上滑取消时草稿不用回滚;终稿常改写
 * 中间结果,松手后终稿替换预览)。返回卡片上显示的文字和选区:有中间结果 = 预览插在冻结的选区处(选中的那段
 * 先被预览顶掉,终稿也会替换它),光标跟在预览之后;还没出字 = 草稿原样、选区原样。
 */
export function previewAtSelection(draft: string, interim: string, frozen: TextSelection | null | undefined): { value: string; selection: TextSelection } {
  const base = draft || '';
  if (!(interim || '').trim()) return { value: base, selection: clampSelection(frozen, base) };
  const r = insertAtSelection(base, interim, frozen);
  return { value: r.value, selection: { start: r.cursor, end: r.cursor } };
}

/**
 * 点 ⌨ / 🔊 切换键盘 ↔ 语音:选区原样带到另一边(草稿卡片 ↔ 输入框是同一份草稿、同一个选区)。
 * 切换的那一刻就拍下来 —— 新挂上的输入框 / 卡片可能先报一次自己的默认选区,那一次不能算数。
 */
export function selectionAcrossModeSwitch(live: TextSelection | null | undefined, draft: string): TextSelection {
  return clampSelection(live, draft || '');
}
