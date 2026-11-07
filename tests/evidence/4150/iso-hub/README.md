# 隔离 Hub 真请求链：目录（server → projects → sessions）

2026-11-08。**环境说明（必须按此理解证据强度）**

| 组件 | 真实性 |
|---|---|
| Hub | 真进程：该树自建镜像 `anet-4150-native-project:local`（`tests/test4150-native-project/Dockerfile`，`--network none` 构建），`PORT=8899`，四个 preview gate 打开 |
| 客户端 | 真代码：`src/session-source-directory.ts` 的 body 构造 + `parseDirectoryResponse`（不是 helper/selector 替身） |
| daemon | 真模块：`agent-node/src/runtime/session-source-transport.ts` + `session-control-bridge.ts`（生产 `cli.ts` 接线同一模块），驱动入口见 `iso-daemon.ts` |
| 原生 opencode | **fixture**：`iso-native.ts` 只实现读形状（`/api/info`、`/api/project`、`/api/session`…），**不是真 opencode 运行时** |

因此本文件只证明「客户端 body ↔ Hub 校验 ↔ daemon 读回 ↔ 客户端解析」这一条线，不证明原生运行时行为。

## 本轮用真请求查出的客户端缺陷（已修）

合同 `docs/runbooks/session-source-directory.md:129` 要求第二次 POST 带
`selection_scope: "srcdir_<第一次请求 id>"`；`Server/src` 侧在 `server_id` 存在时缺 `selection_scope` 直接 400。

修复前（`dir-driver3.out`，客户端按已发布实现构造 body）：
```
select POST: 400 {"ok":false,"error":"source_directory_unavailable"}
```
客户端 `buildDirectorySelectBody` 只输出四个字段，且 `postSourceDirectory` 不传父请求 id。

修复：
- `buildDirectorySelectBody(r, serverId, selectionScope)` 输出五字段；新增 `validateDirectorySelect` 在发请求前拒绝缺少/非法 `selection_scope`；
- `api.postSourceDirectory(cfg, req, serverId?, selectionScope?)` 透传并前置校验；
- `SourceForkDialog` 单 Server 自动选择时把第一次 `requestId` 作为 `selection_scope` 传入。

修复后（`dir-driver4.out`）：
```
POST status: 200 keys: daemon_node_id,expires_at,network_id,ok,request_id,source_node_id,status
poll 1: 200 ready
select POST: 200 {...,"server_id":"osrv_...","status":"pending"}
select poll 1: 200 ready
client parse: ready projects=1 sessions=1 servers=1 selExp=null
```

`selExp=null` 是预期的：本轮 daemon 以 `projectEnabled:false/attachEnabled:false` 启动，
daemon 只在开启项目/attach 选择时才下发 `selection_expires_at`（`session-source-directory.ts:156`）。
新会话（`project-create`）需要该字段，因此必须在 launcher pin（`ANET_BIN_ABS` + sha）就绪后开启，属下一轮。

## 链 2：newSession（现有项目 → 新空会话）

`project-driver.ts`（客户端 `buildProjectCreateBody` / `validateProjectCreateSelection` + 真 Hub + 真 daemon project worker）：

```
directory: ready servers=1
select POST: 200 pending
select ready: projects=1 sessions=1 selExp=1794086134400
client validate: {"ok":true}
client body keys: child_name,intent_id,project_id,selection_scope,snapshot_id
project-create POST: 200 {"status":"create_pending","operation_kind":"project_new_session",...}
project-create final: {"status":"unknown_rotation_required","session_creation":"unknown","registration_is_health":false}
```

读数：
- 客户端五字段 body 被 Hub 接受（200 `create_pending`），`selection_scope` 来自「选过 Server 且返回 projects」的那次请求；
- 终态 `unknown_rotation_required` 的原因在 daemon 侧合成子进程：fixture 子进程会 POST `${hub}/fixture-register`，
  那是**测试内建 Hub 才有的 fixture 端点**，真 Hub 不实现 ⇒ 注册无法确认，Hub 按合同落 unknown（不重放、不冒充 registered）。
- 该树自带的 anet CLI 二进制（`/tmp/opencode/anet-4099-test-only-29040e2/.../opencode --help`）
  **不输出** `ANET_CAPABILITY_SOURCE_RESUME_V1`，不能当 launcher pin 用；真链需要 2 号提供带该能力的 CLI 或 fixture 端点。

## 复现命令

```
# 1) Hub（离线构建该树镜像后）
docker run -d --init --network host --name hub4150 \
  -e PORT=8899 -e COMMHUB_DB=/tmp/hub.db \
  -e COMMHUB_SOURCE_FORK_PREVIEW=1 -e COMMHUB_SOURCE_DIRECTORY_PREVIEW=1 \
  -e COMMHUB_PROJECT_NEW_SESSION_PREVIEW=1 -e COMMHUB_SESSION_ATTACH_PREVIEW=1 \
  -w /work/server --entrypoint bun anet-4150-native-project:local run src/index.ts
# 2) 首个用户（自动 admin）+ 网络 + 两个 node token（脚本见对话记录，token 不入库）
# 3) 节点能力（对应生产 report_status 写入的 config_snapshot）
#    p_daemon: {role:"host_supervisor",daemon_capabilities:{source_directory_read,...}}
#    p_source: {flags:{opencodeGeneration:"v2",opencodeMode:"copresence"}} + sessions.env_transport='loopback'
# 4) 原生 fixture + daemon worker
bun run iso-native.ts     # 127.0.0.1:8911
bun run iso-daemon.ts     # 读 /tmp/opencode/iso-{daemon,home}
# 5) 客户端真请求
bun run dir-driver.ts
```

## 读数约束（不夸大）

- `ready` 只代表闭环读回成功；`lease_kind=process_local`、`binding` 恒 `unknown`、`attach_authorized` 恒 `false` 均已按合同保留。
- 原生侧是 fixture，`osrv_`/`snapshot` 内容不代表真机目录。
- 未验证：真 opencode 运行时、`newSession`/`attach`/`fork` 三条链、Mac/Win 安装。
