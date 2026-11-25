/**
 * Composer @ picker.
 *
 * - Triggers both at the start of the draft (`@神`) AND mid-sentence (`你可以找 @神` / `找@神`),
 *   at the active caret position, while ignoring escaped `\@` and email addresses (`foo@bar.com`).
 * - Selecting a row replaces ONLY the active `@query` span with `@alias `, preserving the rest
 *   of the draft, and returns the exact post-insertion cursor offset. It never sends.
 * - Filters out malformed empty/null aliases and host_supervisor daemons.
 */
export type MentionAgent = {
  alias?: string | null;
  label?: string | null;
  description?: string | null;
  online?: boolean;
  role?: string | null;
};

export type MentionSpan = {
  start: number;
  end: number;
  query: string;
};

export type MentionCandidate = {
  alias: string;
  label: string;
  description: string;
  online: boolean;
  insert: string;
  cursor: number;
};

const EMAIL_PREFIX_CHAR = /[A-Za-z0-9._+-]/;

/** Active `@token` span ending at `cursor` (defaults to end of `input`), or null when closed. */
export function mentionSpanAt(input: string, cursor?: number): MentionSpan | null {
  if (!input) return null;
  const end = typeof cursor === 'number' && Number.isFinite(cursor)
    ? Math.max(0, Math.min(input.length, Math.floor(cursor)))
    : input.length;
  // Walk backward from cursor until whitespace or `@`.
  let i = end - 1;
  while (i >= 0 && !/\s/.test(input[i]!)) {
    if (input[i] === '@') {
      // Escaped `\@` is ordinary text.
      if (i > 0 && input[i - 1] === '\\') return null;
      // Email / identifier (`user@host.com`) must not pop the mention picker.
      if (i > 0 && EMAIL_PREFIX_CHAR.test(input[i - 1]!)) return null;
      return { start: i, end, query: input.slice(i + 1, end) };
    }
    i -= 1;
  }
  return null;
}

/** The @ token being typed, or null when the menu should stay closed. */
export function mentionQuery(input: string, cursor?: number): string | null {
  return mentionSpanAt(input, cursor)?.query ?? null;
}

export function mentionMenuOpen(input: string, cursor?: number): boolean {
  return mentionSpanAt(input, cursor) !== null;
}

/** Replace only the active `@query` span with `@alias ` (avoiding double space before existing space). */
export function applyMentionReplacement(
  input: string,
  span: MentionSpan,
  alias: string,
): { value: string; cursor: number } {
  const before = input.slice(0, span.start);
  const after = input.slice(span.end);
  const needsSpace = after.length === 0 || !/^\s/.test(after);
  const token = `@${alias}${needsSpace ? ' ' : ''}`;
  const value = `${before}${token}${after}`;
  const cursor = before.length + `@${alias} `.length;
  return { value, cursor: Math.min(value.length, cursor) };
}

/** First non-empty line of a node description, trimmed for one-line display in the picker. */
function shortDescription(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  const line = raw.split(/\r?\n/).map(s => s.trim()).find(Boolean) ?? '';
  return line.slice(0, 80);
}

/** Merge `/api/nodes` and `/api/status?light=1` defensively (either source may be missing/partial). */
export function mergeMentionAgents(
  nodes: ReadonlyArray<{ alias?: string | null; display_name?: string | null; description?: string | null; role?: string | null }> | null | undefined,
  sessions: ReadonlyArray<{ alias?: string | null; status?: string | null }> | null | undefined,
): MentionAgent[] {
  const onlineAliases = new Set<string>();
  const daemonAliases = new Set<string>();
  const byAlias = new Map<string, MentionAgent>();

  for (const s of sessions ?? []) {
    const alias = typeof s?.alias === 'string' ? s.alias.trim() : '';
    if (!alias) continue;
    if (s.status && s.status !== 'offline') onlineAliases.add(alias);
  }

  for (const n of nodes ?? []) {
    const alias = typeof n?.alias === 'string' ? n.alias.trim() : '';
    if (!alias) continue;
    if (n.role === 'host_supervisor') {
      daemonAliases.add(alias);
      continue;
    }
    const label = typeof n.display_name === 'string' && n.display_name.trim() ? n.display_name.trim() : undefined;
    const description = shortDescription(n.description);
    const prev = byAlias.get(alias);
    byAlias.set(alias, {
      alias,
      label: label ?? prev?.label,
      description: description || prev?.description,
      online: onlineAliases.has(alias) || prev?.online === true,
      role: n.role ?? prev?.role,
    });
  }

  for (const s of sessions ?? []) {
    const alias = typeof s?.alias === 'string' ? s.alias.trim() : '';
    if (!alias || daemonAliases.has(alias) || byAlias.has(alias)) continue;
    byAlias.set(alias, {
      alias,
      online: !!s.status && s.status !== 'offline',
    });
  }

  return [...byAlias.values()];
}

export function mentionCandidates(input: string, agents: MentionAgent[], cursor?: number): MentionCandidate[] {
  const span = mentionSpanAt(input, cursor);
  if (span === null) return [];
  const q = span.query.trim().toLowerCase();
  const seen = new Set<string>();
  const ranked: Array<{ rank: number; row: MentionCandidate }> = [];

  for (const agent of agents ?? []) {
    const alias = typeof agent?.alias === 'string' ? agent.alias.trim() : '';
    if (!alias || seen.has(alias)) continue;
    if (agent.role === 'host_supervisor') continue;
    const label = (typeof agent.label === 'string' && agent.label.trim() ? agent.label : alias).trim();
    const description = shortDescription(agent.description);
    const aliasLower = alias.toLowerCase();
    const labelLower = label.toLowerCase();
    const descLower = description.toLowerCase();
    let rank = 0;
    if (q) {
      if (aliasLower.startsWith(q)) rank = 0;
      else if (aliasLower.includes(q)) rank = 1;
      else if (labelLower.includes(q)) rank = 2;
      else if (descLower.includes(q)) rank = 3;
      else continue;
    }
    seen.add(alias);
    const replaced = applyMentionReplacement(input, span, alias);
    ranked.push({
      rank,
      row: {
        alias,
        label,
        description,
        online: agent.online === true,
        insert: replaced.value,
        cursor: replaced.cursor,
      },
    });
  }

  ranked.sort((a, b) =>
    Number(b.row.online) - Number(a.row.online)
    || a.rank - b.rank
    || a.row.alias.localeCompare(b.row.alias, 'zh'),
  );
  return ranked.map(item => item.row);
}
