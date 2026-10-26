'use client';

// Top-level error boundary — a render crash shows a recoverable screen
// instead of unmounting the whole tree to a white page.

import React from 'react';

interface State {
  hasError: boolean;
  message: string | null;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, message: error instanceof Error ? error.message : null };
  }

  componentDidCatch(error: unknown): void {
    console.error('[collabify] render crash:', error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen bg-[#232332] text-slate-200 flex flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-xl font-bold">Something went wrong</h1>
        <p className="text-xs text-slate-400 max-w-md break-all">
          {this.state.message || 'An unexpected error occurred while rendering.'}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-5 py-2.5 rounded-lg bg-[#CAA4F7] hover:bg-[#D4B5F9] text-[#1E1E2A] text-sm font-bold"
        >
          Reload Collabify
        </button>
      </div>
    );
  }
}
