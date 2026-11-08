# 共享节点 create→deliver 链：从「从未启动」推进到「子进程已启动 + 版本拒绝」

环境：hub4150sv `127.0.0.1:8898`（9ae2a955 / 6917c7ef 自建镜像），客户端 ecb6ca37 的既有 export，
daemon 用该树 worker 模块（我的副本 `/tmp/opencode/sv-run`，未改输入树），launcher 为包装层
`--help` 透传 + 子进程输出留档。

## 已修复的 harness 缺口（逐条实测）

| 缺口 | 现象 | 处理 |
|---|---|---|
| 原生 stub 缺 `/api/model/default` | `session_ready` 不达成，直接 unknown | stub 增加该端点 |
| stub `/api/info` 缺 `pid` | `!Number.isSafeInteger(info.pid)` 抛错 | stub 返回 `pid: process.pid` |
| HOME 权限 | `OpenCode runtime binding refuses HOME: directory must not be group/world writable` | `chmod 700 sv-home`、`sv-home/.anet` |

## 现在的确切进展

```
create 阶段  → session_ready（真 POST /api/session 建出 ses_New…，随后 ack 给 Hub）
deliver 阶段 → 子进程**真的被拉起**：
   argv: node start sv-child-paired-9
   env : ANET_SOURCE_RESUME_CONFIG=/tmp/opencode/iso-project/.anet/nodes/<child>/config.json
         ANET_SOURCE_RESUME_NONCE=<uuid>
   子进程首错：[anet] ❌ source_resume_cli_version_refused
```

## 版本闸的真实约束（读实现得出，非猜测）

```
acceptsSharedVersion(url, info, testOnly):
   info.version === "2.0.22"                                  → 直接通过（但此时 expected_version=2.0.22）
   否则 testOnly && observeSharedTestBuild(url, info.version)  → 必须有**真实进程证据**（pid + 固定二进制哈希）
CLI 侧:
   binary --version 必须匹配 2\.0\.22-anet-test\.29040e2
   且 checked.version === profile.sourceDelivery.expected_version
```

⇒ **原生 stub 无法同时满足两边**：报 `2.0.22` 时子进程因版本不等被拒；报 test 版本时目录读取因
拿不到真实进程证据而判 `directory_read_failed`。唯一自洽配置是**让固定二进制（sha256 `1cf5fccc…`）
真的作为共享 Server 运行**，三处版本才会一致。

未伪造注册、未改 guard、未改输入树。
