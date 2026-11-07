# 更正：登录「静默不提交」是我脚本的选择器问题，不是客户端缺陷

## 现象（我上一轮的误判）

同一套参数跑三次，两次停在登录页、`CALLS: []`、`ERRS: []`，我据此判断是「客户端登录按钮偶发不提交」。

## 实测定位

用 DOM 结构探测该按钮：

```
输入框 3 个，值都正确写入（url / username / password，长度正确）
但按钮元素链：
  DIV rect [448,513,384,40] pointer-events: auto   ← 真正的可点区域
  该 DIV **没有 role="button"**（本构建未设 accessibilityRole）
```

而我的脚本用的是 `locator('[role="button"]', { hasText: "登录工作区" })`，
匹配不到 → Playwright 抛「元素不存在」→ 被 `.catch(() => {})` 吞掉 → 表现为「点了没反应」。

## 更正做法（3/3 稳定）

按文本找到元素、取其 rect、用坐标点击：

```
box = {x:448,y:513,w:384,h:40}
page.mouse.click(448+192, 513+20)
→ run1/2/3 全部 loggedIn=true，loginRequests=1（SUMMARY ok=3/3）
```

即：**客户端登录是正常的**；前两轮记的「UX 缺陷」作废，这里更正。

## 教训（写下来防复发）

- 自动化里 `.catch(() => {})` 会把「选择器不匹配」伪装成「功能无响应」；
- 断言前要先确认元素真的存在（count>0），否则应显式失败。
