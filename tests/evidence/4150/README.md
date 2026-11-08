# #4150 客户端受控 Hub 证据（无 secret）

这些是 **受控 Hub（harness mock）** 下真实 UI 点击的日志与驱动，用于复查，不代表真后端/真机验收。

| 文件 | 内容 | 结果 |
|---|---|---|
| `neg-4099-core.log` | 模型/档位：读回不匹配不 applied（A1/A2/A3）、双击 1 写（C）、切目标在途（B）、新 target 可再写（B2）、applied 正向（E1）、update_id 不匹配（E2） | 18/18 |
| `neg-create-ui-first.log` | newSession 三链首跑（当时 selection_scope 取成初始目录请求 `srcdir_1`） | 14/14，但暴露合同偏差 |
| `neg-create-ui-after-scope-fix.log` | 修 `server_id` 第二次 POST 后：`selection_scope=srcdir_sel1` | 14/14 |
| `neg-4099-core.mjs` / `neg-create-ui.mjs` | 对应驱动（含 __routeOverride 夹具） | — |

复跑方式
```bash
WEB_DIR=<expo web export> node tests/evidence/4150/neg-4099-core.mjs
WEB_DIR=<expo web export> node tests/evidence/4150/neg-create-ui.mjs
```

口径
- 全部为 harness mock；真本地隔离 Hub、Mac/Windows 安装验收、原生 variant 死锁保护均**未验**；
- 驱动里没有 token/secret；夹具数据是合成值。
