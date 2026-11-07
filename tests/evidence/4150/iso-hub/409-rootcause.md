# 409 project_create_unavailable 根因（实际 HTTP 证据）

环境：hub4150sv `127.0.0.1:8898`（输入树 9ae2a955 / 实现 6917c7ef 自建镜像），
客户端 ecb6ca37 的既有 web export，浏览器真实 fetch；daemon 用该树 worker 模块 + fixture 子进程。

## 对照（同一网络、同一目录 ready 快照）

```
child_name = sv-child-fresh-1（首次）
  directory 200 pending → ready servers=1
  select    200 pending → ready projects=1 selection_expires_at=…
  create    200 create_pending（operation_kind=project_new_session）

child_name = sv-child-fresh-1（再次）
  directory 200 → ready
  select    200 → ready
  create    409 project_create_unavailable
```

## 根因

`session_project_creates` 上有唯一索引 `UNIQUE(network_id, child_name)`
（`sqlite_autoindex_session_project_creates_3`，`PRAGMA index_info` 实数）。

POST 分支在事务内插入该行，重复 child_name 触发约束错误，被
`server/src/session-project-create.ts` 末尾的 `catch { return fail(); }` 统一映射成
409 `project_create_unavailable` —— 所以对外看不出是「名字已被占用」。

**这不是 guard 的缺陷，不需要放宽 guard**：子节点名在同一网络内一次性。
客户端/驱动侧必须对每次「新建会话」使用新的 child_name；若沿用同一个名字重试，
409 是正确结果，只是**错误码不够可区分**（建议服务端区分 duplicate_child_name）。

## 与 launcher / instance / scope 的关系（按通信欧要求记录，无 secret）

- worker instance：每次进程启动 `randomUUID` 生成，更换 launcher 形态**不改变** instance；
  重启 daemon 会换 instance，旧 selection scope 因此自然失效（`select()` 返回 null → 403）。
- parent selection scope：`srcdir_<第一次请求 id>`，请求本身 30s TTL，
  `selection_expires_at` = 接受时刻 + 10 分钟；过期后同样 403。
- live cap：服务端进程内 `live.size >= 100` 才拒绝；本例 DB 记录数 2，远未触及。
- launcher 身份：包装层脚本 → bun → 树内 `agent-network/bin/cli.ts`；
  `--help` 只证明能力串存在，**不等于完整启动授权**，此处只作为前置校验使用。
- 未修改任何 guard，也未用 fixture 伪造注册。
