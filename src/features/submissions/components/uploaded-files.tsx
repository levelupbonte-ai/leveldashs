'use client';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { createClient } from '@/lib/supabase/client';
import type { UploadedFile } from '../lib/fields';

const BUCKET = 'form-uploads';

/**
 * Files a visitor sent with a LevelUp form. They live in a private bucket:
 * each click asks for a 5-minute signed link, which the database grants only
 * to members of this organization.
 */
export function UploadedFiles({ files }: { files: UploadedFile[] }) {
  const t = useTranslations('site.requests');
  const [busy, setBusy] = useState<string | null>(null);

  async function open(file: UploadedFile) {
    // Open the tab first (pop-up blockers), then point it at the signed link.
    const tab = window.open('about:blank', '_blank');
    setBusy(file.file);
    const { data, error } = await createClient()
      .storage.from(BUCKET)
      .createSignedUrl(file.file, 300);
    setBusy(null);
    if (error || !data?.signedUrl) {
      tab?.close();
      toast.error(t('fileFailed'));
      return;
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = data.signedUrl;
    } else {
      window.location.assign(data.signedUrl);
    }
  }

  return (
    <ul className='grid gap-1.5'>
      {files.map((f) => (
        <li key={f.file}>
          <button
            type='button'
            onClick={() => open(f)}
            disabled={busy === f.file}
            className='hover:bg-muted inline-flex max-w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm'
          >
            {busy === f.file ? (
              <Icons.spinner className='size-4 shrink-0 animate-spin' aria-hidden />
            ) : f.mime.startsWith('image/') ? (
              <Icons.photo className='size-4 shrink-0' aria-hidden />
            ) : (
              <Icons.page className='size-4 shrink-0' aria-hidden />
            )}
            <span className='truncate'>{f.name}</span>
            {typeof f.size === 'number' && (
              <span className='text-muted-foreground shrink-0 text-xs'>
                {f.size >= 1048576
                  ? `${(f.size / 1048576).toFixed(1)} MB`
                  : `${Math.max(1, Math.round(f.size / 1024))} KB`}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
