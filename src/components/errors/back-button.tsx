'use client';
import { useRouter } from 'next/navigation';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';

/** "Go back" for the error pages: history back, or `fallback` on a direct visit. */
export function BackButton({ label, fallback = '/' }: { label: string; fallback?: string }) {
  const router = useRouter();
  return (
    <Button
      variant='outline'
      size='lg'
      onClick={() => (window.history.length > 1 ? router.back() : router.push(fallback))}
    >
      <Icons.chevronLeft className='size-4' aria-hidden />
      {label}
    </Button>
  );
}
