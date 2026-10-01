// 设置 › 关于 的「复制上次崩溃信息」:盘上有记录才出现;复制后删掉记录(行随之消失)。
import { useEffect, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { fatalDiagnosticsText, type FatalReport } from './fatal-report';
import { fatalStore } from './fatal-runtime';

export function useLastFatalReport(): FatalReport | null {
  const [report, setReport] = useState<FatalReport | null>(() => fatalStore.read());
  useEffect(() => fatalStore.subscribe(() => setReport(fatalStore.read())), []);
  return report;
}

/** 复制成功才删记录;复制失败留着下次再试。 */
export async function copyLastFatal(report: FatalReport): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(fatalDiagnosticsText(report));
  } catch {
    return false;
  }
  fatalStore.clear();
  return true;
}
