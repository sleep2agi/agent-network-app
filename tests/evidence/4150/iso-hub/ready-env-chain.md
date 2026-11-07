# READY 环境（shared-ui…426feee1）真实浏览器：登录 → 目录 → 新 Session=registration_confirmed

浏览器：官方镜像 `mcr.microsoft.com/playwright:v1.59.1-noble`
（digest `sha256:b0ab6f3cb99aa7803adbc14d9027ec1785fc6e433b97e134e0f8fe61683b6b53`，与本机 playwright 1.59.1 精确对应）

运行方式（非 root、独立合成 HOME、仅容器 netns）：
```
docker run --rm --network container:shared-ui-…-426feee1 --user 1000:1000 \
  -v <dashboard node_modules>:/pw/node_modules:ro \
  -v <私有 operator.json>:/cred/operator.json:ro -v <ready.json>:/cred/ready.json:ro \
  -v /tmp/opencode/browser-shared9ae:/home/pwuser \
  -e HOME=/home/pwuser -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  --entrypoint node mcr.microsoft.com/playwright:v1.59.1-noble /drive.mjs
```

## B 方案（nsenter）实测不可用（精确错误）

```
docker inspect → Running=true PID=2224892
sudo -n true          → "sudo: a password is required"
nsenter --target 2224892 --net -- true → "cannot open /proc/2224892/ns/net: Permission denied"
```
→ 未以 root 运行浏览器，未进入其它 namespace。

## 真实 UI 结果（浏览器）

```
登录：POST /api/auth/login 200 · /api/auth/me 200 · 三个 agent 可见（ui-api / ui-seed-source / ui-ready-daemon）
directory POST 200 → ready  servers=1
select    POST 200 → ready  projects=1  sessions=3
create    POST 200 → registration_confirmed
          operation_kind=project_new_session  creation=confirmed
          child=node_prjc_d9bfdcc1-1f65-4880-9487-32aa255ff5b9
```
child_name 用新值（`ui-real-mw6yh06m`），未复用 seed 已占名。

## 已知非阻塞错误

SSE `/events/users/me` 仍被 CORS 预检拦（`cache-control` 不在 `Access-Control-Allow-Headers`），
不影响 REST 链路；已单独报给 2 号。

## 未做

- same child 高档/clear + ack（下一轮）
- attach（下一轮）
- fork：9ae stock 版本门拒绝 patch、gate OFF，准确显示未开放，不 fallback
