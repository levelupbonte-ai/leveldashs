'use client';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Markdown } from '@/components/markdown';
import { CharCounter } from '@/components/forms/char-counter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { PlanLimitNotice } from '@/features/billing/components/plan-limit-notice';
import { PlanLimitError, parsePlanLimit, type PlanLimitInfo } from '@/lib/plan-limit';
import { cn } from '@/lib/utils';
import {
  ASSISTANT_ACCEPT,
  ASSISTANT_MAX_FILES,
  prepareFile,
  type PreparedFile
} from '../lib/prepare-file';
import type {
  AssistantMessage,
  AssistantProposal,
  AssistantReply,
  AssistantTriage
} from '../types';
import { ActionCard } from './action-card';

/** Same cap as POST /api/assistant (one message). */
const PROMPT_MAX = 4000;

const SUGGESTIONS = ['problem', 'week', 'service', 'seo'] as const;

type Turn = AssistantMessage & {
  files?: { name: string; preview: string | null; kind: PreparedFile['kind'] }[];
  proposals?: AssistantProposal[];
  triage?: AssistantTriage | null;
};

const URGENCY_STYLE: Record<AssistantTriage['urgency'], string> = {
  urgent: 'border-destructive/40 bg-destructive/10 text-destructive',
  high: 'border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  normal: 'border-border bg-muted text-foreground',
  low: 'border-border bg-muted text-muted-foreground'
};

function TriageChip({ triage }: { triage: AssistantTriage }) {
  const tCat = useTranslations('assistant.categories');
  const tUrg = useTranslations('assistant.urgency');
  const t = useTranslations('assistant');
  return (
    <div
      className={cn('mb-2 rounded-lg border px-3 py-2 text-xs', URGENCY_STYLE[triage.urgency])}
      aria-label={t('triageLabel')}
    >
      <div className='flex flex-wrap items-center gap-1.5 font-medium'>
        <Icons.listCheck className='size-3.5' aria-hidden />
        {tCat(triage.category)} · {tUrg(triage.urgency)}
      </div>
      {triage.summary && <p className='mt-0.5'>{triage.summary}</p>}
    </div>
  );
}

function FileChip({
  file,
  onRemove,
  removeLabel
}: {
  file: { name: string; preview: string | null; kind: PreparedFile['kind'] };
  onRemove?: () => void;
  removeLabel?: string;
}) {
  return (
    <div className='bg-background flex max-w-[12rem] items-center gap-2 rounded-lg border p-1 pr-2 text-xs'>
      {file.preview ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
        <img src={file.preview} alt='' className='size-9 shrink-0 rounded-md object-cover' />
      ) : (
        <span className='bg-muted flex size-9 shrink-0 items-center justify-center rounded-md'>
          {file.kind === 'pdf' ? (
            <Icons.fileTypePdf className='size-4' aria-hidden />
          ) : (
            <Icons.notes className='size-4' aria-hidden />
          )}
        </span>
      )}
      <span className='min-w-0 truncate'>{file.name}</span>
      {onRemove && (
        <button
          type='button'
          onClick={onRemove}
          aria-label={removeLabel}
          className='text-muted-foreground hover:text-foreground -mr-1 ml-auto flex size-7 shrink-0 items-center justify-center rounded-md'
        >
          <Icons.close className='size-3.5' aria-hidden />
        </button>
      )}
    </div>
  );
}

