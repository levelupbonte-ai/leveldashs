import Link from 'next/link';
import { Icons } from '@/components/icons';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface StatTileProps {
  label: string;
  value: string | number;
  hint?: string;
  /** Change vs the previous period in %, null = nothing to compare. */
  delta?: number | null;
  deltaLabel?: string;
  icon?: keyof typeof Icons;
  href?: string;
}

/** One headline number (not a chart): label, value, optional trend and hint. */
export function StatTile({ label, value, hint, delta, deltaLabel, icon, href }: StatTileProps) {
  const Icon = icon ? Icons[icon] : null;
  const Trend =
    delta === undefined || delta === null
      ? null
      : delta >= 0
        ? Icons.trendingUp
        : Icons.trendingDown;
  const body = (
    <Card className={cn('h-full min-w-0 gap-2 py-4', href && 'group-hover:bg-muted/40 transition')}>
      <CardHeader className='gap-1 px-4'>
        <CardDescription className='flex items-center gap-2 text-xs'>
          {Icon && <Icon className='size-4 shrink-0' aria-hidden />}
          <span className='truncate'>{label}</span>
        </CardDescription>
        <CardTitle className='text-xl font-semibold break-words tabular-nums sm:text-2xl'>
          {value}
        </CardTitle>
        {(Trend || hint) && (
          <CardDescription className='flex min-w-0 flex-wrap items-center gap-x-2 text-xs'>
            {Trend && (
              <span className='text-foreground inline-flex items-center gap-1 font-medium'>
                <Trend className='size-3.5' aria-hidden />
                {delta! > 0 ? '+' : ''}
                {delta}%{deltaLabel ? <span className='sr-only'> {deltaLabel}</span> : null}
              </span>
            )}
            {hint && <span className='max-w-full truncate'>{hint}</span>}
          </CardDescription>
        )}
      </CardHeader>
    </Card>
  );
  return href ? (
    <Link href={href} className='group block h-full' aria-label={`${label}: ${value}`}>
      {body}
    </Link>
  ) : (
    body
  );
}
