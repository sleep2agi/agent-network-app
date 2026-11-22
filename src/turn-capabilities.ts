/** #5332: explicit reports win; unknown runtimes fail closed. */
export interface TurnCapabilityReport {
  turn_interrupt_capable?: boolean | null;
  turn_steer_capable?: boolean | null;
  runtime?: string | null;
  agent_node_version?: string | null;
  version?: string | null;
  build_commit?: string | null;
  opencode_generation?: string | null;
  opencode_mode?: string | null;
  config_snapshot?: {
    turn_interrupt_capable?: boolean | null;
    turn_steer_capable?: boolean | null;
    flags?: Record<string, unknown>;
  } | null;
}

function atLeast(version: string, preview: number): boolean {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-preview\.(\d+))?(?:\+[\w.-]+)?$/.exec(version);
  if (!m) return false;
  const [major, minor, patch] = m.slice(1, 4).map(Number);
  if (major !== 2) return major > 2;
  if (minor !== 5) return minor > 5;
  if (patch !== 0) return patch > 0;
  return m[4] === undefined || Number(m[4]) >= preview;
}

export function turnCapabilities(node?: TurnCapabilityReport | null) {
  const snapshot = node?.config_snapshot;
  const flags = snapshot?.flags;
  const v2 = (node?.runtime === 'opencode-cli' || node?.runtime === 'opencode')
    && (node.opencode_generation ?? flags?.opencodeGeneration) === 'v2'
    && (node.opencode_mode ?? flags?.opencodeMode) === 'copresence';
  const version = node?.agent_node_version ?? node?.version ?? '';
  function capability(key: 'turn_interrupt_capable' | 'turn_steer_capable', fallback: boolean) {
    const value = node?.[key] ?? snapshot?.[key];
    // Invalid non-null reports must not accidentally enter the legacy fallback.
    return value == null ? fallback : value === true;
  }
  return {
    interrupt: capability('turn_interrupt_capable', v2 && atLeast(version, 207)),
    steer: capability('turn_steer_capable', v2 && (atLeast(version, 210)
      || /^4e2f1a78[0-9a-f]*$/i.test(node?.build_commit ?? '')
      || /(?:^|[+.-])4e2f1a78(?:$|[.-])/i.test(version))),
  };
}
