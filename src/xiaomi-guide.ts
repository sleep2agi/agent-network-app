// 「小米/HyperOS 后台设置指引」的文案(纯数据,设置页的弹窗渲染它)。
// 小米/澎湃 OS 默认会在应用退到后台后很快冻结或清掉它,前台服务也会被「省电策略」连带杀掉 ——
// 不改这两项,「后台保持连接」在小米上撑不了多久。两项都在本应用的「应用详情」页里,
// 按钮直接用 intent 打开那一页(与「软件更新」里打开「安装未知应用」同一个做法)。
//
// 菜单路径按 HyperOS(2024 起的小米系统)写;MIUI 14 的叫法基本相同。不同版本措辞会有出入,
// 所以每一步都给「找什么」而不是只给一串点击顺序。

export type GuideStep = { readonly title: string; readonly detail: string };

export const XIAOMI_GUIDE_TITLE = '小米/HyperOS 后台设置指引';

export const XIAOMI_GUIDE_INTRO =
  '小米手机默认会在应用切到后台后冻结或清理它。想在不打开应用时也收到 agent 的消息,需要在系统里放开下面几项。';

export const XIAOMI_GUIDE_STEPS: readonly GuideStep[] = [
  {
    title: '1. 开启「自启动」',
    detail: '点下方「打开应用设置」→ 找到「自启动」,打开开关。(也可以在「手机管家 → 应用管理 → 权限 → 自启动管理」里找到 Agent Network。)',
  },
  {
    title: '2. 省电策略改为「无限制」',
    detail: '同一页里点「省电策略」(部分版本在「电量与性能」下),选「无限制」。',
  },
  {
    title: '3. 允许通知',
    detail: '同一页里点「通知管理」,打开「允许通知」;「Agent 消息」这一类建议打开「悬浮通知」和「锁屏通知」。',
  },
  {
    title: '4. 在最近任务里锁定应用',
    detail: '打开多任务界面,长按 Agent Network 的卡片,点「锁定」(小锁图标)。一键清理时就不会被关掉。',
  },
  {
    title: '5. 打开本页的「后台保持连接」',
    detail: '通知栏会常驻一条低优先级通知「Agent Network 正在保持连接」,这是系统要求的,关掉它就会断开。',
  },
];

export const XIAOMI_GUIDE_FOOTNOTE =
  '说明:本应用没有接入小米推送,消息靠应用自己保持的连接送达。应用被彻底关闭(包括被系统清理)后收不到通知,重新打开即可。';
