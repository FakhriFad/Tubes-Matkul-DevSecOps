import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-cream flex flex-col items-center justify-center px-6 text-center">
      <p className="font-mono text-8xl font-bold text-border mb-4">404</p>
      <h1 className="font-display text-4xl text-ink mb-3">Page not found</h1>
      <p className="text-muted mb-8 max-w-sm">
        The page you are looking for does not exist or has been moved.
      </p>
      <Link href="/" className="btn-primary">
        Back to home
      </Link>
    </div>
  );
}
