import { EXTERNAL_LINK_REL } from '@/lib/validation/sanitize';
import { cn } from '@/lib/utils';
import { linkify } from '../lib/message-text';

interface MessageBodyProps {
  text: string;
  className?: string;
  linkClassName?: string;
}

/**
 * Plain text with line breaks. Only http(s) URLs become links (new tab,
 * rel=noopener noreferrer nofollow); nothing is ever rendered as HTML.
 */
export function MessageBody({ text, className, linkClassName }: MessageBodyProps) {
  return (
    <p className={cn('break-words whitespace-pre-wrap', className)}>
      {linkify(text).map((part, i) =>
        part.type === 'link' ? (
          <a
            key={i}
            href={part.href}
            target='_blank'
            rel={EXTERNAL_LINK_REL}
            className={cn('underline underline-offset-2 hover:opacity-80', linkClassName)}
          >
            {part.value}
          </a>
        ) : (
          <span key={i}>{part.value}</span>
        )
      )}
    </p>
  );
}
