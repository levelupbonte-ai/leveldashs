'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { CharCounter } from '@/components/forms/char-counter';
import { Textarea } from '@/components/ui/textarea';
import { useAppForm } from '@/lib/form';
import { useFieldMessages } from '@/lib/validation/use-fields';
import type { ChatMessage } from '../api/types';
import { MESSAGE_MAX, messageSchema } from '../lib/message-text';

interface MessageComposerProps {
  conversationId: string;
  placeholder: string;
  /** Set when the caller may not write here (viewer on a visitor conversation, former member). */
  readOnlyReason: string | null;
  securityNote: string;
  replyTo: ChatMessage | null;
  editing: ChatMessage | null;
  onCancel: () => void;
  onSend: (body: string) => void;
  onSaveEdit: (message: ChatMessage, body: string) => void;
  /** ArrowUp in an empty composer: edit your last message. */
  onEditLast: () => void;
}

export function MessageComposer({
  conversationId,
  placeholder,
  readOnlyReason,
  securityNote,
  replyTo,
  editing,
  onCancel,
  onSend,
  onSaveEdit,
  onEditLast
}: MessageComposerProps) {
  const t = useTranslations('chat.composer');
  const fieldMessages = useFieldMessages();
  const schema = useMemo(() => messageSchema(fieldMessages), [fieldMessages]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const form = useAppForm({
    defaultValues: { body: '' },
    validators: { onSubmit: schema },
    onSubmit: ({ value, formApi }) => {
      const { body } = schema.parse(value);
      if (editing) onSaveEdit(editing, body);
      else onSend(body);
      formApi.reset({ body: '' });
      textareaRef.current?.focus();
    }
  });

  // Editing fills the composer with the message (a new conversation remounts it).
  useEffect(() => {
    form.reset({ body: editing?.body ?? '' });
    if (editing) textareaRef.current?.focus();
  }, [editing, form]);
  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  if (readOnlyReason) {
    return (
      <div className='border-border/40 bg-muted/40 text-muted-foreground flex items-center gap-2 rounded-2xl border p-3 text-xs sm:rounded-3xl sm:p-4 sm:text-sm'>
        <Icons.lock className='size-4 shrink-0' aria-hidden='true' />
        {readOnlyReason}
      </div>
    );
  }

  const quoted = editing ?? replyTo;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
      className='space-y-1.5'
      aria-label={t('label')}
    >
      <div className='border-border/40 bg-background/80 rounded-2xl border p-2.5 backdrop-blur sm:rounded-3xl sm:p-3'>
        {quoted ? (
          <div className='bg-muted/60 mb-2 flex items-start gap-2 rounded-xl px-3 py-2 text-xs'>
            {editing ? (
              <Icons.edit className='text-primary mt-0.5 size-3.5 shrink-0' aria-hidden='true' />
            ) : (
              <Icons.reply className='text-primary mt-0.5 size-3.5 shrink-0' aria-hidden='true' />
            )}
            <div className='min-w-0 flex-1'>
              <p className='text-foreground font-medium'>
                {editing ? t('editing') : t('replyingTo', { name: replyTo?.sender_name ?? '' })}
              </p>
              {!editing ? (
                <p className='text-muted-foreground line-clamp-1'>{replyTo?.body}</p>
              ) : null}
            </div>
            <Button
              type='button'
              variant='ghost'
              size='icon-xs'
              onClick={onCancel}
              aria-label={t('cancel')}
            >
              <Icons.close />
            </Button>
          </div>
        ) : null}
        <form.Field
          name='body'
          children={(field) => {
            const length = field.state.value.length;
            const error = field.state.meta.errors[0];
            const errorText =
              typeof error === 'string'
                ? error
                : (error as { message?: string } | undefined)?.message;
            return (
              <div className='flex items-end gap-2'>
                <div className='min-w-0 flex-1'>
                  <Textarea
                    ref={textareaRef}
                    id={`chat-composer-${conversationId}`}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        if (field.state.value.trim()) void form.handleSubmit();
                      } else if (e.key === 'Escape' && quoted) {
                        e.preventDefault();
                        onCancel();
                      } else if (e.key === 'ArrowUp' && !field.state.value && !quoted) {
                        e.preventDefault();
                        onEditLast();
                      }
                    }}
                    placeholder={placeholder}
                    aria-label={placeholder}
                    aria-invalid={!!errorText}
                    aria-describedby={`chat-composer-hint-${conversationId}`}
                    rows={1}
                    maxLength={MESSAGE_MAX + 200}
                    className='text-foreground placeholder:text-muted-foreground/70 max-h-40 min-h-[2.75rem] w-full resize-none border-none bg-transparent px-1.5 dark:bg-transparent text-sm shadow-none focus-visible:ring-0 sm:min-h-[3rem]'
                  />
                  {errorText ? (
                    <p role='alert' className='text-destructive px-1.5 text-xs'>
                      {errorText}
                    </p>
                  ) : length > MESSAGE_MAX - 400 ? (
                    // Shared counter: amber near the limit, red past it.
                    <div className='flex px-1.5'>
                      <CharCounter
                        id={`chat-composer-count-${conversationId}`}
                        count={length}
                        max={MESSAGE_MAX}
                      />
                    </div>
                  ) : null}
                </div>
                <Button
                  type='submit'
                  size='icon'
                  className='size-9 shrink-0 rounded-full shadow-lg sm:size-10'
                  disabled={!field.state.value.trim()}
                  aria-label={editing ? t('save') : t('send')}
                >
                  {editing ? (
                    <Icons.check className='size-4' aria-hidden='true' />
                  ) : (
                    <Icons.send className='size-4' aria-hidden='true' />
                  )}
                </Button>
              </div>
            );
          }}
        />
      </div>
      <div
        id={`chat-composer-hint-${conversationId}`}
        className='text-muted-foreground flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-2 text-[0.7rem]'
      >
        <span className='hidden sm:inline'>{t('hint')}</span>
        <span className='flex items-center gap-1'>
          <Icons.lock className='size-3' aria-hidden='true' />
          {securityNote}
        </span>
      </div>
    </form>
  );
}
