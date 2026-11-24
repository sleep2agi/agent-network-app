// #5429:服务器页「版本」从 /health 的 version 读(现在的 Hub 没有 /api/version)。
import { healthVersion } from './server-ping';
const cases: [string, string | undefined][] = [
  ['{"ok":true,"version":"0.9.0-preview.295"}', '0.9.0-preview.295'],
  ['<html>redirect</html>', undefined],
  ['{"version":"deployment_label"}', undefined],
  ['{}', undefined],
];
let failed = 0;
for (const [body, want] of cases) {
  const got = healthVersion(body);
  if (got !== want) { failed++; console.log(`✗ healthVersion(${body}) = ${got}, want ${want}`); }
}
console.log(failed ? `server-ping: ${failed} failed` : `server-ping: ${cases.length}/${cases.length} passed`);
if (failed) process.exit(1);
