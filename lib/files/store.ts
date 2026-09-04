import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash, randomBytes } from 'node:crypto';
import { env } from '@/lib/env';

let client: S3Client | null = null;
function s3(): S3Client {
  if (!client) {
    const e = env();
    client = new S3Client({
      region: e.S3_REGION,
      endpoint: e.S3_ENDPOINT,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: e.S3_ACCESS_KEY_ID,
        secretAccessKey: e.S3_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

export async function storageReady(): Promise<boolean> {
  await s3().send(new HeadBucketCommand({ Bucket: env().S3_BUCKET }));
  return true;
}

/** Random key: a storage key never encodes a filename or a guessable id. */
export function newStorageKey(extension: string): string {
  const safe = extension.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  return `${randomBytes(24).toString('hex')}${safe ? `.${safe}` : ''}`;
}

export async function putObject(key: string, body: Buffer, contentType: string) {
  await s3().send(
    new PutObjectCommand({
      Bucket: env().S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      // Force a download rather than letting the browser render an upload
      // in our origin; the viewer route re-serves what it should inline.
      ContentDisposition: 'attachment',
    }),
  );
}

/** Short-lived signed URL. The bucket itself is never public. */
export async function signedGetUrl(key: string, seconds = 60): Promise<string> {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: env().S3_BUCKET, Key: key }),
    { expiresIn: seconds },
  );
}

export function sha256(buf: Buffer): Buffer {
  return createHash('sha256').update(buf).digest();
}
