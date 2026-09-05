# test-composer-drag-browser — app#240 分隔条拖拽真浏览器对照

不进 CI(需要 playwright + Chromium)。渲染两块并排面板:左边是 0.2.46 的分隔条接线原样
(PanResponder 按高度重建、不 preventDefault、无 userSelect),右边是修复后的
`composerDragHandlers`;用真鼠标 down → 上移 140px(中途拐到消息列表上)→ up,量高度、
选区字符数、mousedown 是否被 preventDefault、body user-select 是否锁住又还原。

左边是**阳性对照**:它必须复现「拖不动 + 全选」,否则脚本以非零退出——量具先证明自己看得见缺陷。

2026-09-05 实测(Chromium headless,react-native-web 0.21.2):

| | 起始 | 拖 40 | 拖 100 | 拖 140 | 松手 | mousedown preventDefault | 选中字符 | body user-select 拖拽中/后 |
|---|---|---|---|---|---|---|---|---|
| 0.2.46 形状 | 200 | 205 | 205 | 205 | 205 | false | 232 | '' / '' |
| 修复 | 200 | 240 | 300 | 340 | 340 | true | 0 | none / '' |

运行:`PLAYWRIGHT_MODULE=<playwright/index.mjs 绝对路径> bash tests/test-composer-drag-browser/run.sh`
(截图落在 `out/old-during.png` / `out/fixed-during.png`)。
