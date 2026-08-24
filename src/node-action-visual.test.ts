import { readFileSync } from 'node:fs';
import { nodeActionVisual } from './node-action-visual';

let passed = 0;
let total = 0;
const check = (name: string, condition: boolean) => {
  total++;
  if (!condition) throw new Error(`FAIL: ${name}`);
  passed++;
};

const dark = {
  card: '#161618', border: '#26262b', textSecondary: '#a1a1aa', blocked: '#f59e0b', failed: '#ef4444',
};
const light = {
  card: '#ffffff', border: '#e1e5ea', textSecondary: '#626a76', blocked: '#d97706', failed: '#dc2626',
};

for (const [name, palette] of [['dark', dark], ['light', light]] as const) {
  const restart = nodeActionVisual(palette, 'neutral');
  const stop = nodeActionVisual(palette, 'caution');
  const remove = nodeActionVisual(palette, 'danger');
  check(`${name}: restart is neutral`, restart.borderColor === palette.border && restart.textColor === palette.textSecondary);
  check(`${name}: stop is caution amber`, stop.borderColor === palette.blocked && stop.textColor === palette.blocked);
  check(`${name}: delete is destructive red`, remove.borderColor === palette.failed && remove.textColor === palette.failed);
  check(`${name}: no action uses a saturated primary fill`, [restart, stop, remove].every(value => value.backgroundColor === palette.card));
  check(`${name}: three semantic tones are visually distinct`, new Set([restart.textColor, stop.textColor, remove.textColor]).size === 3);
}

const screen = readFileSync('src/NodeDetailScreen.tsx', 'utf8').replace(/\r\n?/g, '\n');
check('all three semantic tones are wired to their exact actions',
  screen.includes('label="重启节点" tone="neutral"') &&
  screen.includes('label="停止节点" tone="caution"') &&
  screen.includes('label="删除节点" tone="danger"'));
check('buttons are compact desktop controls', /actionButton:\s*\{[\s\S]*?minWidth: 92,[\s\S]*?height: 34,[\s\S]*?borderRadius: 7,/.test(screen));
check('row wraps instead of overflowing narrow windows', /actionRow:\s*\{[\s\S]*?flexWrap: 'wrap'/.test(screen));
check('hover and keyboard focus are both handled', screen.includes('onHoverIn=') && screen.includes('onHoverOut=') && screen.includes('onFocus=') && screen.includes('onBlur='));
check('pressed state is visible without layout shift', /actionButtonPressed:\s*\{[\s\S]*?opacity: 0\.68,[\s\S]*?scale: 0\.98/.test(screen));
check('delete still discloses exact-alias confirmation', screen.includes("pendingAction === 'delete_node' && confirmAlias !== alias"));
check('danger action exposes an accessibility confirmation hint', screen.includes("tone === 'danger' ? '需要输入节点别名再次确认'"));

console.log(`node action visual hierarchy: ${passed}/${total} checks passed`);
