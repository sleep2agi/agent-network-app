// 2026-09-15:ios-build 撞 Apple 409(3 张 iOS Distribution 上限被历次成功上传保留的 CI 证书占满)。
// #23 证明 Apple 改写 CSR 主题,按 CN 认不出来;策略改为「签发时间落在某次 ios-build run 时间窗里 ⇒ CI 造的」。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describeCertificate, partitionCiCertificates, runWindows, windowFor, parseX509Time, IN_FLIGHT_GRACE_MS, WINDOW_SLACK_MS } from '../scripts/ios-signing-cert-policy.mjs';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}`); };

function selfSigned(cn: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-cert-policy-'));
  const key = path.join(dir, 'k.pem'), crt = path.join(dir, 'c.der');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-outform', 'DER', '-out', crt, '-days', '2', '-subj', `/CN=${cn}/O=Agent Network`], { stdio: 'ignore' });
  const b64 = fs.readFileSync(crt).toString('base64');
  fs.rmSync(dir, { recursive: true, force: true });
  return b64;
}

// parseX509Time:OpenSSL 风格(Node 20 没有 validFromDate)
ck('parse "Sep  5 10:10:22 2026 GMT"', parseX509Time('Sep  5 10:10:22 2026 GMT')?.toISOString() === '2026-09-05T10:10:22.000Z');
ck('parse garbage → null', parseX509Time('not a date') === null);

// describeCertificate:从 DER 读主题和签发时间
const d = describeCertificate({ id: 'C1', attributes: { certificateType: 'IOS_DISTRIBUTION', name: 'iOS Distribution: x', serialNumber: 'AA', certificateContent: selfSigned('iPhone Distribution: someone (TEAM)') } });
ck('describe: subject parsed', /iPhone Distribution: someone/.test(d.subject ?? ''));
ck('describe: validFrom is a recent Date', d.validFrom instanceof Date && Math.abs(Date.now() - d.validFrom.getTime()) < 10 * 60 * 1000);
ck('describe: unparseable content → validFrom null', describeCertificate({ id: 'C3', attributes: { certificateContent: 'bm90IGEgY2VydA==' } }).validFrom === null);

// runWindows / windowFor:真实 run 形状(09-05 #21 success)
const runs = [
  { id: 33959865436, run_started_at: '2026-09-05T10:08:56Z', updated_at: '2026-09-05T10:13:48Z' },
  { id: 33082212545, run_started_at: '2026-08-27T14:26:07Z', updated_at: '2026-08-27T21:07:28Z' },
  { id: 999, created_at: 'garbage' },
];
const w = runWindows(runs);
ck('runWindows: unparseable run dropped', w.length === 2);
ck('runWindows: slack applied both ends', w[0].start.getTime() === Date.parse('2026-09-05T10:08:56Z') - WINDOW_SLACK_MS && w[0].end.getTime() === Date.parse('2026-09-05T10:13:48Z') + WINDOW_SLACK_MS);
ck('windowFor: cert issued at Prepare step (10:10:22) matches run 33959865436', windowFor(new Date('2026-09-05T10:10:22Z'), w)?.id === 33959865436);
ck('windowFor: cert issued a day earlier matches nothing', windowFor(new Date('2026-09-04T10:10:22Z'), w) === null);
ck('windowFor: null validFrom matches nothing', windowFor(null, w) === null);

// partition:窗内且老的 → 吊销;窗内但 2 小时内 → 保留;窗外 → 保留
const now = new Date('2026-09-15T03:30:00Z');
const base = { type: 'IOS_DISTRIBUTION', name: 'iOS Distribution: x', serial: 'S', subject: 'CN=iPhone Distribution: x' };
const old21 = { ...base, id: 'OLD', validFrom: new Date('2026-09-05T10:10:22Z') };
const manual = { ...base, id: 'MANUAL', validFrom: new Date('2026-09-01T08:00:00Z') };
const unknown = { ...base, id: 'UNK', validFrom: null };
const fresh = { ...base, id: 'FRESH', validFrom: new Date(now.getTime() - IN_FLIGHT_GRACE_MS + 60_000) };
const freshRun = { id: 777, run_started_at: new Date(now.getTime() - IN_FLIGHT_GRACE_MS).toISOString(), updated_at: now.toISOString() };
const r = partitionCiCertificates([old21, manual, unknown, fresh], runWindows([...runs, freshRun]), now);
ck('revoke = only the old in-window cert', r.revoke.map(c => c.id).join(',') === 'OLD');
ck('keep = manual + unknown + fresh', r.keep.map(c => c.id).sort().join(',') === 'FRESH,MANUAL,UNK');
ck('reason says manual cert is outside every run', /not issued inside any ios-build run/.test(r.reason.get('MANUAL') ?? ''));
ck('reason names the run id for the revoked cert', /run 33959865436/.test(r.reason.get('OLD') ?? ''));
ck('reason says fresh cert may be in flight', /in flight/.test(r.reason.get('FRESH') ?? ''));
ck('no windows → nothing revoked', partitionCiCertificates([old21], [], now).revoke.length === 0);

// 源码契约:prepare 在 POST 之前 GET 证书 + 拉 run 历史;workflow 给了 GH_TOKEN
const src = fs.readFileSync('scripts/ios-distribution-signing.mjs', 'utf8');
const getIdx = src.indexOf("'/certificates?filter%5BcertificateType%5D=IOS_DISTRIBUTION");
const postIdx = src.indexOf("api('POST', '/certificates'");
ck('script lists existing IOS_DISTRIBUTION certs before creating one', getIdx > 0 && postIdx > getIdx);
ck('script revokes only what partitionCiCertificates returns', src.includes('partitionCiCertificates(') && src.includes('for (const c of revoke)'));
ck('script reads ios-build runs from GitHub with GH_TOKEN', src.includes('/actions/workflows/ios-build.yml/runs') && src.includes("required('GH_TOKEN')"));
const yml = fs.readFileSync('.github/workflows/ios-build.yml', 'utf8');
const stepIdx = yml.indexOf('name: Prepare ephemeral App Store distribution signing');
const nextStep = yml.indexOf('- name:', stepIdx + 10);
ck('workflow injects GH_TOKEN into the Prepare step', yml.slice(stepIdx, nextStep).includes('GH_TOKEN: ${{ github.token }}'));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
