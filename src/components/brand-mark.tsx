import { cn } from '@/lib/utils';

// LevelUp technical-app mark (star in the viewfinder frame), shared with LevelStudio.
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
