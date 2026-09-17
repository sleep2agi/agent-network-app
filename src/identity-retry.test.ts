import { nextIdentityRetryDelay, IDENTITY_RETRY_CAP_MS } from './identity-retry';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}`); };

ck('first retry after 2s', nextIdentityRetryDelay(1) === 2000);
ck('second retry after 4s', nextIdentityRetryDelay(2) === 4000);
ck('third retry after 8s', nextIdentityRetryDelay(3) === 8000);
ck('fourth retry settles at 30s', nextIdentityRetryDelay(4) === 30_000);
ck('later retries stay at 30s', nextIdentityRetryDelay(50) === IDENTITY_RETRY_CAP_MS);
ck('non-positive attempt behaves like the first', nextIdentityRetryDelay(0) === 2000 && nextIdentityRetryDelay(-3) === 2000);
ck('NaN attempt behaves like the first', nextIdentityRetryDelay(Number.NaN) === 2000);

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
