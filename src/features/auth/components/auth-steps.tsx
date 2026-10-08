import { cn } from '@/lib/utils';

const STEPS = ['Compte', 'E-mail', 'Profil', 'Validation'];

/** Where the visitor is in account creation: account, e-mail, profile, approval. */
export function AuthSteps({ current }: { current: 0 | 1 | 2 | 3 }) {
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
              i <= current ? 'bg-primary' : 'bg-muted'
            )}
          />
          <span
            className={cn(
              'text-[11px]',
              i === current ? 'text-foreground font-medium' : 'text-muted-foreground'
            )}
          >
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}
