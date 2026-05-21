'use client';
import { useEffect } from 'react';
import Link from 'next/link';

export default function Error({ error, reset }) {
  useEffect(() => {
    // Log to an error reporting service in production.
    // console.error is intentional in error boundaries – it's the browser's
    // only output channel before a reporting SDK can be initialised.
    // eslint-disable-next-line no-console
    console.error('Page error:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-cream flex flex-col items-center justify-center px-6 text-center">
      <p className="font-mono text-8xl font-bold text-border mb-4">500</p>
      <h1 className="font-display text-4xl text-ink mb-3">Something went wrong</h1>
      <p className="text-muted mb-8 max-w-sm text-sm">
        {error?.message || 'An unexpected error occurred. Please try again.'}
      </p>
      <div className="flex gap-4">
        <button onClick={reset} className="btn-primary">
          Try again
        </button>
        <Link href="/" className="btn-outline">
          Go home
        </Link>
      </div>
    </div>
  );
}
