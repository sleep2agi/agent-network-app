// ck-style (self-executing; run by scripts/run-tests.mjs). 豆包流式识别二进制帧协议:对照文档与官方 demo 的金样字节。
//
// 金样来源(2026-09-26 取):
//   · docs https://www.volcengine.com/docs/6561/1354869「WebSocket 二进制协议」表 + 「示例:客户发送 3 个请求」
//   · 同页附件 sauc_python.zip / sauc_websocket_demo.py 的 RequestBuilder,把 gzip 换成恒等、默认头压缩位改 0 后跑出来:
//       new_full_client_request(1)            → 11 11 10 00 | 00 00 00 01 | <size> | JSON
//       new_audio_only_request(2, pcm, False) → 11 21 10 00 | 00 00 00 02 | 00 00 00 06 | 01 00 fe ff ff 7f
//       new_audio_only_request(5, pcm, True)  → 11 23 10 00 | ff ff ff fb | 00 00 00 06 | 01 00 fe ff ff 7f
//     唯一差别是音频帧第 3 字节:demo 沿用了 JSON 序列化位(0x10),文档示例写的是 `b0000 (none - raw bytes)`
//     —— 音频是裸 PCM,我们按文档发 0x00。
import {
  buildStreamParams, decodeClientFrame, decodeServerFrame, encodeAudioRequest, encodeFullClientRequest,
  encodeServerError, encodeServerResponse, headerBytes, isStreamResourceId, PACKET_SAMPLES, resultText,
  STREAM_DEFAULT_ENDPOINT, STREAM_DEFAULT_RESOURCE_ID, STREAM_RESOURCE_IDS, utf8Decode, utf8Encode,
} from './doubao-stream-protocol';

let p = 0, t = 0;
const ck = (name: string, cond: boolean) => { t++; if (cond) { p++; console.log(`✅ ${name}`); } else console.log(`❌ ${name}`); };
const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => new Uint8Array(s.replace(/\s+/g, '').match(/../g)!.map(h => parseInt(h, 16)));

// ── 头 ──
ck('header:version 1 / header size 1(×4)/ full client / 正 seq / JSON / 不压缩 = 11 11 10 00', hex(headerBytes(0b0001, 0b0001, 0b0001, 0b0000)) === '11111000');
ck('header:服务端最后一包(type 1001, flags 0011, JSON, gzip)= 11 93 11 00(文档示例)', hex(headerBytes(0b1001, 0b0011, 0b0001, 0b0001)) === '11931100');

// ── 客户端帧 ──
{
  const pcm = new Int16Array([1, -2, 32767]);
  ck('音频中间包 seq=2 金样(与官方 demo 仅第 3 字节不同,见文件头)', hex(encodeAudioRequest(pcm, 2, false)) === '11210000' + '00000002' + '00000006' + '0100feffff7f');
  ck('音频最后一包 seq=5 → flags 0011 + seq -5(ff ff ff fb)', hex(encodeAudioRequest(pcm, 5, true)) === '11230000' + 'fffffffb' + '00000006' + '0100feffff7f');
  ck('最后一包传负 seq 也只取绝对值再取负(不会变正)', hex(encodeAudioRequest(pcm, -5, true)).slice(8, 16) === 'fffffffb');
  ck('空的最后一包:size 0', hex(encodeAudioRequest(new Int16Array(0), 3, true)) === '11230000fffffffd00000000');
  ck('PCM 采样小端(pcm_s16le),长度字段大端', hex(encodeAudioRequest(new Int16Array([0x1234]), 1, false)).endsWith('000000023412'));

  const full = encodeFullClientRequest(buildStreamParams(), 1);
  const size = new DataView(full.buffer).getUint32(8, false);
  ck('参数帧:头 11 11 10 00 + seq 1 + 大端长度 = JSON 字节数', hex(full.subarray(0, 8)) === '1111100000000001' && size === full.length - 12);
  const json = JSON.parse(utf8Decode(full.subarray(12)));
  ck('参数:audio = pcm / raw / 16000 / 16 bit / 单声道(文档:rate 目前只支持 16000)', json.audio.format === 'pcm' && json.audio.codec === 'raw' && json.audio.rate === 16000 && json.audio.bits === 16 && json.audio.channel === 1);
  ck('参数:request.model_name = bigmodel(必填),itn/punc 开,全量结果', json.request.model_name === 'bigmodel' && json.request.enable_itn === true && json.request.enable_punc === true && json.request.result_type === 'full');
  ck('参数里没有任何凭据字段', !/token|key|secret/i.test(JSON.stringify(json)));

  const back = decodeClientFrame(encodeAudioRequest(pcm, 7, true));
  ck('客户端帧往返:最后一包 seq=-7、PCM 原样', back.kind === 'audio' && back.last && back.sequence === -7 && Array.from(back.pcm).join() === '1,-2,32767');
  const backFull = decodeClientFrame(full);
  ck('客户端帧往返:参数帧 JSON 原样', backFull.kind === 'full' && (backFull.json as any).request.model_name === 'bigmodel');
}

