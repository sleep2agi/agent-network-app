// 顶层错误边界(owner 2026-10-01):渲染期抛错不再杀进程,换成「出错了 · 重新加载」,并照全局处理器的
// 格式记一份(fatal-runtime.recordFatal)。只依赖 React —— 兜底页由调用方传入(FatalBoundary.tsx 给 RN 版),
// 这样状态流转能在 bun 里直接驱动。
import { Component, createElement, Fragment, type ReactNode } from 'react';

export interface FatalBoundaryProps {
  children?: ReactNode;
  /** 记录(默认接 recordFatal);componentStack 来自 React。 */
  record: (error: unknown, componentStack?: string | null) => void;
  /** 兜底页;onReload 清掉错误并整棵子树重挂。 */
  fallback: (onReload: () => void) => ReactNode;
}

interface State { failed: boolean; attempt: number }

export class FatalBoundaryCore extends Component<FatalBoundaryProps, State> {
  state: State = { failed: false, attempt: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    try { this.props.record(error, info?.componentStack); } catch { /* 记录失败也要显示兜底页 */ }
  }

  reload = () => {
    // attempt 变了 → 子树换 key 整棵重挂(状态清零),而不是在坏状态上重渲染。
    this.setState(s => ({ failed: false, attempt: s.attempt + 1 }));
  };

  render(): ReactNode {
    if (this.state.failed) return this.props.fallback(this.reload);
    return createElement(Fragment, { key: this.state.attempt }, this.props.children);
  }
}
