#!/usr/bin/env python3
"""生成 src/chime-data.ts:16 kHz 8-bit mono WAV,0.42 s 两音短铃(E6→G6),≤10 KB base64。"""
import base64, io, math, wave
sr, dur = 16000, 0.42
buf = io.BytesIO(); w = wave.open(buf, 'wb'); w.setnchannels(1); w.setsampwidth(1); w.setframerate(sr)
frames = bytearray()
for i in range(int(sr * dur)):
    t = i / sr
    s = 0.55 * math.sin(2 * math.pi * 1318.5 * t) * math.exp(-6 * t)
    if t > 0.12:
        s += 0.45 * math.sin(2 * math.pi * 1568 * t) * math.exp(-6 * (t - 0.12))
    frames.append(int(128 + s * 100))
w.writeframes(bytes(frames)); w.close()
b = base64.b64encode(buf.getvalue()).decode()
open('src/chime-data.ts', 'w').write(
    "// 0.2.76 消息提示音:16 kHz 8-bit mono WAV,0.42 s 双音短铃,由 scripts/gen-chime.py 生成(勿手改)。\n"
    f"export const CHIME_DATA_URI = 'data:audio/wav;base64,{b}';\n")
print('wav bytes', len(buf.getvalue()))