// ── 服务端帧 ──
{
  // 文档示例的 full server response(不压缩版),手工拼字节:11 91 10 00 | seq 1 | size | {"result":{"text":"你好"}}
  const body = utf8Encode('{"result":{"text":"你好"}}');
  const golden = new Uint8Array([...unhex('11911000 00000001'), ...unhex(body.length.toString(16).padStart(8, '0')), ...body]);
  const f = decodeServerFrame(golden);
  ck('服务端中间结果(金样字节)→ response / seq 1 / 非最后 / 文本「你好」', f.kind === 'response' && f.sequence === 1 && !f.last && f.text === '你好');
  const last = decodeServerFrame(encodeServerResponse({ result: { text: '这是字节跳动，今日头条母公司。' } }, 3, true));
  ck('服务端最后一包:flags 0011 / seq 负 → last', last.kind === 'response' && last.last && last.sequence === -3 && last.text === '这是字节跳动，今日头条母公司。');
  const lastNoSeq = decodeServerFrame(new Uint8Array([...unhex('11921000'), ...unhex('00000002'), ...utf8Encode('{}')]));
  ck('flags 0010(最后一包,无 seq)也认成 last', lastNoSeq.kind === 'response' && lastNoSeq.last && lastNoSeq.sequence === null);
  const ack = decodeServerFrame(new Uint8Array([...unhex('11911000 00000001 00000000')]));
  ck('空 payload(参数帧的 ack)→ response,text=null', ack.kind === 'response' && ack.text === null);
  const err = decodeServerFrame(encodeServerError(45000001, 'invalid params: X-Api-Key=abc'));
  ck('错误帧(type 1111)→ 只带数字码,不带消息正文', err.kind === 'error' && err.code === 45000001 && !JSON.stringify(err).includes('abc'));
  ck('错误帧金样:11 f0 10 00 | 02 ae a5 41(= 45000001)', hex(encodeServerError(45000001, '')).startsWith('11f0100002aea541'));
  const gz = decodeServerFrame(new Uint8Array([...unhex('11911100 00000001 00000003'), 0x1f, 0x8b, 0x08]));
  ck('服务端回 gzip → bad/gzip_unsupported(上层回退极速版,不会卡住)', gz.kind === 'bad' && gz.reason === 'gzip_unsupported');
  ck('截断的帧 → bad', decodeServerFrame(unhex('119110')).kind === 'bad' && decodeServerFrame(unhex('11911000 00000001 000000ff 00')).kind === 'bad');
  ck('版本不对 → bad', decodeServerFrame(unhex('21911000 00000001 00000000')).kind === 'bad');
  ck('客户端类型的帧当服务端帧 → bad_type', (() => { const r = decodeServerFrame(encodeAudioRequest(new Int16Array(1), 1, false)); return r.kind === 'bad' && r.reason === 'bad_type'; })());
  ck('JSON 坏了 → bad_json', (() => { const r = decodeServerFrame(new Uint8Array([...unhex('11911000 00000001 00000002'), 0x7b, 0x7b])); return r.kind === 'bad' && r.reason === 'bad_json'; })());
  const ev = decodeServerFrame(new Uint8Array([...unhex('11951000 00000004 00000096 00000002'), ...utf8Encode('{}')]));
  ck('flags bit2(event)按官方 demo 跳过 4 字节', ev.kind === 'response' && ev.sequence === 4);
}

// ── 结果文本 ──
ck('result 是对象 {text}(文档示例)', resultText({ result: { text: 'a' } }) === 'a');
ck('result 是列表(字段表写的 list)→ 拼接', resultText({ result: [{ text: 'a' }, { text: 'b' }] }) === 'ab');
ck('没有 result → null', resultText({ audio_info: {} }) === null);

// ── UTF-8(不依赖 Hermes 的 TextDecoder)──
{
  const s = '中文 English 😀 ①';
  ck('utf8Encode 与 Buffer 一致', hex(utf8Encode(s)) === Buffer.from(s, 'utf8').toString('hex'));
  ck('utf8Decode 往返', utf8Decode(utf8Encode(s)) === s);
}

// ── 常量 ──
ck('默认地址 = 双向流式优化版 bigmodel_async', STREAM_DEFAULT_ENDPOINT === 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async');
ck('默认资源 = volc.bigasr.sauc.duration;四种资源都认', STREAM_DEFAULT_RESOURCE_ID === 'volc.bigasr.sauc.duration' && STREAM_RESOURCE_IDS.length === 4 && STREAM_RESOURCE_IDS.every(isStreamResourceId) && !isStreamResourceId('volc.bigasr.auc_turbo'));
ck('一包 200 ms = 3200 采样(文档:双向流式 200 ms 一包最优)', PACKET_SAMPLES === 3200);

console.log(`doubao stream protocol: ${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);
