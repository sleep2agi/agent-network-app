import { colors, statusColor } from './theme';

function ck(name: string, ok: boolean) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

ck('idle is online green', statusColor('idle', true) === colors.running);
ck('working is online green', statusColor('working', true) === colors.running);
ck('offline always stays neutral', statusColor('idle', false) === colors.rest);
ck('failed online stays red', statusColor('failed', true) === colors.failed);
