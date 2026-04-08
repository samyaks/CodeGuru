import { Component, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const FRIENDLY_MESSAGE =
  "We're sorry — something unexpected happened. You can try again, or head home and come back later.";

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-midnight flex items-center justify-center px-6 py-16">
          <div className="w-full max-w-md rounded-2xl border border-sky-border bg-red-500/10 p-8 text-center space-y-6">
            <div className="flex justify-center">
              <div className="rounded-full bg-red-500/10 p-4 border border-red-400/20">
                <AlertTriangle className="h-10 w-10 text-red-400" aria-hidden />
              </div>
            </div>
            <div className="space-y-2">
              <h1 className="text-xl font-semibold text-sky-white">Something went wrong</h1>
              <p className="text-sm text-sky-muted leading-relaxed">{FRIENDLY_MESSAGE}</p>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, error: null })}
                className="px-5 py-2.5 rounded-lg bg-gold text-midnight text-sm font-semibold hover:bg-gold-dim transition-colors"
              >
                Try again
              </button>
              <Link
                to="/"
                className="px-5 py-2.5 rounded-lg border border-sky-border text-sm font-medium text-gold hover:text-gold-dim hover:border-gold/30 transition-colors text-center"
              >
                Go home
              </Link>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
