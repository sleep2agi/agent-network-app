import * as ImagePicker from 'expo-image-picker';

// Image attachment groundwork (#220 roadmap ③). The picker/permission
// chain is complete; upload stays stubbed until the hub ships
// POST /api/upload (sleep2agi/agent-network#221) and SDK马 posts the
// final response contract there. ATTACH_ENABLED stays false so no
// half-wired UI ever reaches Vincent (quality bar, tg 721).
export const ATTACH_ENABLED = false;

export interface PickedImage {
  uri: string;
  fileName: string;
  mimeType: string;
  fileSize?: number;
}

/** Ask for media-library permission and let the user pick one image. */
export const pickImage = async (): Promise<PickedImage | null> => {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.85,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets?.length) return null;
  const a = result.assets[0];
  return {
    uri: a.uri,
    fileName: a.fileName ?? 'image.jpg',
    mimeType: a.mimeType ?? 'image/jpeg',
    fileSize: a.fileSize,
  };
};

/** Wire to POST /api/upload once #221 lands — align to the contract
 *  comment there, not to drafts. */
export const uploadImage = async (): Promise<never> => {
  throw new Error('upload not wired yet — waiting on hub /api/upload (#221)');
};
