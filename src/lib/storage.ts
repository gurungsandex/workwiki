import { createHash, randomBytes } from 'node:crypto';
import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@/env';

/**
 * Files are never public. They are stored under random keys and served only
 * through the access-checked route, which issues a short-lived signed URL.
 */

let client: S3Client | null = null;

export function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    });
  }
  return client;
}

/** Accepted uploads. The type is sniffed from the bytes, never the extension. */
export const ACCEPTED_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/csv',
  'text/markdown',
]);

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const MAGIC: [string, number[]][] = [
  ['application/pdf', [0x25, 0x50, 0x44, 0x46]],
  ['image/png', [0x89, 0x50, 0x4e, 0x47]],
  ['image/jpeg', [0xff, 0xd8, 0xff]],
];

/**
 * Sniff the content type from the leading bytes. Office formats are ZIPs, so a
 * ZIP magic number is resolved by the declared type — but only to one of the
 * ZIP-based types we accept, never to whatever the client claimed.
 */
export function sniffContentType(bytes: Uint8Array, declared: string): string | null {
  for (const [type, magic] of MAGIC) {
    if (magic.every((byte, i) => bytes[i] === byte)) return type;
  }
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip) {
    const zipBased = new Set([
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ]);
    return zipBased.has(declared) ? declared : null;
  }
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) return 'image/webp';
  // Plain text: no magic number exists, so accept only if it decodes cleanly.
  if (declared.startsWith('text/')) {
    const sample = bytes.subarray(0, 512);
    if (!sample.includes(0)) return declared === 'text/markdown' ? 'text/markdown' : declared;
  }
  return null;
}

export function newStorageKey(): string {
  const now = new Date();
  return `uploads/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomBytes(24).toString('hex')}`;
}

export interface StoredObject {
  storageKey: string;
  contentType: string;
  byteSize: number;
  sha256: string;
}

export async function putObject(bytes: Uint8Array, contentType: string): Promise<StoredObject> {
  const storageKey = newStorageKey();
  await s3().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: storageKey,
      Body: bytes,
      ContentType: contentType,
      // Never inline: a stored document is downloaded or rendered in the
      // sandboxed viewer, never executed in this origin.
      ContentDisposition: 'attachment',
    }),
  );
  return {
    storageKey,
    contentType,
    byteSize: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

/** Short-lived, single-purpose URL. Issued only after an access check. */
export async function signedReadUrl(storageKey: string, filename: string, seconds = 120): Promise<string> {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: storageKey,
      ResponseContentDisposition: `attachment; filename="${filename.replace(/["\\\r\n]/g, '')}"`,
    }),
    { expiresIn: seconds },
  );
}

export async function storageReachable(): Promise<boolean> {
  try {
    await s3().send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    return true;
  } catch {
    return false;
  }
}
