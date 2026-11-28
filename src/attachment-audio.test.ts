import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  activeAudioPlaybackId,
  audioMimeFor,
  clampAudioProgress,
  claimAudioPlayback,
  formatAudioTime,
  formatPlaybackRate,
  isPlayableAudio,
  nextPlaybackRate,
  releaseAudioPlayback,
  seekTargetSeconds,
  shouldRewindBeforePlay,
  stopAllAudioPlayback,
} from './attachment-audio-model';
import { mimeFromName } from './attach-download';
import { languagePreference, setLanguagePreference, t } from './i18n';
import { chatTranslations } from './i18n-chat';
import { runReplyAttachments } from './schedule-run-result';

// 1. Playable format recognition
for (const name of ['01_试听.mp3', 'voice.M4A', 'clip.wav', 'track.aac', 'master.flac', 'note.ogg', 'speech.opus']) {
  assert.equal(isPlayableAudio(name), true, `${name} should be playable inline`);
}
assert.equal(isPlayableAudio('unnamed', 'audio/mpeg'), true);
assert.equal(isPlayableAudio('unnamed', 'audio/mp4; codecs="mp4a.40.2"'), true);
assert.equal(isPlayableAudio('legacy.wma', 'audio/x-ms-wma'), false);
assert.equal(isPlayableAudio('legacy.aiff', 'audio/aiff'), false);
assert.equal(isPlayableAudio('video.mp4', 'video/mp4'), false);
assert.equal(isPlayableAudio('photo.jpg', 'image/jpeg'), false);
assert.equal(isPlayableAudio('deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'), false);

// 2. MIME resolution + EXT_MIME consistency
assert.equal(audioMimeFor('a.mp3'), 'audio/mpeg');
assert.equal(audioMimeFor('a.m4a'), 'audio/mp4');
assert.equal(audioMimeFor('a.wav'), 'audio/wav');
assert.equal(audioMimeFor('a.aac'), 'audio/aac');
assert.equal(audioMimeFor('a.flac'), 'audio/flac');
assert.equal(audioMimeFor('a.ogg'), 'audio/ogg');
assert.equal(audioMimeFor('a.opus'), 'audio/opus');
assert.equal(audioMimeFor('unknown', 'audio/ogg; codecs=opus'), 'audio/ogg');
assert.equal(mimeFromName('voice.aac'), 'audio/aac');
assert.equal(mimeFromName('master.flac'), 'audio/flac');
assert.equal(mimeFromName('voice.ogg'), 'audio/ogg');
assert.equal(mimeFromName('voice.opus'), 'audio/opus');

// 3. Time formatting & progress math
assert.equal(formatAudioTime(undefined), '0:00');
assert.equal(formatAudioTime(-5), '0:00');
assert.equal(formatAudioTime(NaN), '0:00');
assert.equal(formatAudioTime(0), '0:00');
assert.equal(formatAudioTime(9.8), '0:09');
assert.equal(formatAudioTime(65), '1:05');
assert.equal(formatAudioTime(3661), '1:01:01');
assert.equal(clampAudioProgress(5, 20), 0.25);
assert.equal(clampAudioProgress(30, 20), 1);
assert.equal(clampAudioProgress(-1, 20), 0);
assert.equal(clampAudioProgress(5, 0), 0);
assert.equal(seekTargetSeconds(0.5, 40), 20);
assert.equal(seekTargetSeconds(1.5, 40), 40);
assert.equal(seekTargetSeconds(-0.2, 40), 0);
assert.equal(shouldRewindBeforePlay(0, 20, false), false);
assert.equal(shouldRewindBeforePlay(19.9, 20, false), true);
assert.equal(shouldRewindBeforePlay(5, 20, true), true);

// 4. Playback speed cycling
assert.equal(nextPlaybackRate(1), 1.25);
assert.equal(nextPlaybackRate(1.25), 1.5);
assert.equal(nextPlaybackRate(1.5), 2);
assert.equal(nextPlaybackRate(2), 1);
assert.equal(formatPlaybackRate(1), '1×');
assert.equal(formatPlaybackRate(1.25), '1.25×');

