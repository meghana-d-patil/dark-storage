import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onReset: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ViewErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('View render error caught by boundary:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div
          className="card"
          style={{ padding: '3rem', textAlign: 'center', margin: '2rem auto', maxWidth: '600px' }}
        >
          <h3 style={{ color: 'var(--accent-danger)', marginBottom: '0.75rem' }}>Failed to load view</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '14px' }}>
            {this.state.error?.message || 'An unexpected error occurred while rendering the view.'}
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              this.props.onReset();
            }}
          >
            Back to Cards
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