export function AssistantChat() {
  const { canEdit, website } = useSiteScope();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<PreparedFile[]>([]);
  const [reading, setReading] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [planLimit, setPlanLimit] = useState<PlanLimitInfo | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const t = useTranslations('assistant');

  const scrollDown = () =>
    requestAnimationFrame(() =>
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    );

  // Free the image previews when the page closes.
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), []);

  async function addFiles(list: FileList | File[]) {
    const picked = Array.from(list).slice(0, Math.max(0, ASSISTANT_MAX_FILES - files.length));
    if (list.length > picked.length) toast.error(t('files.tooMany', { max: ASSISTANT_MAX_FILES }));
    if (!picked.length) return;
    setReading(true);
    const ready: PreparedFile[] = [];
    for (const file of picked) {
      const result = await prepareFile(file);
      if (typeof result === 'string') {
        toast.error(t(`files.${result}`, { name: file.name }));
      } else {
        if (result.preview) previews.current.push(result.preview);
        ready.push(result);
      }
    }
    setFiles((current) => [...current, ...ready].slice(0, ASSISTANT_MAX_FILES));
    setReading(false);
  }

  const ask = useMutation({
    mutationFn: async (vars: { history: Turn[]; files: PreparedFile[] }) => {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: vars.history.map(({ role, text }) => ({ role, text })),
          ...(vars.files.length
            ? { attachments: vars.files.map(({ name, mime, data }) => ({ name, mime, data })) }
            : {})
        })
      });
      const body = (await res.json().catch(() => ({}))) as Partial<AssistantReply> & {
        error?: string;
        limit?: unknown;
      };
      const limit = body.error === 'plan_limit' ? parsePlanLimit(body.limit) : null;
      if (limit) throw new PlanLimitError(limit);
      if (!res.ok)
        throw new Error(res.status === 413 ? 'too_large' : (body.error ?? 'unavailable'));
      return body as AssistantReply;
    },
    onSuccess: (data) => {
      setTurns((all) => [
        ...all,
        { role: 'assistant', text: data.reply, proposals: data.proposals, triage: data.triage }
      ]);
      if (data.refusedFiles?.length) {
        toast.error(t('files.refused', { names: data.refusedFiles.join(', ') }));
      }
      if (typeof data.remaining === 'number') setRemaining(data.remaining);
      scrollDown();
    },
    onError: (e, vars) => {
      // Give the message back so nothing typed or attached is lost.
      setTurns(vars.history.slice(0, -1));
      setDraft(vars.history.at(-1)?.text ?? '');
      setFiles(vars.files);
      if (e instanceof PlanLimitError) {
        setPlanLimit(e.info);
        return;
      }
      const code = e.message;
      toast.error(
        code === 'limit'
          ? t('limit')
          : code === 'too_large'
            ? t('files.size', { name: '' })
            : code === 'unauthenticated'
              ? t('signedOut')
              : code === 'forbidden'
                ? t('forbidden')
                : t('unavailable')
      );
    }
  });

  function send(text: string) {
    const message =
      text.trim().slice(0, PROMPT_MAX) || (files.length ? t('files.defaultPrompt') : '');
    if (!message || ask.isPending || reading) return;
    const history: Turn[] = [
      ...turns,
      {
        role: 'user',
        text: message,
        files: files.map(({ name, preview, kind }) => ({ name, preview, kind }))
      }
    ];
    setTurns(history);
    setDraft('');
    const sent = files;
    setFiles([]);
    ask.mutate({ history, files: sent });
    scrollDown();
  }

  const busy = ask.isPending || reading;

  return (
    <div className='mx-auto flex w-full max-w-3xl flex-col gap-4'>
      {turns.length === 0 && (
        <div className='rounded-2xl border p-4 sm:p-5'>
          <div className='flex items-center gap-2 font-medium'>
            <span className='bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg'>
              <Icons.starMark className='size-4' aria-hidden />
            </span>
            {t('title', { name: website.name })}
          </div>
          <p className='text-muted-foreground mt-2 text-sm'>{t('intro')}</p>
          <ul className='text-muted-foreground mt-3 grid gap-1.5 text-sm'>
            {(['solve', 'files', 'actions'] as const).map((k) => (
              <li key={k} className='flex gap-2'>
                <Icons.check className='text-primary mt-0.5 size-4 shrink-0' aria-hidden />
                {t(`can.${k}`)}
              </li>
            ))}
          </ul>
          <div className='mt-4 grid gap-2 sm:grid-cols-2'>
            {SUGGESTIONS.map((s) => (
              <Button
                key={s}
                variant='outline'
                className='h-auto min-h-11 justify-start whitespace-normal py-2 text-left'
                onClick={() => send(t(`suggestions.${s}`))}
              >
                {t(`suggestions.${s}`)}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className='flex flex-col gap-4' aria-live='polite'>
        {turns.map((turn, i) =>
          turn.role === 'user' ? (
            <div key={i} className='flex flex-col items-end gap-1.5'>
              {!!turn.files?.length && (
                <div className='flex max-w-[90%] flex-wrap justify-end gap-1.5'>
                  {turn.files.map((f, j) => (
                    <FileChip key={j} file={f} />
                  ))}
                </div>
              )}
              <div className='bg-primary text-primary-foreground max-w-[90%] rounded-2xl rounded-br-md px-4 py-2.5 text-sm whitespace-pre-wrap sm:max-w-[80%]'>
                {turn.text}
              </div>
            </div>
          ) : (
            <div key={i} className='flex gap-2.5'>
              <span className='bg-primary/10 text-primary mt-1 hidden size-7 shrink-0 items-center justify-center rounded-lg sm:flex'>
                <Icons.starMark className='size-4' aria-hidden />
              </span>
              <div className='min-w-0 flex-1'>
                {turn.triage && <TriageChip triage={turn.triage} />}
                <div className='bg-muted rounded-2xl rounded-tl-md px-4 py-3 text-sm'>
                  <Markdown
                    source={turn.text}
                    className='text-sm [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5'
                  />
                </div>
                {turn.proposals?.map((p, j) => (
                  <ActionCard key={j} proposal={p} canEdit={canEdit} />
                ))}
              </div>
            </div>
          )
        )}
        {ask.isPending && (
          <div className='text-muted-foreground flex items-center gap-2 text-sm'>
            <Icons.spinner className='size-4 animate-spin' aria-hidden />
            {turns.at(-1)?.files?.length ? t('readingFiles') : t('thinking')}
          </div>
        )}
        <div ref={endRef} />
      </div>
      {planLimit && <PlanLimitNotice info={planLimit} />}

      {/* Composer: stays at the bottom of the screen on phones. */}
      <form
        className='bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky bottom-0 -mx-4 border-t px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:bottom-4 sm:mx-0 sm:rounded-2xl sm:border sm:p-2 sm:shadow-sm'
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        {(files.length > 0 || reading) && (
          <div className='mb-2 flex flex-wrap gap-1.5'>
            {files.map((f, i) => (
              <FileChip
                key={`${f.name}-${i}`}
                file={f}
                removeLabel={t('files.remove', { name: f.name })}
                onRemove={() => setFiles((all) => all.filter((_, j) => j !== i))}
              />
            ))}
            {reading && (
              <span className='text-muted-foreground flex items-center gap-1.5 px-2 text-xs'>
                <Icons.spinner className='size-3.5 animate-spin' aria-hidden />
                {t('files.preparing')}
              </span>
            )}
          </div>
        )}
        <div className='flex items-end gap-1.5'>
          <input
            ref={fileRef}
            type='file'
            accept={ASSISTANT_ACCEPT}
            multiple
            className='sr-only'
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              if (e.target.files?.length) void addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='size-11 shrink-0'
            disabled={busy || files.length >= ASSISTANT_MAX_FILES}
            onClick={() => fileRef.current?.click()}
            aria-label={t('files.attach')}
            title={t('files.attach')}
          >
            <Icons.paperclip className='size-5' aria-hidden />
          </Button>
          <Textarea
            ref={inputRef}
            aria-label={t('message')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => {
              const pasted = Array.from(e.clipboardData.files);
              if (pasted.length) {
                e.preventDefault();
                void addFiles(pasted);
              }
            }}
            onKeyDown={(e) => {
              // Enter sends on a computer; on a phone the keyboard's Enter adds a line.
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                window.matchMedia('(pointer: fine)').matches
              ) {
                e.preventDefault();
                send(draft);
              }
            }}
            placeholder={t('placeholder')}
            className='max-h-40 min-h-11 resize-none border-0 bg-transparent text-base shadow-none focus-visible:ring-0 sm:text-sm'
            maxLength={PROMPT_MAX}
            enterKeyHint='send'
            aria-describedby={draft.length > PROMPT_MAX * 0.8 ? 'assistant-count' : undefined}
          />
          <Button
            type='submit'
            size='icon'
            className='size-11 shrink-0 rounded-xl'
            disabled={(!draft.trim() && !files.length) || busy}
            aria-label={t('send')}
          >
            {ask.isPending ? (
              <Icons.spinner className='size-4 animate-spin' aria-hidden />
            ) : (
              <Icons.send className='size-4' aria-hidden />
            )}
          </Button>
        </div>
        <div className='text-muted-foreground mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-1 text-[11px]'>
          <span>{t('privacy')}</span>
          {draft.length > PROMPT_MAX * 0.8 ? (
            <CharCounter id='assistant-count' count={draft.length} max={PROMPT_MAX} />
          ) : remaining !== null ? (
            <Badge variant='outline' className='shrink-0 font-normal'>
              {t('remaining', { count: remaining })}
            </Badge>
          ) : null}
        </div>
      </form>
    </div>
  );
}
