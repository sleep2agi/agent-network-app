export type NodeActionTone = 'neutral' | 'caution' | 'danger';

export interface NodeActionPalette {
  card: string;
  border: string;
  textSecondary: string;
  blocked: string;
  failed: string;
}

export interface NodeActionVisual {
  borderColor: string;
  backgroundColor: string;
  textColor: string;
}

/** Semantic action hierarchy shared by dark/light themes.
 * Restart stays neutral, stop asks for caution, delete is destructive.
 * None of them uses the high-saturation primary CTA fill. */
export function nodeActionVisual(palette: NodeActionPalette, tone: NodeActionTone): NodeActionVisual {
  if (tone === 'danger') {
    return { borderColor: palette.failed, backgroundColor: palette.card, textColor: palette.failed };
  }
  if (tone === 'caution') {
    return { borderColor: palette.blocked, backgroundColor: palette.card, textColor: palette.blocked };
  }
  return { borderColor: palette.border, backgroundColor: palette.card, textColor: palette.textSecondary };
}
