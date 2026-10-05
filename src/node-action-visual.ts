export type NodeActionTone = 'primary' | 'neutral' | 'caution' | 'danger';

export interface NodeActionPalette {
  card: string;
  border: string;
  textSecondary: string;
  blocked: string;
  failed: string;
  /** 主题色(晴蓝)。启动用它描边和写字,不铺底。 */
  accent: string;
}

export interface NodeActionVisual {
  borderColor: string;
  backgroundColor: string;
  textColor: string;
}

/** Semantic action hierarchy shared by dark/light themes.
 * Restart stays neutral, stop asks for caution, delete is destructive.
 * Start (board #585) is the one constructive action: accent outline + text.
 * None of them uses the high-saturation primary CTA fill. */
export function nodeActionVisual(palette: NodeActionPalette, tone: NodeActionTone): NodeActionVisual {
  if (tone === 'danger') {
    return { borderColor: palette.failed, backgroundColor: palette.card, textColor: palette.failed };
  }
  if (tone === 'primary') {
    return { borderColor: palette.accent, backgroundColor: palette.card, textColor: palette.accent };
  }
  if (tone === 'caution') {
    return { borderColor: palette.blocked, backgroundColor: palette.card, textColor: palette.blocked };
  }
  return { borderColor: palette.border, backgroundColor: palette.card, textColor: palette.textSecondary };
}
