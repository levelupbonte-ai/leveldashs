import 'server-only';
import { DeleteObjectsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Cloudflare R2 (S3-compatible), server side only. The key lives in Vercel
 * Sensitive variables (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 * R2_BUCKET) and never reaches the browser: the browser only gets short-lived
 * URLs signed for one exact path, type and size.
 */
const ACCOUNT = process.env.R2_ACCOUNT_ID ?? '';
const KEY_ID = process.env.R2_ACCESS_KEY_ID ?? '';
const SECRET = process.env.R2_SECRET_ACCESS_KEY ?? '';
const BUCKET = process.env.R2_BUCKET ?? '';

export const PUT_URL_SECONDS = 300;

export function isR2Configured(): boolean {
  return /^[0-9a-f]{32}$/.test(ACCOUNT) && !!KEY_ID && !!SECRET && !!BUCKET;
}

let client: S3Client | null = null;
function r2(): S3Client {
  client ??= new S3Client({
    region: 'auto',
    endpoint: `https://${ACCOUNT}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: KEY_ID, secretAccessKey: SECRET }
  });
  return client;
}

/** PUT URL valid 5 minutes for exactly this object, type and size. */
export function presignPut(
  key: string,
  contentType: string,
  contentLength: number
): Promise<string> {
  return getSignedUrl(
    r2(),
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength
    }),
    {
      expiresIn: PUT_URL_SECONDS,
      signableHeaders: new Set(['content-type', 'content-length'])
    }
  );
}

/** Deletes objects (best effort: failures are logged, never shown). */
export async function deleteObjects(keys: string[]): Promise<void> {
  const list = keys.filter(Boolean);
  if (!list.length) return;
  try {
    await r2().send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: list.map((Key) => ({ Key })), Quiet: true }
      })
    );
  } catch (error) {
    console.error('r2.delete_failed', { count: list.length, name: (error as Error)?.name });
  }
}
