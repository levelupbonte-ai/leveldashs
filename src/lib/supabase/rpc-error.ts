import { AppError, isMfaError } from '@/lib/errors';

interface DbError {
  message: string;
  code?: string;
}

/**
 * Maps a Supabase / PostgREST error to an `AppError` code. The raw database
 * message never reaches the screen (see docs/i18n.md).
 */
export function toAppError(error: DbError | null): AppError {
  const code = error?.code;
  if (isMfaError(error)) return new AppError('mfaRequired', { cause: error });
  if (code === '42501' || code === 'PGRST301' || code === 'PT403' || code === 'PT401') {
    return new AppError('forbidden', { cause: error });
  }
  if (code === 'PT404') return new AppError('notFound', { cause: error });
  if (code === 'PT409') return new AppError('tooManyKeys', { cause: error });
  if (code === 'PT429') return new AppError('rateLimited', { cause: error });
  if (code === 'PT423') return new AppError('contractRequired', { cause: error });
  if (code === '23514' || code === '22023') return new AppError('invalidValues', { cause: error });
  // Function not deployed yet (migration pending) or schema cache not reloaded.
  if (code === 'PGRST202' || code === '42883') return new AppError('notReady', { cause: error });
  return new AppError('generic', { cause: error });
}

/** Calls an RPC and returns its data, or throws an `AppError`. */
export async function rpc<T>(
  call: PromiseLike<{ data: unknown; error: DbError | null }>
): Promise<T> {
  const { data, error } = await call;
  if (error) throw toAppError(error);
  return data as T;
}
