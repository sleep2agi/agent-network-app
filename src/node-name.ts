// 看板 #652 —— 节点名(= 网络别名)规则,app 侧副本。
//
// 🔴 这一段是 sleep2agi/agent-network 的 server/src/shared/node-name.ts(Hub 与 daemon 共用的唯一来源,
//    agent-node/src/shared/node-name.ts 是它的逐字节副本)里 checkNodeName / normalizeNodeName /
//    NODE_FOLDER_RE / NODE_NAME_CASES 的**逐字**拷贝。规则或 NODE_NAME_CASES 任何一边改了,另一边
//    必须同一轮一起改 —— src/node-name.test.ts 逐条跑 NODE_NAME_CASES,判定不同就红。
//    (slug 一列是 daemon 内部目录名 nodeFolderSlug 的结果,app 不复现;app 的工作目录名仍走
//    create-node-workdir.ts 的 workdirSlug —— 中文转拼音,而不是哈希。)
//
// 以前向导用 /^[a-z][a-z0-9_-]{0,63}$/,owner 输入「测试」被拒。现在:名字可以是中文/任意文字,
// 工作目录(文件夹)必须是英文/ASCII —— 文件夹单独一行显示,可改,规则 NODE_FOLDER_RE。

/** Folder / slug rule: what a working directory or `.anet/nodes/<dir>` may be called. */
export const NODE_FOLDER_RE = /^[a-z][a-z0-9-]{0,63}$/;

export const NODE_NAME_MAX_CHARS = 64;

// First char: a letter, a digit or `_` (never `-`: `anet node start -x` reads as a flag;
// never `.`: hidden files, `..`). Rest: letters, digits, combining marks (Devanagari,
// Thai… need them), `_`, `-`. Nothing else — no whitespace, `/ \ :`, `.`, quotes,
// `$`, backticks, control characters: the name ends up in argv, tmux session names
// (tmux rewrites `.` and `:`), JSON, logs and file names in the trash directory.
const NODE_NAME_RE = /^[\p{L}\p{N}_][\p{L}\p{M}\p{N}_-]*$/u;

export type NodeNameError =
  | "empty"
  | "too_long"
  | "leading_dash"
  | "forbidden_char"
  | "not_nfc";

export type NodeNameCheck =
  | { ok: true; name: string }
  | { ok: false; error: NodeNameError; char?: string; message: string };

/** Trim + NFC. Callers store the returned `name`, not the raw input. */
export function normalizeNodeName(raw: string): string {
  return raw.trim().normalize("NFC");
}

function describeChar(ch: string): string {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 0x20 || cp === 0x7f) return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
  if (/\s/u.test(ch)) return "空格";
  return ch;
}

/**
 * Check a node name. `raw` is trimmed first; the trimmed, NFC form must be
 * 1..64 characters (code points) of letters / digits / `_` / `-`, not starting with `-`.
 */
export function checkNodeName(raw: unknown): NodeNameCheck {
  if (typeof raw !== "string") return { ok: false, error: "empty", message: "名字不能为空" };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, error: "empty", message: "名字不能为空" };
  const chars = [...trimmed];
  if (chars.length > NODE_NAME_MAX_CHARS) {
    return { ok: false, error: "too_long", message: `名字最多 ${NODE_NAME_MAX_CHARS} 个字符` };
  }
  if (trimmed !== trimmed.normalize("NFC")) {
    return { ok: false, error: "not_nfc", message: "名字需要是 Unicode NFC 规范形式" };
  }
  if (chars[0] === "-") {
    return { ok: false, error: "leading_dash", char: "-", message: "名字不能以 - 开头" };
  }
  if (!NODE_NAME_RE.test(trimmed)) {
    const bad = chars.find((ch, i) => !(i === 0 ? /^[\p{L}\p{N}_]$/u : /^[\p{L}\p{M}\p{N}_-]$/u).test(ch)) ?? chars[0]!;
    return {
      ok: false,
      error: "forbidden_char",
      char: bad,
      message: `名字里不能有「${describeChar(bad)}」：只能用文字、字母、数字、_ 和 -`,
    };
  }
  return { ok: true, name: trimmed };
}

export function isValidNodeName(raw: unknown): boolean {
  return checkNodeName(raw).ok;
}

