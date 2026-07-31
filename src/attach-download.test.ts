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

import {
  ATTACHMENT_CACHE_SCHEMA,
  downloadAttachmentWith,
  purgeLegacyAttachmentCacheWith,
  cachePathIn,
  type DownloadFs,
} from './attach-download';

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
    async readDirectoryAsync(dir) {
      return [...files.keys()].filter((k) => k.startsWith(dir)).map((k) => k.slice(dir.length));
    },
    async writeAsStringAsync(uri, contents) { files.set(uri, contents); },
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
    // 落地后除 dest 还会产生 sibling `.v` marker (#10 CR1 per-entry version
    // tag) — 所以 2 个文件, 不是 1.
    ck('正常下载 → 落地 dest + per-entry marker(共 2)', files.size === 2);
    // 精确等式, 不用宽容断言
    ck('正常下载 → 文件字节与源完全相等', files.get(uri) === GOOD_BODY);
    ck('正常下载 → 返回的就是落地路径', uri.length > 0 && files.has(uri));
    ck('正常下载 → 写入了 per-entry marker 且值 = SCHEMA',
      files.get(`${uri}.v`) === String(ATTACHMENT_CACHE_SCHEMA));
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

  // ── 5) 存量已污染设备(#10 CR1 核心) — per-entry marker 让自愈发生 ──
  // 场景: 旧版本(pre-PR#7)把 404 错误体写在真名 dest 上、无 marker。用户升级
  // 后, 若没走 App.tsx 启动 purge 或走了 purge 但被绕过/未跑完, 单调用
  // downloadAttachmentWith 必须自证 —— per-entry marker 缺失即视缓存无效,
  // 重新下载。判据两条一起打:
  //   ① calls.download === 1: 真的重下, 没走缓存
  //   ② files.get(dest) === GOOD_BODY: 拿到正确内容, 不是旧错误体
  // 只验其中一条不够:
  //   只验 ② 而不验 ①, 如果 dest 本来是空的, 内容也会"正确", 不能证明
  //     缓存路径被拒;
  //   只验 ① 而不验 ②, 有可能重下但落地到错的地方.
  // 两条一起才钉住"拒缓存 → 重下 → 正确落地" 完整链路。
  {
    const { fs, files, calls } = makeFs({ status: 200, body: GOOD_BODY, contentLength: String(Buffer.byteLength(GOOD_BODY)) });
    const dest = cachePathIn(CACHE, 'f5', 'deck.pptx', undefined);
    // 旧版留下的坏文件: 非空, 所以躲过 size>0 判据; **无 marker**
    files.set(dest, NOT_FOUND_BODY);

    const returned = await downloadAttachmentWith(fs, CACHE, 'http://h', 'tok', 'f5', 'deck.pptx', undefined);
    ck('存量污染 → per-entry marker 拒缓存, 真的重新下载(calls.download === 1)',
      calls.download === 1);
    ck('存量污染 → 落地内容为 GOOD_BODY, 不是旧的错误体 NOT_FOUND_BODY',
      files.get(returned) === GOOD_BODY);
    ck('存量污染 → 落地路径就是 dest', returned === dest);
    ck('存量污染 → 补写了 per-entry marker', files.get(`${dest}.v`) === String(ATTACHMENT_CACHE_SCHEMA));

    // #10 CR1 判据 ②: marker 生效后, 再调不再重下 (证明修好后不会退化到
    // "每次都重新下载"). 只验"会重下"不验"重下一次之后就不再重下", 可能
    // 做出一个每次都重下的版本, 那是另一种坏法。
    const secondReturn = await downloadAttachmentWith(fs, CACHE, 'http://h', 'tok', 'f5', 'deck.pptx', undefined);
    ck('marker 生效后重复调 → 不再重下(calls.download 仍 === 1)',
      calls.download === 1);
    ck('marker 生效后重复调 → 命中缓存返回同 dest',
      secondReturn === dest && files.get(dest) === GOOD_BODY);
  }

  // ── 5b) purgeLegacy 双保险仍然工作(与 per-entry marker 独立) ───────
  // per-entry marker 让"绕过 App 启动" 也能自愈; startup purge 让"多设备一次
  // 性彻底重来"仍然可用。两条互不依赖, 都测。
  {
    const { fs, files, calls } = makeFs({ status: 200, body: GOOD_BODY, contentLength: String(Buffer.byteLength(GOOD_BODY)) });
    const dest = cachePathIn(CACHE, 'f5b', 'deck.pptx', undefined);
    files.set(dest, NOT_FOUND_BODY);

    const r1 = await purgeLegacyAttachmentCacheWith(fs, CACHE);
    ck('一次性清理 → 确实删掉了附件缓存', r1.skipped === false && r1.purged === 1);
    // marker 自带 att- 前缀, 所以它能活下来靠两道防线: (1) 先遍历后写
    // marker 的顺序, (2) 遍历里对 marker 自身的 skip.
    ck('清理后 → schema marker 仍在(两道防线同时失效才会红)',
      files.has(`${CACHE}att-cache-v${ATTACHMENT_CACHE_SCHEMA}`));

    const after = await downloadAttachmentWith(fs, CACHE, 'http://h', 'tok', 'f5b', 'deck.pptx', undefined);
    ck('清理后 → 真的重新下载了', calls.download === 1);
    ck('清理后 → 拿到的字节与源完全相等', files.get(after) === GOOD_BODY);
  }

  // ── 5c) #10 CR2a — moveAsync 抛错必须清 .part ─────────────────────
  // 场景: 200 + 长度对 → 校验通过 → moveAsync 阶段设备文件系统抛错
  // (跨设备 rename / 权限 / 目标锁). 必须清 .part, 否则下次调用会遇到一个
  // "半新半旧"的孤儿, 干扰 fresh download 判据。
  {
    const { fs, files, calls } = makeFs({ status: 200, body: GOOD_BODY, contentLength: String(Buffer.byteLength(GOOD_BODY)) });
    // Inject: moveAsync 抛错 (跨设备 rename 模拟)
    const originalMove = fs.moveAsync;
    fs.moveAsync = async () => { throw new Error('EXDEV: cross-device link not permitted'); };

    let threw: Error | null = null;
    try {
      await downloadAttachmentWith(fs, CACHE, 'http://h', 'tok', 'f5c', 'deck.pptx', undefined);
    } catch (e) { threw = e as Error; }

    ck('moveAsync 抛错 → 抛给上层(不是静默成功)', threw !== null);
    ck('moveAsync 抛错 → 错误消息带 EXDEV', threw !== null && /EXDEV/.test(threw.message));
    // 关键: .part 必须被清 —— 别让部分写入的 tmp 留着
    const part = `${cachePathIn(CACHE, 'f5c', 'deck.pptx', undefined)}.part`;
    ck('moveAsync 抛错 → .part 已清, 无孤儿', !files.has(part));
    ck('moveAsync 抛错 → dest 未产生 (原子性保住)',
      !files.has(cachePathIn(CACHE, 'f5c', 'deck.pptx', undefined)));
    ck('moveAsync 抛错 → 未写 marker (因为没成功落地)',
      !files.has(`${cachePathIn(CACHE, 'f5c', 'deck.pptx', undefined)}.v`));
    // 恢复不影响其它 test
    fs.moveAsync = originalMove;
  }

  // ── 5d) #10 CR2b — downloadAsync 抛错必须清 .part ─────────────────
  // 场景: downloadAsync 原生抛错 (网络断/DNS/TLS). 原生 module 可能已经打开
  // 并部分写 .part 就 abort. 必须清, 否则下次调用会有孤儿。
  {
    const { fs, files, calls } = makeFs({ status: 200, body: GOOD_BODY });
    // Inject: downloadAsync 抛错前半途写了 partial 数据 (模拟原生 partial write)
    const dest = cachePathIn(CACHE, 'f5d', 'deck.pptx', undefined);
    const part = `${dest}.part`;
    fs.downloadAsync = async (_url, destArg) => {
      calls.download++;
      // 模拟原生: 已经落了几十字节部分数据然后 abort
      files.set(destArg, 'partial-bytes-then-abort');
      throw new Error('ECONNRESET: network aborted mid-transfer');
    };

    let threw: Error | null = null;
    try {
      await downloadAttachmentWith(fs, CACHE, 'http://h', 'tok', 'f5d', 'deck.pptx', undefined);
    } catch (e) { threw = e as Error; }

    ck('downloadAsync 抛错 → 抛给上层', threw !== null);
    ck('downloadAsync 抛错 → 错误消息带 ECONNRESET', threw !== null && /ECONNRESET/.test(threw.message));
    ck('downloadAsync 抛错 → .part 已清, 部分数据不残留', !files.has(part));
    ck('downloadAsync 抛错 → dest 未产生', !files.has(dest));
    ck('downloadAsync 抛错 → 未写 marker', !files.has(`${dest}.v`));
  }

  // ── 6) 清理只跑一次 ──────────────────────────────────────────────
  {
    const { fs, files } = makeFs({ status: 200, body: GOOD_BODY });
    files.set(cachePathIn(CACHE, 'f6', 'a.pptx', undefined), NOT_FOUND_BODY);
    const first = await purgeLegacyAttachmentCacheWith(fs, CACHE);
    files.set(cachePathIn(CACHE, 'f7', 'b.pptx', undefined), NOT_FOUND_BODY); // 之后又产生的缓存
    const second = await purgeLegacyAttachmentCacheWith(fs, CACHE);
    ck('清理只跑一次 → 第一次执行', first.skipped === false && first.purged === 1);
    ck('清理只跑一次 → 第二次跳过(marker 已在)', second.skipped === true && second.purged === 0);
    ck('清理只跑一次 → 第二次没有误删后来的缓存',
      files.get(cachePathIn(CACHE, 'f7', 'b.pptx', undefined)) === NOT_FOUND_BODY);
  }

  // ── 7) 清理只删附件, 不碰同目录的其他缓存 ────────────────────────
  {
    const { fs, files } = makeFs({ status: 200, body: GOOD_BODY });
    files.set(`${CACHE}sessions_cache_v1.json`, '{"sessions":[]}');
    files.set(cachePathIn(CACHE, 'f8', 'c.pptx', undefined), NOT_FOUND_BODY);
    await purgeLegacyAttachmentCacheWith(fs, CACHE);
    ck('清理 → 别的缓存文件原样保留',
      files.get(`${CACHE}sessions_cache_v1.json`) === '{"sessions":[]}');
    ck('清理 → 附件缓存被删',
      files.has(cachePathIn(CACHE, 'f8', 'c.pptx', undefined)) === false);
  }

  console.log(`\n${pass}/${total} passed`);
  if (pass !== total) process.exit(1);
};

await run();