// 5. Singleton playback bus: playing #2 immediately pauses #1; recording stops all
stopAllAudioPlayback();
let pausedA = 0;
let pausedB = 0;
claimAudioPlayback('audio-a', () => { pausedA++; });
assert.equal(activeAudioPlaybackId(), 'audio-a');
// Re-claiming same ID does not self-pause
claimAudioPlayback('audio-a', () => { pausedA++; });
assert.equal(pausedA, 0);
// Claiming audio-b pauses audio-a
claimAudioPlayback('audio-b', () => { pausedB++; });
assert.equal(pausedA, 1);
assert.equal(pausedB, 0);
assert.equal(activeAudioPlaybackId(), 'audio-b');
// Stale release of audio-a must not clear audio-b
releaseAudioPlayback('audio-a');
assert.equal(activeAudioPlaybackId(), 'audio-b');
// Global stop pauses audio-b and clears active id
stopAllAudioPlayback();
assert.equal(pausedB, 1);
assert.equal(activeAudioPlaybackId(), null);

// 6. ScheduleRunResult attachment view classifies MP3 as audio
const runAtts = runReplyAttachments({
  result: '',
  meta_json: JSON.stringify({
    reply_attachments: [
      { type: 'file', file_id: 'mp3file0001', name: '01_demo.mp3', mime: 'audio/mpeg', size: 123456 },
      { type: 'file', file_id: 'pdffile0002', name: 'doc.pdf', mime: 'application/pdf', size: 4096 },
    ],
  }),
}, 'https://hub.example');
assert.equal(runAtts[0].isAudio, true);
assert.equal(runAtts[0].isImage, false);
assert.equal(runAtts[0].isVideo, false);
assert.equal(runAtts[1].isAudio, false);

// 7. i18n zh/en parity
const prevLang = languagePreference();
try {
  const keys = [
    'chat.audio.play', 'chat.audio.pause', 'chat.audio.loading', 'chat.audio.tapToPlay',
    'chat.audio.playbackFailed', 'chat.audio.saveShare', 'chat.audio.download', 'chat.audio.speed', 'chat.audio.seek',
  ] as const;
  for (const lang of ['zh', 'en'] as const) {
    setLanguagePreference(lang);
    for (const k of keys) {
      assert.equal(t(k), chatTranslations[k][lang === 'zh' ? 0 : 1]);
      if (lang === 'en') assert.ok(!/[\u4e00-\u9fff]/.test(t(k)), `English ${k} must contain no Chinese`);
    }
  }
} finally {
  setLanguagePreference(prevLang);
}

// 8. Wiring invariants across all surfaces + iOS silent-switch audio mode + icon hygiene
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const chat = read('./ChatScreen.tsx');
const dm = read('./DmChatScreen.tsx');
const sched = read('./ScheduleRunResult.tsx');
const nativeAudio = read('./AuthedAudio.tsx');
const desktopAudio = read('./AttachmentAudioDesktop.tsx');
const audioCard = read('./AttachmentAudioCard.tsx');
const recorder = read('./useVoiceRecorder.ts');

assert.ok(chat.includes('a.isAudio && a.needsAuth && Platform.OS !== \'web\' ? (') && chat.includes('<AuthedAudio'));
assert.ok(chat.includes('a.isAudio && a.needsAuth && a.uri && Platform.OS === \'web\' ? (') && chat.includes('<AttachmentAudioDesktop'));
assert.ok(dm.includes('if (a.needsAuth && isPlayableAudio(a.name, a.mime))') && dm.includes('<AuthedAudio') && dm.includes('<AttachmentAudioDesktop'));
assert.ok(sched.includes('if (a.isAudio && Platform.OS !== \'web\')') && sched.includes('<AuthedAudio') && sched.includes('<AttachmentAudioDesktop'));
assert.ok(nativeAudio.includes('playsInSilentMode: true') && nativeAudio.includes('allowsRecording: false'), 'iOS silent switch & post-recording speaker routing must be configured');
assert.ok(nativeAudio.includes('runNativeDownload(') && nativeAudio.includes('Sharing.shareAsync('), 'native audio reuses shared download cache and keeps Share/Save');
assert.ok(desktopAudio.includes('downloadAuthedBytes(appFetch, uri, token') && desktopAudio.includes('URL.revokeObjectURL'), 'desktop/web audio uses authed bytes + blob URL cleanup');
assert.ok(!audioCard.includes('@expo/vector-icons'), 'AttachmentAudioCard must import Ionicons from ./icons');
assert.ok(recorder.includes('stopAllAudioPlayback()'), 'voice recorder pauses inline audio playback on start');

const ionGlyphs = JSON.parse(readFileSync(new URL('../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json', import.meta.url), 'utf8')) as Record<string, number>;
for (const icon of ['play', 'pause', 'musical-notes']) {
  assert.equal(typeof ionGlyphs[icon], 'number', `Ionicons glyph ${icon} must exist`);
}

console.log('attachment audio: model, bus, i18n, and cross-platform wiring checks passed');
