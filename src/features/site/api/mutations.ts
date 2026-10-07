'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type { CollectionDef } from '../config/collections';
import { siteKeys } from './queries';
import {
  SiteServiceError,
  createCollectionItem,
  deleteCollectionItem,
  deleteMedia,
  saveSetting,
  updateAppointment,
  updateCollectionItem,
  updateContentBlock,
  updateSubmission,
  updateWaitlistEntry,
  uploadMedia,
  type SiteScope
} from './service';
import type { AppointmentStatus, MediaItem, SubmissionStatus, WaitlistStatus } from './types';

function errorToast(error: unknown) {
  toast.error(error instanceof SiteServiceError ? error.message : 'Une erreur est survenue.');
}

/** Mutations for one website; every success refreshes that website's queries. */
export function useSiteMutations(scope: SiteScope) {
  const queryClient = useQueryClient();
  const db = createClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: siteKeys.website(scope.websiteId) });
  const common = { onSuccess: invalidate, onError: errorToast };

  return {
    saveItem: useMutation({
      mutationFn: ({
        def,
        id,
        values
      }: {
        def: CollectionDef;
        id?: string;
        values: Record<string, unknown>;
      }) =>
        id
          ? updateCollectionItem(db, def, id, values)
          : createCollectionItem(db, def, scope, values),
      ...common
    }),
    deleteItem: useMutation({
      mutationFn: ({ def, id }: { def: CollectionDef; id: string }) =>
        deleteCollectionItem(db, def, id),
      ...common
    }),
    updateAppointment: useMutation({
      mutationFn: ({
        id,
        patch
      }: {
        id: string;
        patch: { status?: AppointmentStatus; staff_notes?: string | null };
      }) => updateAppointment(db, id, patch),
      ...common
    }),
    updateWaitlist: useMutation({
      mutationFn: ({ id, status }: { id: string; status: WaitlistStatus }) =>
        updateWaitlistEntry(db, id, status),
      ...common
    }),
    updateSubmission: useMutation({
      mutationFn: ({
        id,
        patch
      }: {
        id: string;
        patch: { status?: SubmissionStatus; staff_notes?: string | null };
      }) => updateSubmission(db, id, patch),
      ...common
    }),
    uploadMedia: useMutation({
      mutationFn: ({ file, altText }: { file: File; altText?: string }) =>
        uploadMedia(db, scope, file, altText),
      ...common
    }),
    deleteMedia: useMutation({
      mutationFn: (item: Pick<MediaItem, 'id' | 'storage_path'>) => deleteMedia(db, item),
      ...common
    }),
    saveSetting: useMutation({
      mutationFn: ({ key, value }: { key: string; value: unknown }) =>
        saveSetting(db, scope, key, value),
      ...common
    }),
    updateBlock: useMutation({
      mutationFn: ({
        id,
        patch
      }: {
        id: string;
        patch: { data?: Record<string, unknown>; status?: string };
      }) => updateContentBlock(db, id, patch),
      ...common
    })
  };
}
