'use client';
import { useMutation } from '@tanstack/react-query';
import { Fragment } from 'react';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const ERRORS: Record<string, string> = {
  limit: 'Limite quotidienne de l’IA atteinte. Réessayez demain.',
  unavailable: 'Le résumé est momentanément indisponible. Réessayez dans un instant.'
};

/** **bold** only: the summary is short Markdown from our own prompt. */
function inline(text: string) {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      )
    );
}

function SummaryText({ text }: { text: string }) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const bullets = lines.filter((l) => /^[-*•]\s/.test(l));
  return (
    <div className='space-y-2 text-sm leading-relaxed'>
      {lines
        .filter((l) => !/^[-*•]\s/.test(l))
        .slice(0, 1)
        .map((l, i) => (
          <p key={i}>{inline(l.replace(/^#+\s*/, ''))}</p>
        ))}
      {bullets.length > 0 && (
        <ul className='list-disc space-y-1 pl-5'>
          {bullets.map((b, i) => (
            <li key={i}>{inline(b.replace(/^[-*•]\s/, ''))}</li>
          ))}
        </ul>
      )}
      {lines
        .filter((l) => !/^[-*•]\s/.test(l))
        .slice(1)
        .map((l, i) => (
          <p key={i}>{inline(l.replace(/^#+\s*/, ''))}</p>
        ))}
    </div>
  );
}

export function WeeklySummaryCard() {
  const summary = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/assistant/weekly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      const body = (await res.json().catch(() => ({}))) as { summary?: string; error?: string };
      if (!res.ok || !body.summary) throw new Error(body.error ?? 'unavailable');
      return body.summary;
    }
  });

  return (
    <Card>
      <CardHeader className='flex flex-row items-start justify-between gap-4'>
        <div className='space-y-1'>
          <CardTitle className='text-base'>Résumé de la semaine</CardTitle>
          <CardDescription>
            Vos 7 derniers jours en quelques lignes. Seuls des chiffres sont analysés, jamais les
            coordonnées de vos clients.
          </CardDescription>
        </div>
        <Button
          size='sm'
          variant='outline'
          disabled={summary.isPending}
          onClick={() => summary.mutate()}
        >
          {summary.isPending ? (
            <Icons.spinner className='size-4 animate-spin' aria-hidden />
          ) : (
            <Icons.sparkles className='size-4' aria-hidden />
          )}
          {summary.data ? 'Actualiser' : 'Générer'}
        </Button>
      </CardHeader>
      {(summary.data || summary.isError) && (
        <CardContent aria-live='polite'>
          {summary.data ? (
            <SummaryText text={summary.data} />
          ) : (
            <p className='text-muted-foreground text-sm'>
              {ERRORS[summary.error?.message ?? ''] ?? ERRORS.unavailable}
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
