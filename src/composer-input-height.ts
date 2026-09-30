// Web export only: the phone composer textarea's height for `lines` lines (native TextInput sizes itself).
// Shared by the agent chat (ChatScreen) and human DMs (DmChatScreen) so both inputs grow the same way.
import { COMPOSER_INPUT_BORDER, COMPOSER_LINE_HEIGHT, composerControlSize, composerInputPadY } from './composer-row-layout';
import { uiScale } from './ui-scale';

export function webComposerInputHeight(lines: number): number {
  const control = composerControlSize(uiScale().densityFactor);
  const line = COMPOSER_LINE_HEIGHT * uiScale().fontMultiplier;
  const pad = composerInputPadY(control, line);
  return Math.min(120, Math.max(control, Math.ceil(lines * line + 2 * pad + 2 * COMPOSER_INPUT_BORDER)));
}
