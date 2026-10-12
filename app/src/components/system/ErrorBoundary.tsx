'use client';

import { Component, type ReactNode } from 'react';
import { app } from '@/store/app';
import { translate } from '@/lib/i18n';

interface Props { children: ReactNode; /** Changing this value clears the error, e.g. when the route changes. */ resetKey?: string }
interface State { failed: boolean }

/** Keeps one broken screen from taking the whole app down. Details never reach the user. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State { return { failed: true }; }

  componentDidUpdate(prev: Props): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const lang = app.get().settings.language;
    return (
      <div role="alert" className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-5 px-6 text-center">
        <p className="text-base text-muted">{translate(lang, 'common.error')}</p>
        <button type="button" className="btn-quiet h-10 px-5 text-sm" onClick={() => location.reload()}>{translate(lang, 'common.reload')}</button>
      </div>
    );
  }
}
