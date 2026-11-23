/** A trailing unread count belongs beside the name unless there is text below it. */
export function hasAgentDetailLine(label: string | null | undefined, preview: string, draft: string) {
  return Boolean(label || preview || draft);
}
