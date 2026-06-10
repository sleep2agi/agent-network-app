// Design tokens lifted from the dashboard's #217 design language:
// neutral near-black surfaces, restrained color, semantic status triad.
export const colors = {
  bg: '#0b0b0d',
  card: '#161618',
  border: '#26262b',
  inputBg: '#0e0e10',
  text: '#f4f4f5',
  textSecondary: '#a1a1aa',
  textMuted: '#52525b',
  accent: '#22d3ee',
  running: '#22c55e',
  failed: '#ef4444',
  blocked: '#f59e0b',
  rest: '#71717a',
};

export const statusColor = (status: string, online: boolean): string => {
  if (!online) return colors.rest;
  switch (status) {
    case 'working':
    case 'running':
      return colors.running;
    case 'error':
    case 'failed':
      return colors.failed;
    case 'blocked':
      return colors.blocked;
    default:
      return colors.rest;
  }
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
