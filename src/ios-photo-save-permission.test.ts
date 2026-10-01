// iOS「保存图片」(share sheet → Save Image, src/AuthedThumb.tsx Sharing.shareAsync) writes to the photo library.
// Without NSPhotoLibraryAddUsageDescription in Info.plist iOS terminates the app (TCC SIGABRT) the moment
// the user taps it. expo-image-picker's plugin only writes the read / camera strings, so app.json carries it.
// Also pins the draft-thumbnail downscale and the existing picker strings.
import fs from 'node:fs';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) p++; else console.log('FAIL', n); };

const app = JSON.parse(fs.readFileSync('app.json', 'utf8'));
const plist = app?.expo?.ios?.infoPlist ?? {};
const add = plist.NSPhotoLibraryAddUsageDescription;
ck('app.json ios.infoPlist declares NSPhotoLibraryAddUsageDescription (non-empty string)', typeof add === 'string' && add.trim().length > 0);
const picker = (app?.expo?.plugins ?? []).find((x: unknown) => Array.isArray(x) && x[0] === 'expo-image-picker');
ck('expo-image-picker plugin still sets photos + camera strings', !!picker && typeof picker[1]?.photosPermission === 'string' && typeof picker[1]?.cameraPermission === 'string');
ck('ITSAppUsesNonExemptEncryption untouched', plist.ITSAppUsesNonExemptEncryption === false);

// Draft thumbnails decode at tile size on Android too (iOS RCTImageLoader already downsamples to the view).
for (const f of ['src/ChatScreen.tsx', 'src/DmChatScreen.tsx']) {
  const src = fs.readFileSync(f, 'utf8');
  ck(`${f}: draft thumbnail uses resizeMethod="resize"`, src.includes('<Image source={{ uri: item.uri }} style={styles.draftThumb} resizeMode="cover" resizeMethod="resize" />'));
}

console.log(`ios-photo-save-permission: ${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
