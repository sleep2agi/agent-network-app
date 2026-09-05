import { strict as assert } from 'node:assert';

const { latestReleaseNotes } = await import('./desktop-updater');
let ck = 0;
const check = (cond: boolean, msg: string) => { assert.ok(cond, msg); ck++; };

// release-desktop-auto-update.yml 生成的真实形状(0.2.48 的 latest.json notes 前三段 + 尾注)
const body = `Signed and notarized stable update for macOS (Apple Silicon) and Windows (x64).

What's new in 0.2.48:
- Local Hub takeover: if an older bundled Hub left behind by a previous version is still running
  on the local port, the app now stops it, backs up the data, migrates and takes over automatically.

What's new in 0.2.47:
- Local workspace recovers by itself.
- Message box divider: dragging it upward no longer selects the conversation text.

What's new in 0.2.46:
- Resizable message box.

Existing installations can update in place; new installations can use the assets below.`;

const latest = latestReleaseNotes(body);
check(latest.startsWith("What's new in 0.2.48:"), 'starts at the newest heading (preamble dropped)');
check(latest.includes('takes over automatically.'), 'keeps the whole newest section');
check(!latest.includes('0.2.47') && !latest.includes('0.2.46'), 'older sections dropped');
check(!latest.includes('Signed and notarized'), 'preamble dropped');
check(!latest.includes('Existing installations'), 'trailing footer dropped');

// 只有一段时:去掉尾注,保留正文
const single = latestReleaseNotes("Signed.\n\nWhat's new in 0.2.49:\n- Only one.\n\nExisting installations can update in place.");
check(single === "What's new in 0.2.49:\n- Only one.", `single section keeps body without footer: ${JSON.stringify(single)}`);

// 没有标题:整段原样(裁掉首尾空白);CRLF 归一;空值 → 空串
check(latestReleaseNotes('  plain notes without headings \r\n') === 'plain notes without headings', 'no heading → full text');
check(latestReleaseNotes("a\r\n\r\nWhat's new in 1.0.0:\r\n- x\r\n\r\nWhat's new in 0.9.0:\r\n- y") === "What's new in 1.0.0:\n- x", 'CRLF input handled');
check(latestReleaseNotes(null) === '' && latestReleaseNotes(undefined) === '' && latestReleaseNotes('') === '', 'empty inputs → empty string');

console.log(`desktop update notes: ${ck} checks passed`);
