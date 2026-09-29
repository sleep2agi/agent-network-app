/** Matches Hub requirements.ts ISSUE_URL, including its numeric range and 8-item cap. */
export interface RequirementIssue { repo: string; number: number; title: string }
export const MAX_REQUIREMENT_ISSUES = 8;
const ISSUE_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/(\d+)\/?$/;
const ISSUE_SHORT = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/;
export function parseIssue(input: string, shorthand = true): RequirementIssue | null {
 const m = ISSUE_URL.exec(input.trim()) ?? (shorthand ? ISSUE_SHORT.exec(input.trim()) : null);
 if (!m) return null;
 const number = Number(m[3]);
 return Number.isInteger(number) && number >= 1 && number <= 10_000_000 ? { repo: `${m[1]}/${m[2]}`, number, title: '' } : null;
}
export const issueLabel = (issue: RequirementIssue) => `${issue.repo}#${issue.number}`;
export const issueUrl = (issue: RequirementIssue) => `https://github.com/${issue.repo}/issues/${issue.number}`;
export function issuesFromHub(raw: unknown): RequirementIssue[] | undefined {
 if (!Array.isArray(raw) || raw.length > MAX_REQUIREMENT_ISSUES) return undefined;
 const out: RequirementIssue[] = [];
 for (const row of raw) {
  const value = typeof row === 'string' ? parseIssue(row, false) : row && typeof row === 'object' ? parseIssue(typeof row.url === 'string' ? row.url : `https://github.com/${row.repo}/issues/${row.number}`, false) : null;
  if (!value) return undefined; // Do not offer edits over unreadable data and accidentally erase it.
  if (typeof row?.title === 'string') value.title = row.title;
  if (!out.some(i => issueLabel(i) === issueLabel(value))) out.push(value);
 }
 return out.length <= MAX_REQUIREMENT_ISSUES ? out : undefined;
}
export const issuesWire = (issues: readonly RequirementIssue[]) => issues.map(i => ({ url: issueUrl(i), title: i.title }));
export function issueCount(item: { issues?: RequirementIssue[]; externalUrl?: string | null }): number {
 const source = item.externalUrl ? parseIssue(item.externalUrl, false) : null;
 return new Set([...(item.issues ?? []), ...(source ? [source] : [])].map(issueLabel)).size;
}
