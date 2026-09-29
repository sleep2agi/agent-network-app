// 所见即所得描述编辑的入口(web / 桌面壳)。TipTap + ProseMirror + marked 约 600KB,只有打开任务描述时才用:
// 编辑器和往返判据(rich-markdown.ts)从同一个 import('./rich-bundle') 按需加载,单独成包,不进启动时加载的主包。
// 原生版见 rich-support.ts。
import { lazy, Suspense } from 'react';
import type { RichDescriptionEditorProps } from './rich-editor-types';

export const RICH_EDITOR_AVAILABLE = true;

type RichModule = typeof import('./rich-bundle');
let loaded: RichModule | null = null;
let pending: Promise<RichModule> | null = null;

/** 这段 Markdown 能不能进富文本;null = 判据还没加载完(先 loadRich())。 */
export function richSafetyNow(markdown: string): boolean | null {
  return loaded ? loaded.richSafety(markdown).ok : null;
}

function load(): Promise<RichModule> {
  pending ??= import('./rich-bundle').then(m => (loaded = m));
  return pending;
}

export function loadRich(): Promise<void> {
  return load().then(() => undefined);
}

const Editor = lazy(() => load().then(m => ({ default: m.RichDescriptionEditor })));

export function RichDescriptionEditor(props: RichDescriptionEditorProps) {
  return (
    <Suspense fallback={null}>
      <Editor {...props} />
    </Suspense>
  );
}
