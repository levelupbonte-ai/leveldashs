'use client';
import { ErrorBoundaryView } from '@/components/errors/error-boundary-view';

export default function RootError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorBoundaryView error={error} reset={reset} />;
}
