import React, { ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { isDynamicImportFailure } from '../../utils/chunkLoadRecovery';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.warn('App caught error in component tree:', error, errorInfo);
  }

  render() {
    const { hasError, error } = this.state;
    if (hasError) {
      const isChunkLoadError = isDynamicImportFailure(error);
      return (
        <div className="min-h-screen bg-stone-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full rounded-2xl p-6 shadow-md border border-stone-200 text-center">
            <div className="w-12 h-12 bg-red-100 text-red-700 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-stone-900 mb-2">
              {isChunkLoadError ? 'This page could not be loaded' : 'Something went wrong'}
            </h2>
            <p className="text-xs text-stone-600 mb-4">
              {isChunkLoadError
                ? 'The application may have updated while this session was open. Reload to load the current version.'
                : error?.message || 'An unexpected error occurred while rendering the page.'}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="inline-flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white font-medium text-xs px-4 py-2 rounded-xl transition cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {isChunkLoadError ? 'Reload application' : 'Reload Application'}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
