# Agent Network App 本地数据存储规范

## 目标

桌面与移动端支持多个 Hub、多个账号安全共存和即时切换。任何本地数据都必须按 Profile 隔离，禁止把 A Hub 的 token、缓存、未送达消息或偏好带到 B Hub。

Profile 的逻辑身份为 `normalized hub URL + username + network_id`，应用使用稳定的非敏感 `profile-id` 引用它。

## 路径约定

统一命名空间采用 `.anet/app`，不新增容易混淆的 `~/.anet_app`。

- macOS/Linux 共享数据根：`~/.anet/app/`
- Windows 共享数据根：`%USERPROFILE%\.anet\app\`
- 移动端：系统分配的 app document/cache 目录

桌面端由 Rust 命令解析用户主目录，并只接受无 `..` 的相对路径；前端不能传绝对路径。`.anet/app` 只承载 Agent Network 生态需要共享或可诊断的数据；系统沙箱数据仍留在系统 app-data 目录。

```text
.anet/app/
├── schema.json
├── profiles.json                 # 非敏感索引，不含 token/password
├── active-profile                # 当前 profile-id
├── profiles/<profile-id>/
│   ├── preferences.json          # 主题、置顶会话等
│   ├── outbox.json               # 未送达消息
│   └── avatars.json              # 本地头像覆盖
└── cache/<profile-id>/            # 可安全删除、可重新下载
```

## 敏感数据

- 密码只用于登录请求，永不落盘。
- token 每个 Profile 单独存入平台凭据库：Apple Keychain、Windows Credential Manager、Android Keystore。
- `profiles.json` 只保存 Hub URL、用户名、network id、显示名称和时间戳。
- 日志、错误、埋点和导出诊断不得包含 token。

## 生命周期

1. 登录成功：写 token，再原子更新 Profile 索引和 active pointer。
2. 切换账号：停止旧 Profile 的 poll/SSE，清空内存快照，以 Profile key 重挂 UI，再启动新连接。
3. 删除账号：删除 token 和该 Profile 的持久数据；共享下载缓存可延迟清理。
4. token 失效：保留 Profile 元数据，标记“需要重新登录”，不得静默切到其他账号。
5. 旧版迁移：把 `hub_config_v1` 转成首个 Profile；新记录成功后才删除旧键。

## 版本与原子性

- 所有 JSON 顶层带 `schemaVersion`；未知新版本只读失败，不覆盖。
- 文件写入采用临时文件 + rename；缓存失败不得阻塞主流程。
- token 写入成功但索引失败时，下次启动执行孤儿凭据清理；索引存在但 token 缺失时显示重新登录。
