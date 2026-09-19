/**
 * 消息右键/长按菜单的分组模型（Vincent 2026-09-19：「在消息上右键的效果和微信对齐一下，
 * 是有单独的部分显示转发啥的，而不是只显示在最下面」）。
 *
 * 微信的形状是**分组 + 分隔线**，不是一条流水账：
 *   第一组 = 对这条消息本身做的事；第二组 = 把它挪到别处；第三组 = 删除（红色，单独一组）。
 * 危险动作和常用动作之间必须隔着一条组边界，手滑点不到才算对齐。
 *
 * 这里只产出模型，不碰渲染：组边界、可用性、danger 标记都能脱离 react-native 测。
 */

export interface MessageMenuItem {
  /** 稳定键，渲染与测试都按它取，不按文案。 */
  readonly key: MessageMenuKey;
  readonly label: string;
  /** 破坏性动作：渲染成红色，且必须独占最后一组。 */
  readonly danger?: boolean;
}

export type MessageMenuKey = 'copy' | 'quote' | 'forward' | 'multiSelect' | 'expand' | 'delete';

export type MessageMenuGroup = readonly MessageMenuItem[];

export interface MessageMenuContext {
  /** 这条消息有没有可复制/可转发/可引用的正文。空气泡（纯附件）没有。 */
  readonly hasText: boolean;
  /** 已经在多选模式里时不再提供「多选」。 */
  readonly selectionMode?: boolean;
  /** 转发要拿目标名册；没有可达 hub 时不提供（避免点开一个空选择器）。 */
  readonly canForward?: boolean;
}

/**
 * 菜单分组。空组会被丢掉——一条分隔线下面什么都没有是渲染 bug，不是布局。
 */
export function messageMenuGroups(ctx: MessageMenuContext): MessageMenuGroup[] {
  const canForward = ctx.canForward !== false && ctx.hasText;
  const groups: MessageMenuItem[][] = [
    [
      ...(ctx.hasText ? [{ key: 'copy' as const, label: '复制' }] : []),
      ...(ctx.hasText ? [{ key: 'quote' as const, label: '引用' }] : []),
    ],
    [
      ...(canForward ? [{ key: 'forward' as const, label: '转发…' }] : []),
      ...(ctx.selectionMode ? [] : [{ key: 'multiSelect' as const, label: '多选' }]),
      ...(ctx.hasText ? [{ key: 'expand' as const, label: '放大阅读' }] : []),
    ],
    [{ key: 'delete' as const, label: '删除', danger: true }],
  ];
  return groups.filter(group => group.length > 0);
}

/** 扁平化，供「菜单里到底有哪些项」这类断言使用。 */
export function messageMenuKeys(ctx: MessageMenuContext): MessageMenuKey[] {
  return messageMenuGroups(ctx).flatMap(group => group.map(item => item.key));
}

/** 多选底栏的动作：转发按 hub 可达性给，删除永远在。 */
export function selectionBarActions(count: number, canForward: boolean): readonly MessageMenuItem[] {
  if (count <= 0) return [];
  return [
    ...(canForward ? [{ key: 'forward' as const, label: `转发…（${count}）` }] : []),
    { key: 'delete' as const, label: `删除（${count}）`, danger: true },
  ];
}
