import { cn } from '@/lib/utils';

// LevelUp star, same as the LevelUp Ecosystem favicon.
// Served by Next.js from src/app/icon.svg.
export function BrandMark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src='/icon.svg'
      alt=''
      aria-hidden
      width={32}
      height={32}
      className={cn('size-8', className)}
    />
  );
}
