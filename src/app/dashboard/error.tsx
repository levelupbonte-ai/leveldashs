'use client';
import { ErrorBoundaryView } from '@/components/errors/error-boundary-view';

// Keeps the sidebar and header: only the page area shows the error.
export default function DashboardError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorBoundaryView error={error} reset={reset} className='min-h-[70svh] bg-transparent' />;
}
