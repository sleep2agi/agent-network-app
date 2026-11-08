# 真实链打通：newSession → registered（registration_confirmed）

环境：hub4150sv `127.0.0.1:8898`（输入树 9ae2a955 / 实现 6917c7ef 自建镜像），
客户端 ecb6ca37 的既有 web export（浏览器内真实 fetch），
daemon = 该树 worker 模块（我的副本 `sv-run`，输入树未改），
原生侧 = **固定测试二进制** `opencode serve`（sha256 `1cf5fccc…`，与 runbook 一致），
provider = 本地 OpenAI 兼容 stub（127.0.0.1:8921，仅够建会话）。

## 结果

```
directory POST 200 → ready  servers=1
select    POST 200 → ready  projects=1  selection_expires_at=…
create    POST 200 create_pending
final     registration_confirmed   operation_kind=project_new_session
          creation=confirmed  child=node_prjc_2a09132d-…
子进程     argv: node start sv-child-real-5
          env : ANET_SOURCE_RESUME_CONFIG=<child>/config.json + ANET_SOURCE_RESUME_NONCE=<uuid>
          log : [sv-child-real-5] OpenCode v2 co-presence PREVIEW …
```

`registration_confirmed` 只是注册回执，**不等于健康/在线**；`registration_is_health=false`。

## 让它跑通的三处配对约束（都来自实现，不是猜）

| 约束 | 要求 | 本次配置 |
|---|---|---|
| agent-node 包身份 | `name=@sleep2agi/agent-node`、`version=2.5.0-preview.182`、`publishConfig.tag=preview`、`bin.agent-node=dist/cli.js` | 按此构造包 |
| 包路径可信 | 祖先目录不得 group/world 可写（`/tmp` 不合格） | 放在 `/home/vansin/sv-pkg` |
| 原生版本 | `acceptsSharedVersion`: `2.0.22` 或 固定测试版本 + 进程证据 | 真二进制 `2.0.22-anet-test.29040e2` |

## 仍未做

- same child 高档 / clear + ack 的 UI 状态
- attach / fork 按钮
- Mac/Win 任何安装验收
