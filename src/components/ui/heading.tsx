import { InfoButton } from '@/components/ui/info-button';
import type { InfobarContent } from '@/components/ui/infobar';

interface HeadingProps {
  title: string;
  description: string;
  infoContent?: InfobarContent;
}

export function Heading({ title, description, infoContent }: HeadingProps) {
  return (
    <div className='min-w-0 flex-1 basis-60'>
      <div className='flex items-center gap-2'>
        <h2 className='text-2xl font-bold tracking-tight break-words sm:text-3xl'>{title}</h2>
        {infoContent && (
          <div className='pt-1'>
            <InfoButton content={infoContent} />
          </div>
        )}
      </div>
      <p className='text-muted-foreground text-sm break-words'>{description}</p>
    </div>
  );
}
