# READY 环境（shared-ui…426feee1）浏览器联测：首个阻塞

环境：容器 `shared-ui-20261107t215156z-426feee1`，UI `127.0.0.1:18080`、Hub `127.0.0.1:18081`
（仅该 container netns 可达）。容器内自测：UI 200 / Hub /health 200。
`/state/operator.json` 0600 由 `docker exec` 私下读取，未打印、未提交。

## 浏览器怎么起来的（可复现）

宿主无带依赖的浏览器镜像，容器 glibc 2.36 < 宿主 chromium 所需 2.38。最终可用组合：

```
docker run --rm --network container:shared-ui-…-426feee1 --user 0 \
  -v <host bun>:/usr/local/bin/bun:ro \
  -v <dashboard node_modules>:/pw/node_modules:ro \
  -v ~/.cache/ms-playwright:/ms-playwright:ro \
  -v /tmp/opencode/hostlib:/hostlib:ro          # 宿主 /usr/lib/x86_64-linux-gnu 去掉 glibc 家族
  -v <cred>:/cred/operator.json:ro -v <drive>:/drive.mjs:ro \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright -e LD_LIBRARY_PATH=/hostlib \
  --entrypoint /usr/local/bin/bun space/py-noapp:t run /drive.mjs
   # 关键：chromium 必须以 --single-process --no-zygote 启动，否则 Page crashed
```

结果：页面正常渲染（标题 `ANet`、3 个输入框、蓝色登录按钮，见截图 `out-after-login.png`）。

## 第一个阻塞（实测）

```
登录按钮 pressable box = {x:448, y:525.5, w:384, h:40}
输入框已填（Hub / username / password）
点击该坐标 / dispatchEvent(click) 后：
   CALLS:  []        ← 没有任何请求（连 /api/auth/login 都没有）
   ERRS:   []        ← 无 console error、无 requestfailed
   BODY:   仍停在登录卡片
```

即：**press 事件没有触发应用的提交逻辑**（不是 CORS、不是网络、不是 401）。
需要 2 号确认该 harness 的 UI 是否被真实浏览器验证过，以及登录按钮的 handler 绑定方式
（RNW Pressable 是否依赖 pointerdown/pointerup，或用的是 onPressIn）。

## 未做

- fork：已知 9ae stock 版本门拒绝 patch、gate OFF，不手动开、不 fallback
- Mac/Win：无 host，不完成
