import { shouldExposeSendFailure } from './send-reconciliation';

let passed = 0;
let total = 0;
const check = (name: string, condition: boolean) => {
  total++;
  if (!condition) throw new Error(`FAIL: ${name}`);
  passed++;
};

let exists = true;
const accepted = await shouldExposeSendFailure(async () => { exists = false; }, () => exists);
check('Hub reconciliation retires an ACK-lost optimistic row before failure UI', accepted === false);

exists = true;
const failed = await shouldExposeSendFailure(async () => {}, () => exists);
check('a row still absent from the Hub may expose one retry action', failed === true);

const order: string[] = [];
await shouldExposeSendFailure(async () => { order.push('reconcile'); }, () => { order.push('inspect'); return true; });
check('reconciliation happens before failure is decided', order.join(',') === 'reconcile,inspect');

console.log(`send reconciliation: ${passed}/${total} checks passed`);
