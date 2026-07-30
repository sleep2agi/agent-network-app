// 附件下载失败处理 — 纯逻辑单测(bun/node 可跑·无 RN 依赖)
// run: bun src/attach-download.test.ts
//
// Vincent 报"app 发来的 ppt 打不开、大小过小"。服务端真因已修(#509/#510:
// blob 按 uploads/YYYY-MM-DD/ 存, 读时用"今天"拼路径 → 跨午夜的文件 404)。
// 这里修的是客户端那一半: 为什么 404 会表现成"文件存下来了、只是打不开"。
//
// 关键事实(取自 expo-file-system 原生实现, 不是推测):
//   android/src/main/java/expo/modules/filesystem/legacy/FileSystemLegacyModule.kt
//   downloadAsync 的 onResponse:
//       val file = uri.toFile(); file.delete()
//       sink.writeAll(response.body!!.source())   // 不看 response.code
//       putInt("status", response.code)           // 状态码只是"报告"出来
//       promise.resolve(result)                   // 404 也 resolve
//   即: 响应体被无条件写进目标文件, 状态码交给 JS 侧自己判。
//
// 所以旧实现 `if (r.status !== 200) throw` 抛错抛对了, 但为时已晚 ——
// 文件已经在磁盘上。更糟的是错误体非 0 字节, 于是下次调用的
// `exists && size>0` 缓存判定会把它当有效缓存**永久信任**, 连状态检查都
// 不会再跑: 即使服务端修好、网络恢复, 这个 fileId 在该设备上也永远打不开。
// 旧注释只防了 0 字节的半截下载, 没防错误体。
//
// 下面的 fake 精确复刻上述原生契约。

import { downloadAttachmentWith, type DownloadFs } from './attach-download';

let pass = 0, total = 0;
const ck = (n: string, c: boolean) => { total++; if (c) { pass++; console.log('✅', n); } else console.log('❌', n); };

const CACHE = '/cache/';
const NOT_FOUND_BODY = '{"ok":false,"error":"not_found"}';           // 32 bytes — 正是"大小过小"
const GOOD_BODY = 'PKreal-pptx-bytes-'.padEnd(400, 'x'); // 一个像样的文件

/** 复刻 expo 原生 downloadAsync: 无论状态码都落盘, 且 resolve 不 reject。 */
function makeFs(resp: { status: number; body: string; contentLength?: string }) {
  const files = new Map<string, string>();
  const calls = { download: 0, deletes: [] as string[], moves: [] as string[] };
  const fs: DownloadFs = {
    async getInfoAsync(uri) {
      const c = files.get(uri);
      return c === undefined ? { exists: false } : { exists: true, size: Buffer.byteLength(c) };
    },
    async downloadAsync(_url, dest) {
      calls.download++;
      files.set(dest, resp.body);           // ← 原生行为: 不看状态码
      const headers: Record<string, string> = {};
      if (resp.contentLength !== undefined) headers['content-length'] = resp.contentLength;
      return { status: resp.status, headers };
    },
    async deleteAsync(uri) { files.delete(uri); calls.deletes.push(uri); },
    async moveAsync({ from, to }) {
      const c = files.get(from);
      if (c === undefined) throw new Error(`moveAsync: missing ${from}`);
      files.delete(from); files.set(to, c); calls.moves.push(`${from}→${to}`);
    },
    async readAsStringAsync(uri) { return files.get(uri) ?? ''; },
  };
  return { fs, files, calls };
}

const run = async () => {
  // ── 1) 404: 不许留下文件, 错误里要有状态码 ────────────────────────
  {
    const { fs, files } = makeFs({ status: 404, body: NOT_FOUND_BODY });
    let threw: Error | null = null;
    try {
      await downloadAttachmentWith(fs, CACHE, 'http://h', 'tok', 'f1', 'deck.pptx', undefined);
    } catch (e) { threw = e as Error; }

    ck('404 → 抛错(不是静默成功)', threw !== null);
    ck('404 → 错误信息含状态码 404', threw !== null && threw.message.includes('404'));
    // 🔴 本 bug 的本质是"文件存在但内容是错的", 所以判据落在"有没有文件"上,
    // 而不是"函数返回了什么"。
    ck('404 → 目标路径上没有任何文件产生', files.size === 0);
    // 错误体绝不能出现在任何残留文件里
    ck('404 → 磁盘上不存在错误体内容',
      [...files.values()].every((v) => !v.includes('not_found')));
  }

  // ── 2) 200 但 Content-Length 与实际字节数不符 ─────────────────────
  {
    const { fs, files } = makeFs({
      status: 200,
      body: GOOD_BODY.slice(0, 100),   // 实际 100 字节
      contentLength: '400',            // 声称 400
    });
    let threw: Error | null = null;
    try {
      await downloadAttachmentWith(fs, CACHE, 'http://h', 'tok', 'f2', 'deck.pptx', undefined);
    } catch (e) { threw = e as Error; }

    ck('长度不符 → 抛错', threw !== null);
    ck('长度不符 → 错误提到长度/大小',
      threw !== null && /length|size|字节|长度/i.test(threw.message));
    ck('长度不符 → 不留残缺文件', files.size === 0);
  }

  // ── 3) 正常 200: 字节必须与源完全相等(防过修) ─────────────────────
  {
    const { fs, files } = makeFs({
      status: 200,
      body: GOOD_BODY,
      contentLength: String(Buffer.byteLength(GOOD_BODY)),
    });
    let threw: Error | null = null; let uri = '';
    try {
      uri = await downloadAttachmentWith(fs, CACHE, 'http://h', 'tok', 'f3', 'deck.pptx', undefined);
    } catch (e) { threw = e as Error; }

    ck('正常下载 → 不抛错', threw === null);
    ck('正常下载 → 恰好落地一个文件', files.size === 1);
    // 精确等式, 不用宽容断言
    ck('正常下载 → 文件字节与源完全相等', files.get(uri) === GOOD_BODY);
    ck('正常下载 → 返回的就是落地路径', uri.length > 0 && files.has(uri));
  }

  // ── 4) 缓存污染回归: 一次失败之后不能把坏文件当缓存 ───────────────
  // 旧实现下, 404 的错误体留在 dest 且非 0 字节 → 下次 exists&&size>0
  // 直接命中缓存, 状态检查再也不会跑。
  {
    const { fs, files, calls } = makeFs({ status: 404, body: NOT_FOUND_BODY });
    try { await downloadAttachmentWith(fs, CACHE, 'http://h', 'tok', 'f4', 'deck.pptx', undefined); } catch { /* expected */ }
    let secondThrew: Error | null = null;
    try { await downloadAttachmentWith(fs, CACHE, 'http://h', 'tok', 'f4', 'deck.pptx', undefined); } catch (e) { secondThrew = e as Error; }

    ck('失败后重试 → 仍然抛错(没把坏文件当成功缓存)', secondThrew !== null);
    ck('失败后重试 → 真的重新发起了下载(不是缓存命中)', calls.download === 2);
    ck('失败后 → 磁盘依然干净', files.size === 0);
  }

  console.log(`\n${pass}/${total} passed`);
  if (pass !== total) process.exit(1);
};

await run();
