# 节点「权限」分区(board #489)

Hub RFC-041 第一阶段的界面:节点主人(或网络 owner / admin)给自己的 Agent 选一个模式。

| 模式 | 说明(界面原文) |
|---|---|
| 正常 | 和你一样：你能看、能改的任务它也能，可以给别的 Agent 派活。 |
| 只读 | 只看不动：能看任务、回复派给它的活；不能改任务，也不能给别的 Agent 派活。 |
| 受限 | 只管派给它的任务：别的任务看不到也改不了；只能找你被授权的 Agent，不能群发。 |

**谁能看到**:完全听 Hub 的 —— `GET /api/nodes` 每行的 `viewer_can.permission_mode`(Hub ≥ .93,agent-network#2275)。
为 `true` 才出现「权限」分区;旧 Hub 没有这个字段 ⇒ 不出现(包括 .92:它能改模式,但不告诉 app 谁能改)。
部门负责人、别的成员、节点令牌都是 `false`。只读页(聊天信息里打开的节点页)不出现。

**两套设计**

- 桌面(`1-desktop-section.png`、`2-desktop-report.png`):节点页左栏多一个「权限」分区,紧挨「危险操作」之前;
  右边一行三段的分段控件,下面一句选中项的说明。
- 手机(`3-phone-section.png`、`4-phone-report-dark.png`):顶部分段标签里多一个「权限」;三张竖排的选项卡,
  单选圆点 + 名字 + 一句说明,整张卡可点,每张 ≥ 64 px 高。

**改模式**:点了立刻 `PUT /api/nodes/:id/permission-mode`,成功显示「已改为「受限」，立即生效」;失败回到原来的选项并说明原因
(403「你没有权限修改这个节点的模式」/ 404「找不到这个节点」)。

**报表行**:`GET /api/networks/:id/node-permission-report`(只给网络 owner / admin,别人 403 ⇒ 不显示这一行)。
「过去 7 天本来会拦下 N 次」,点开按原因、按操作分别计数,注脚说明 Hub 现在是只记录还是已经在拦。

测试:`src/node-permission-model.test.ts`(ck)、`tests/test-node-permission-mode/drive.mjs`(页内桩,桌面 + 手机,浅色 + 深色)。
