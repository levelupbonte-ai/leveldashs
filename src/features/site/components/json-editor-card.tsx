'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useState } from 'react';

/** Edits one JSON value; validates before saving. */
export function JsonEditorCard({
  title,
  description,
  badge,
  value,
  disabled,
  saving,
  onSave
}: {
  title: string;
  description?: string;
  badge?: string;
  value: unknown;
  disabled?: boolean;
  saving?: boolean;
  onSave: (value: unknown) => void;
}) {
  const initial = JSON.stringify(value, null, 2);
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const dirty = text !== initial;

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2 font-mono text-sm'>
          {title}
          {badge && <Badge variant='secondary'>{badge}</Badge>}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <Textarea
          className='min-h-40 font-mono text-xs'
          spellCheck={false}
          value={text}
          disabled={disabled}
          aria-invalid={!!error}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
        {error && <p className='text-destructive mt-2 text-xs'>{error}</p>}
      </CardContent>
      {!disabled && (
        <CardFooter className='gap-2'>
          <Button
            size='sm'
            disabled={!dirty || saving}
            onClick={() => {
              try {
                const parsed = JSON.parse(text);
                if (text.length > 64000) throw new Error('too large');
                onSave(parsed);
              } catch {
                setError('Format invalide : vérifiez les guillemets, virgules et accolades.');
              }
            }}
          >
            Enregistrer
          </Button>
          {dirty && (
            <Button size='sm' variant='ghost' onClick={() => setText(initial)}>
              Annuler
            </Button>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
