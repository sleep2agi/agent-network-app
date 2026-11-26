// @ 选 Agent — run: bun src/mention-menu.test.ts
import { readFileSync } from "node:fs";
import {
  applyMentionReplacement,
  mentionCandidates,
  mentionMenuOpen,
  mentionQuery,
  mentionSpanAt,
  mergeMentionAgents,
} from "./mention-menu";

let passed = 0;
let total = 0;
const ck = (name: string, ok: boolean) => {
  total++;
  if (ok) { passed++; console.log("✅", name); }
  else console.log("❌", name);
};

// 基础规则（向后兼容）
ck("普通消息不开", mentionQuery("你好") === null && !mentionMenuOpen("你好"));
ck("转义的 @ 不开", mentionQuery("\\@通信牛") === null);
ck("空 @ 打开", mentionQuery("@") === "");
ck("有空格就关，避免挡正文", mentionQuery("@通信牛 在吗") === null);
ck("按别名过滤", mentionCandidates("@通信", [{ alias: "通信牛" }, { alias: "通信欧" }, { alias: "TMAI欧" }]).map(x => x.alias).join(",") === "通信牛,通信欧");
ck("选中只填草稿", mentionCandidates("@牛", [{ alias: "通信牛", online: true }])[0].insert === "@通信牛 ");
ck("在线的排前面", mentionCandidates("@", [{ alias: "乙", online: false }, { alias: "甲", online: true }])[0].alias === "甲");
ck("同名只留一条", mentionCandidates("@", [{ alias: "通信牛" }, { alias: "通信牛" }]).length === 1);
ck("空别名不出现", mentionCandidates("@", [{ alias: "  " }]).length === 0);

// 句中触发 + 光标替换 + 邮箱免疫
ck("句中空格后 @ 触发", mentionQuery("你可以找 @小苹果") === "小苹果" && mentionMenuOpen("你可以找 @小苹果"));
ck("中文后紧跟 @ 也触发", mentionQuery("你可以找@神") === "神");
ck("句中转义 \\@ 不触发", mentionQuery("发给 \\@神鸽") === null);
ck("邮箱地址不误触发", mentionQuery("联系 foo@example.com") === null && mentionQuery("a.b+1@test") === null);

{
  const mid = mentionCandidates("你可以找 @小苹果", [{ alias: "小苹果ANet测试鸽", online: true }])[0];
  ck("句中选中只替换 @token，保留前缀", mid.insert === "你可以找 @小苹果ANet测试鸽 " && mid.cursor === "你可以找 @小苹果ANet测试鸽 ".length);

  const text = "先找 @神 测一下";
  const span = mentionSpanAt(text, 5);
  ck("光标在句中 @神 后精准识别 span", span?.start === 3 && span?.end === 5 && span?.query === "神");
  const midCursor = mentionCandidates(text, [{ alias: "神鸽", online: true }], 5)[0];
  ck("句中光标替换保留前后文且不产生双空格", midCursor.insert === "先找 @神鸽 测一下" && midCursor.cursor === 7);

  const noSpaceAfter = applyMentionReplacement("找@神吧", { start: 1, end: 3, query: "神" }, "神鸽");
  ck("后面紧贴非空白字符时自动补空格", noSpaceAfter.value === "找@神鸽 吧" && noSpaceAfter.cursor === 5);
}

// 脏数据防御 + daemon 过滤 + 描述匹配 + 渐进合并
{
  const dirty = mentionCandidates("@神", [
    { alias: null },
    { alias: undefined },
    { alias: "神守护", role: "host_supervisor", online: true },
    { alias: "神鸽", online: true, description: "负责内容分发" },
    { alias: "通信鸽", online: true, label: "神速调度员", description: "发版统筹" },
  ]);
  ck("空/null alias 不崩，daemon 被过滤，alias 与 display_name 均命中且别名优先",
    dirty.map(x => x.alias).join(",") === "神鸽,通信鸽");

  const statusOnly = mergeMentionAgents(null, [
    { alias: "神鸽", status: "idle" },
    { alias: "离线鸽", status: "offline" },
    { alias: null, status: "idle" },
  ]);
  ck("/api/nodes 失败或未回来时仅凭 /api/status 也能产出候选",
    statusOnly.length === 2 && statusOnly.find(x => x.alias === "神鸽")?.online === true && statusOnly.find(x => x.alias === "离线鸽")?.online === false);

  const enriched = mergeMentionAgents(
    [
      { alias: "神鸽", display_name: "主神鸽", description: "第一行职责\n第二行细节", role: "node" },
      { alias: "守护进程", role: "host_supervisor" },
      { alias: null, role: "node" },
    ],
    [
      { alias: "神鸽", status: "idle" },
      { alias: "守护进程", status: "idle" },
      { alias: "额外在线鸽", status: "working" },
    ],
  );
  ck("合并后隐藏 host_supervisor、保留 display_name/单行简介与额外在线节点",
    enriched.length === 2
    && !enriched.some(x => x.alias === "守护进程")
    && enriched.find(x => x.alias === "神鸽")?.description === "第一行职责"
    && enriched.find(x => x.alias === "神鸽")?.label === "主神鸽"
    && enriched.find(x => x.alias === "额外在线鸽")?.online === true);
}

// UI & 接线回归守卫
const chat = readFileSync(new URL("./ChatScreen.tsx", import.meta.url), "utf8");
const suggest = readFileSync(new URL("./ComposerSuggest.tsx", import.meta.url), "utf8");
ck("ChatScreen 不再用一错全空的 Promise.all([fetchHubNodes, fetchStatus])",
  !chat.includes("Promise.all([fetchHubNodes(cfg), fetchStatus(cfg)])"));
ck("ChatScreen 接入缓存与悬浮锚点 composerSuggestAnchor",
  chat.includes("mentionAgentsCache") && chat.includes("composerSuggestAnchor"));
ck("ComposerSuggest 具备 loading / error / retry / 头像与紧凑浮层宽度",
  suggest.includes('testID="composer-suggest-loading"')
  && suggest.includes('testID="composer-suggest-error"')
  && suggest.includes('testID="composer-suggest-retry"')
  && suggest.includes("AliasAvatar")
  && suggest.includes("maxWidth: 440"));

console.log(`${passed}/${total}`);
if (passed !== total) process.exit(1);
