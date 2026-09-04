import { fileTypeFromBuffer } from 'file-type';

/**
 * Upload safety (spec §11): type is SNIFFED from content, never trusted from
 * the extension; size is capped; anything not on the allow-list is refused.
 */

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const ALLOWED = new Map<string, string>([
  ['application/pdf', 'pdf'],
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
]);

/** Text formats have no magic bytes, so they are matched on declared type. */
const ALLOWED_TEXT = new Map<string, string>([
  ['text/plain', 'txt'],
  ['text/markdown', 'md'],
  ['text/csv', 'csv'],
]);

export type SniffResult =
  | { ok: true; mimeType: string; extension: string; isImage: boolean }
  | { ok: false; error: string };

export async function sniffUpload(
  buffer: Buffer,
  declaredType: string,
): Promise<SniffResult> {
  if (buffer.byteLength === 0) return { ok: false, error: 'That file is empty.' };
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `That file is larger than ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`,
    };
  }

  const sniffed = await fileTypeFromBuffer(buffer);

  if (sniffed) {
    const ext = ALLOWED.get(sniffed.mime);
    if (!ext) {
      return {
        ok: false,
        error: `That looks like a ${sniffed.mime} file, which this platform does not accept.`,
      };
    }
    return {
      ok: true,
      mimeType: sniffed.mime,
      extension: ext,
      isImage: sniffed.mime.startsWith('image/'),
    };
  }

  // No magic bytes: only plain-text formats may pass, and only if they really
  // are text — a mislabelled binary is refused.
  const base = declaredType.split(';')[0]!.trim().toLowerCase();
  const textExt = ALLOWED_TEXT.get(base);
  if (textExt && looksLikeText(buffer)) {
    return { ok: true, mimeType: base, extension: textExt, isImage: false };
  }

  return {
    ok: false,
    error: 'This platform could not tell what kind of file that is, so it was refused.',
  };
}

function looksLikeText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 4096);
  for (const byte of sample) {
    // NUL or a C0 control that is not tab/LF/CR means it is not text.
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) return false;
  }
  return true;
}
