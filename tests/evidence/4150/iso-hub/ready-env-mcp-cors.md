# READY 环境：UI 无法调用 /mcp（预检头不匹配）——变体/模型路径首阻塞

真实浏览器（官方 playwright 1.59.1 镜像，--network container:…426feee1，--user 1000:1000）已跑通：
登录 → 目录 → 新 Session = `registration_confirmed`（见 ready-env-chain.md）。

下一步「同 child high / clear」走的是 UI 的 `update_node_config`（`POST ${hub}/mcp`），实跑失败：

```
page.evaluate → TypeError: Failed to fetch   (at patchVariant, POST /mcp)
```

容器内直接做预检，原因确定：

```
OPTIONS /mcp  → 204
  access-control-allow-origin : http://127.0.0.1:18080
  access-control-allow-headers: Content-Type, Authorization
  access-control-allow-methods: GET, POST, PUT, DELETE, OPTIONS
```

客户端实际发送的头（`src/api.ts` 的 update_node_config 调用）：

```
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2025-03-26
Content-Type, Authorization
```

`mcp-protocol-version` 与 `accept` 不在 allow-headers 里 ⇒ 预检失败 ⇒ 浏览器拒绝 `/mcp`
⇒ **UI 侧完全无法修改模型/档位**（不只是档位，任何走 MCP 的功能都不行）。

同类问题还有 SSE：`/events/users/me` 的 `cache-control` 头同样被拒（已单独报）。

## 需要的（Hub 侧配置，不改客户端）

- 把 `mcp-protocol-version`、`accept` 加进 `Access-Control-Allow-Headers`（或让 UI 与 Hub 同源）
- SSE 允许 `cache-control`

## 未做

- fork：9ae stock 版本门拒绝 patch、gate OFF，不手动开、不 fallback

## 容器内 RPC 对照（不经浏览器，排除 CORS）

脚本 `ctl-variant.ts`（docker exec 在 READY 容器内跑，读 /state 私有配置，不打印 token）：

```
directory → ready · select → ready · 新 Session → registration_confirmed
child = node_prjc_fdf3e73c-…

high  : POST /mcp 200 但 payload = {"ok":false,"error":"variant_unsupported"}
clear : POST /mcp 200 payload = {"ok":true,"update_id":"cu_b408c00a-…","apply_mode":"hot"}
        → /api/nodes/<child>/config 读回 last_update.applied、modelVariant=null、model=fixture/model
```

于是可以分开说：
- **后端/运行时能做**：clear 真实 applied（hot），读回一致；
- **high 被明确拒绝**：`variant_unsupported`（不是静默失败）——该 child 的原生 catalog 上没有 high 档；
- **UI 更早就被挡**：`/mcp` 预检不允 `mcp-protocol-version`/`accept`，浏览器根本发不出去。

三者是不同层次的阻塞，不能混为一谈。

## high 被拒的下一层原因：catalog 没有 variants

容器内查全部节点（无 secret，只读）：

```
ctl-var-… / ui-real-… / ui-seed-source / ui-var-… → opencode_variant_config_capable = true
ui-ready-daemon / ui-ready-anchor                    → false
```

但 `opencode_catalog` 是**扁平的模型 id 列表**，没有 per-model variants：

```
["opencode/longcat-2.5-preview-free", …, "fixture/model"]
```

而原生 harness 的 `opencode.json` 里确实写了 `variants: [{id:"high"},{id:"low"}]`。
⇒ Hub 侧按 catalog 判断「该模型没有 high 档」→ `variant_unsupported`。
这不是客户端问题，也不是 CORS 问题，是 **catalog 未携带 variants 元数据**（或 Hub 未从 config 能力推出可选档位）。

clear（写 null）不需要档位存在，所以 applied(hot) 成功 —— 与上面完全自洽。