/** Shared test vectors — the app's copy must produce the same verdicts and slugs. */
export const NODE_NAME_CASES: ReadonlyArray<{ input: string; ok: boolean; error?: NodeNameError; slug?: string }> = [
  { input: "测试", ok: true, slug: "node-f78149" },
  { input: "研发助手A", ok: true, slug: "node-1d348f" },
  { input: "AB测试牛", ok: true, slug: "node-048250" },
  { input: "my-bot", ok: true, slug: "my-bot" },
  { input: "MyBot_2", ok: true, slug: "mybot-2" },
  { input: "  spaced  ", ok: true, slug: "spaced" },
  { input: "123", ok: true, slug: "node-123" },
  { input: "_x", ok: true, slug: "x" },
  { input: "Ünïcödé", ok: true, slug: "node-030667" },
  { input: "a".repeat(64), ok: true, slug: "a".repeat(64) },
  { input: "测".repeat(64), ok: true, slug: "node-50c3fb" },
  { input: "", ok: false, error: "empty" },
  { input: "   ", ok: false, error: "empty" },
  { input: "a".repeat(65), ok: false, error: "too_long" },
  { input: "测".repeat(65), ok: false, error: "too_long" },
  { input: "-x", ok: false, error: "leading_dash" },
  { input: "e\u0301", ok: false, error: "not_nfc" },
  { input: ".hidden", ok: false, error: "forbidden_char" },
  { input: "..", ok: false, error: "forbidden_char" },
  { input: "a/b", ok: false, error: "forbidden_char" },
  { input: "a\\b", ok: false, error: "forbidden_char" },
  { input: "a:b", ok: false, error: "forbidden_char" },
  { input: "a.b", ok: false, error: "forbidden_char" },
  { input: "a b", ok: false, error: "forbidden_char" },
  { input: "a\u0000b", ok: false, error: "forbidden_char" },
  { input: "a\nb", ok: false, error: "forbidden_char" },
  { input: "a$b", ok: false, error: "forbidden_char" },
  { input: "a`b", ok: false, error: "forbidden_char" },
  { input: "a'b", ok: false, error: "forbidden_char" },
  { input: "a\"b", ok: false, error: "forbidden_char" },
  { input: "a;b", ok: false, error: "forbidden_char" },
  { input: "a*b", ok: false, error: "forbidden_char" },
];

// ── 以下是 app 自己的部分(不在共享文件里)──────────────────────────────────

/** 第 1 步名字下面的常驻说明。 */
export const NODE_NAME_HINT = '可以用中文、字母、数字、_ 和 -，不能以 - 开头，最多 64 个字符';

/** 「文件夹」一行改出来的值不合规时的说明;合规返回 null。不做任何自动改写(不悄悄转小写/换字符)。 */
export function folderError(value: string): string | null {
  if (value === '') return '请填写文件夹名';
  if (NODE_FOLDER_RE.test(value)) return null;
  if (value.length > NODE_NAME_MAX_CHARS) return `文件夹名最多 ${NODE_NAME_MAX_CHARS} 个字符`;
  if (!/^[a-z]/.test(value)) return '文件夹名要以小写英文字母开头';
  return '文件夹名只能用小写英文字母、数字和 -';
}

/** 老 Hub(#652 之前)对新规则才允许的名字回 node_name_invalid。 */
export const OLD_HUB_NAME_REJECTED = '当前 Hub 版本不支持这个名字（旧版只允许小写英文），请升级 Hub 或改用小写英文名';
/** 老 daemon 同理(Hub 已放行,daemon 侧旧规则拒)。 */
export const OLD_DAEMON_NAME_REJECTED = '目标机器上的 daemon 版本不支持这个名字（旧版只允许小写英文），请升级该机器的 agent-node 或改用小写英文名';

/**
 * create_node / 创建请求的报错里带 node_name_invalid,而这个名字按本地(= 新 Hub)规则是合法的
 * ⇒ 对面是老版本,说人话;否则返回 null(调用方照原样显示)。
 */
export function describeNodeNameRejection(error: string | null | undefined, name: string, side: 'hub' | 'daemon'): string | null {
  if (!/\bnode_name_invalid\b/.test(error ?? '')) return null;
  if (!checkNodeName(name).ok) return null;
  return side === 'hub' ? OLD_HUB_NAME_REJECTED : OLD_DAEMON_NAME_REJECTED;
}
