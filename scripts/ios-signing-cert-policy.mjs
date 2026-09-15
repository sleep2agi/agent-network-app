// 2026-09-15 ios-build #22/#23:POST /certificates 409「You already have a current iOS Distribution
// certificate or a pending certificate request」= Apple 的 3 张上限满了。上传成功的 run 按设计保留证书
// 让 Apple 校验二进制,私钥随 runner 销毁,之后只占名额。
// #23 证明**CSR 的 CN 不会保留**(Apple 把主题改写成「iPhone Distribution: <team>」),按 CN 认不出谁是谁。
// 能用的判据只有时间:证书的 notBefore 落在某次 ios-build run 的时间窗里 ⇒ 是那次 run 造的。
// 不在任何窗里的(手动建的)一律保留并连签发时间一起打印,让人自己判断。
import crypto from 'node:crypto';

// 刚造出来不久的证书可能属于一个并行的 ios-build,别把它吊了
export const IN_FLIGHT_GRACE_MS = 2 * 60 * 60 * 1000;
// run 的 created_at 早于 Prepare 步(排队 + 装 Xcode),updated_at 晚于它;两头各放一点余量
export const WINDOW_SLACK_MS = 5 * 60 * 1000;

// OpenSSL 风格「Sep  5 10:10:22 2026 GMT」;Node 20 的 X509Certificate 没有 validFromDate
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
export function parseX509Time(text) {
  const m = /^(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})\s+GMT$/.exec(String(text ?? '').trim());
  if (m && m[1] in MONTHS) return new Date(Date.UTC(+m[6], MONTHS[m[1]], +m[2], +m[3], +m[4], +m[5]));
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function describeCertificate(resource) {
  const attrs = resource?.attributes ?? {};
  let subject = null;
  let validFrom = null;
  if (attrs.certificateContent) {
    try {
      const x509 = new crypto.X509Certificate(Buffer.from(attrs.certificateContent, 'base64'));
      subject = x509.subject.replace(/\n/g, ', ');
      validFrom = parseX509Time(x509.validFrom);
    } catch {
      // 解析不了 ⇒ 没有签发时间 ⇒ 永远不会被吊销
    }
  }
  return {
    id: resource?.id ?? null,
    type: attrs.certificateType ?? null,
    name: attrs.name ?? attrs.displayName ?? null,
    serial: attrs.serialNumber ?? null,
    subject,
    validFrom,
  };
}

/** GitHub run 列表 → 时间窗 [{ id, start, end }],start/end 为 Date */
export function runWindows(runs, slackMs = WINDOW_SLACK_MS) {
  const out = [];
  for (const r of runs ?? []) {
    const start = new Date(r.run_started_at ?? r.created_at ?? NaN);
    const end = new Date(r.updated_at ?? r.run_started_at ?? r.created_at ?? NaN);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    out.push({ id: r.id ?? null, start: new Date(start.getTime() - slackMs), end: new Date(end.getTime() + slackMs) });
  }
  return out;
}

export function windowFor(validFrom, windows) {
  if (!(validFrom instanceof Date) || Number.isNaN(validFrom.getTime())) return null;
  return windows.find(w => validFrom >= w.start && validFrom <= w.end) ?? null;
}

/**
 * @returns {{ revoke, keep, reason: Map<string,string> }}
 */
export function partitionCiCertificates(certs, windows, now = new Date()) {
  const revoke = [];
  const keep = [];
  const reason = new Map();
  for (const c of certs) {
    const issued = c.validFrom ? c.validFrom.toISOString() : 'unknown issue time';
    const w = windowFor(c.validFrom, windows);
    if (!w) { keep.push(c); reason.set(c.id, `not issued inside any ios-build run (${issued}) — treated as manually created`); continue; }
    if (now.getTime() - c.validFrom.getTime() < IN_FLIGHT_GRACE_MS) {
      keep.push(c); reason.set(c.id, `issued by ios-build run ${w.id} ${Math.round((now - c.validFrom) / 60000)} min ago — may still be in flight`); continue;
    }
    revoke.push(c); reason.set(c.id, `issued by ios-build run ${w.id} (${issued}); its private key died with that runner`);
  }
  return { revoke, keep, reason };
}
