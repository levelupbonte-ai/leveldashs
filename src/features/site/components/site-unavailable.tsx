import { Icons } from '@/components/icons';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';

export function SiteUnavailable({ reason }: { reason: 'no-website' | 'disabled' }) {
  return (
    <Empty className='border'>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          {reason === 'no-website' ? <Icons.world /> : <Icons.lock />}
        </EmptyMedia>
        <EmptyTitle>
          {reason === 'no-website' ? 'Aucun site pour le moment' : 'Fonction non activée'}
        </EmptyTitle>
        <EmptyDescription>
          {reason === 'no-website'
            ? 'Votre site sera relié à ce tableau de bord par l’équipe LevelUp.'
            : 'Cette fonction n’est pas activée pour ce site. Contactez LevelUp pour l’ajouter.'}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
