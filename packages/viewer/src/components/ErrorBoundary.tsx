import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  fallback?: (error: Error) => ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error);
      }
      return (
        <div role="alert" className="fbjs-error">
          <p>Something went wrong</p>
          <p>{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
