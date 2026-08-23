/** Keep attachment transport hints in the task payload for legacy runtimes,
 * but never expose Hub filesystem paths or raw authenticated API instructions
 * as chat copy. */
export const cleanAttachmentDebugText = (text: string) =>
  text
    .replace(/\[([^\]]+)\]\([^()\s]*\/api\/files\/[A-Za-z0-9_-]{8,64}\)/g, '$1')
    .replace(/^服务器路径\s*:\s*.*(?:\r?\n|$)/gim, '')
    .replace(/^API\s*:\s*GET\s+\S*\/api\/files\/[A-Za-z0-9_-]{8,64}\s*(?:\r?\n|$)/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
