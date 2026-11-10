# 在本地跑完整自检（483 个文件，约 72 秒）

CI 的 `unit-tests` 要走 `stub drives ×8` + `pods` + `unittest` 串行，一次往返约 15 分钟。
本地这套跑完整 483 个自检文件只要 **1 分 12 秒** —— 改客户端之前先跑一次，能省掉大部分 CI 往返。

## 一次性准备

```bash
cd <repo>
npm ci --ignore-scripts --no-audit --no-fund     # 约 21 秒，581 个包
```

`--ignore-scripts` 是有意的：本仓自检只需要 JS 依赖，不跑原生模块的 postinstall。

## 每次跑

```bash
node scripts/run-tests.mjs
```

成功的样子：

```text
=== 483/483 test files passed ===
```

（2026-11-10 实测：483/483，`real 1m12s`。）

## 跑法上的两个坑（都真实踩过）

### 1. 这里用的是 `bun <file>`，不是 `bun test`

`scripts/run-tests.mjs` 把每个 `*.test.ts` 当**自检脚本**执行。
所以：

```text
❌ import { describe, test } from 'bun:test'   → error: Cannot use describe outside of the test runner
✅ 仓库风格：assert + console.log('PASS: …') + process.exit(0)
```

（本地能跑之后，这个错误不会再浪费一次 CI。）

### 2. 有一条护栏会拦“看起来很正常”的写法

`src/daemon-overview.test.ts` 有一条不变量：

```text
UI 源码里不许出现  npm i|install|add … @sleep2agi/(agent-node|agent-network)
```

理由写着：两个包的 dist-tag 会独立变化，拼出来的“配对”不一定成立。
所以任何“给用户一条能粘贴的安装命令”的 UI 想法，都会被这条挡下 —— 这是**有意的**，
正确做法是显示事实 + 指向 `anet pair`。

## 它不能替代什么

```text
· Rust 侧（cargo check / 打包）：要走 CI 或本地 cargo
· Docker 类 job（web export、avatar editor 等）：本地没有对应镜像
· typecheck：需要 tsc（tsconfig.build.json），依赖装好后可用 node_modules/.bin/tsc 跑
```

也就是说：本地这套覆盖的是「483 个 JS 自检文件」，CI 里还有几类 job 仍必须等。
