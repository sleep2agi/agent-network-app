# HTTP 登录：首次包含此修复的 TestFlight 构建

出包前向负责人确认源码 SHA 和预计 build；工作流分配后记录实际 run number。TestFlight「测试内容」填：**支持用 HTTP 地址登录（公司内网部署常用）**。

在安装该签名构建的同一台 iPhone 上，用已授权的测试账号分别从退出状态登录 `http://内网IP:端口`、`http://域名:端口`、`https://域名`。HTTP 域名使用普通多段 DNS 名（不要用 `.local`），确认直接登录而不是重定向到 HTTPS。每次记录构建号、系统版本、地址类别、是否进入预期工作区。不要记录密码、令牌或真实地址。

旧包帮助文案：如果 iOS 0.2.613 (464) 使用 HTTP 域名显示「连不上 Hub」，即使域名可达，也可能是该版本的系统网络策略限制。请向管理员索取 HTTPS 入口。

App Review: Users enter the address of their own self-hosted server, which is often reachable only over HTTP on a private network and cannot be known in advance.
