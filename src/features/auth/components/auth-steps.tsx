import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';

const STEPS = ['Compte', 'E-mail', 'Profil', 'Validation'];

/**
 * Where the visitor is in account creation: account, e-mail, profile, approval.
 * `waiting` marks the current step as waiting on something outside the page
 * (the confirmation link): its bar pulses.
 */
export function AuthSteps({ current, waiting }: { current: 0 | 1 | 2 | 3; waiting?: boolean }) {
  return (
    <ol className='flex items-center gap-2' aria-label='Étapes de création du compte'>
      {STEPS.map((label, i) => (
        <li
          key={label}
          className='flex flex-1 flex-col gap-1.5'
          aria-current={i === current ? 'step' : undefined}
        >
          <span
            className={cn(
              'h-1 rounded-full transition-colors',
              i < current && 'bg-primary',
              i === current && (waiting ? 'bg-primary/60 animate-pulse' : 'bg-primary'),
              i > current && 'bg-muted'
            )}
          />
          <span
            className={cn(
              'flex items-center gap-1 text-[11px]',
              i === current ? 'text-foreground font-medium' : 'text-muted-foreground'
            )}
          >
            {i < current && <Icons.check className='text-primary size-3' aria-hidden />}
            {label}
            {i === current && waiting && <span className='sr-only'> (en attente)</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
