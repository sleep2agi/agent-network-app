// 2026-09-15:ios-build 撞 Apple 409(上次成功上传保留的 CI 证书占名额)。策略:只吊销「CN=Agent Network CI 且不是刚签发」的证书。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describeCertificate, partitionStaleCiCertificates, CI_SUBJECT_CN, IN_FLIGHT_GRACE_MS } from '../scripts/ios-signing-cert-policy.mjs';

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

// describeCertificate:从 certificateContent 里读出 CN 和签发时间
const ours = describeCertificate({ id: 'C1', attributes: { certificateType: 'IOS_DISTRIBUTION', name: 'iOS Distribution', serialNumber: 'AA', certificateContent: selfSigned(CI_SUBJECT_CN) } });
ck('describe: CN parsed from DER', ours.subjectCN === CI_SUBJECT_CN);
ck('describe: validFrom is a recent Date', ours.validFrom instanceof Date && Math.abs(Date.now() - ours.validFrom.getTime()) < 10 * 60 * 1000);
const theirs = describeCertificate({ id: 'C2', attributes: { certificateType: 'IOS_DISTRIBUTION', certificateContent: selfSigned('Vincent Manual') } });
ck('describe: foreign CN preserved', theirs.subjectCN === 'Vincent Manual');
const garbage = describeCertificate({ id: 'C3', attributes: { certificateContent: 'bm90IGEgY2VydA==' } });
ck('describe: unparseable content → subjectCN null (treated as not ours)', garbage.subjectCN === null);

// partition:手动建的不碰;刚签发的不碰;老的 CI 证书才吊销
const now = new Date('2026-09-15T03:20:00Z');
const stale = { ...ours, id: 'OLD', validFrom: new Date('2026-09-05T10:10:22Z') };
const fresh = { ...ours, id: 'FRESH', validFrom: new Date(now.getTime() - IN_FLIGHT_GRACE_MS + 60_000) };
const boundary = { ...ours, id: 'EDGE', validFrom: new Date(now.getTime() - IN_FLIGHT_GRACE_MS - 1) };
const r = partitionStaleCiCertificates([stale, fresh, theirs, garbage, boundary], now);
ck('revoke = stale CI certs only', r.revoke.map(c => c.id).sort().join(',') === 'EDGE,OLD');
ck('keep = manual + unparseable + fresh', r.keep.map(c => c.id).sort().join(',') === 'C2,C3,FRESH');
ck('reason names the manual cert as not ours', /not ours/.test(r.reason.get('C2') ?? ''));
ck('reason names the fresh cert as in-flight', /in-flight/.test(r.reason.get('FRESH') ?? ''));
ck('empty list → nothing to do', partitionStaleCiCertificates([], now).revoke.length === 0);

// 源码契约:prepare() 在 POST /certificates 之前先 GET + 吊销;吊销只走策略函数
const src = fs.readFileSync('scripts/ios-distribution-signing.mjs', 'utf8');
const getIdx = src.indexOf("'/certificates?filter%5BcertificateType%5D=IOS_DISTRIBUTION");
const postIdx = src.indexOf("api('POST', '/certificates'");
ck('script lists existing IOS_DISTRIBUTION certs before creating one', getIdx > 0 && postIdx > getIdx);
ck('script revokes only what partitionStaleCiCertificates returns', src.includes('partitionStaleCiCertificates(') && src.includes("for (const c of revoke)"));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
