// 2026-09-15 ios-build #22:POST /certificates 409「You already have a current iOS Distribution
// certificate or a pending certificate request」。上一次成功上传(09-05 #21)按设计保留了那张证书
// 让 Apple 校验二进制;它的私钥随 runner 销毁,之后只占名额,下一次 prepare 必撞 409。
// 这里只认「本流程造的」证书:CSR 主题固定是 CN=Agent Network CI(见 ios-distribution-signing.mjs),
// 别人手动建的(CN 不同)一律不碰,只列出来。
import crypto from 'node:crypto';

export const CI_SUBJECT_CN = 'Agent Network CI';
// 刚造出来不久的证书可能属于一个并行的 ios-build,别把它吊了
export const IN_FLIGHT_GRACE_MS = 2 * 60 * 60 * 1000;

export function describeCertificate(resource) {
  const attrs = resource?.attributes ?? {};
  let subjectCN = null;
  let validFrom = null;
  if (attrs.certificateContent) {
    try {
      const x509 = new crypto.X509Certificate(Buffer.from(attrs.certificateContent, 'base64'));
      const m = /(?:^|\n)CN=([^\n]+)/.exec(x509.subject);
      subjectCN = m ? m[1] : null;
      validFrom = new Date(x509.validFrom);
    } catch {
      // 解析不了的当成「不是本流程的」
    }
  }
  return {
    id: resource?.id ?? null,
    type: attrs.certificateType ?? null,
    name: attrs.name ?? attrs.displayName ?? null,
    serial: attrs.serialNumber ?? null,
    subjectCN,
    validFrom,
  };
}

/**
 * @param {ReturnType<typeof describeCertificate>[]} certs
 * @param {Date} now
 * @returns {{ revoke: typeof certs, keep: typeof certs, reason: Map<string,string> }}
 */
export function partitionStaleCiCertificates(certs, now = new Date()) {
  const revoke = [];
  const keep = [];
  const reason = new Map();
  for (const c of certs) {
    if (c.subjectCN !== CI_SUBJECT_CN) {
      keep.push(c); reason.set(c.id, `not ours (CN=${c.subjectCN ?? '?'})`); continue;
    }
    if (c.validFrom && now.getTime() - c.validFrom.getTime() < IN_FLIGHT_GRACE_MS) {
      keep.push(c); reason.set(c.id, `ours but issued ${Math.round((now - c.validFrom) / 60000)} min ago — may belong to an in-flight run`); continue;
    }
    revoke.push(c); reason.set(c.id, 'ours; private key died with its runner');
  }
  return { revoke, keep, reason };
}
