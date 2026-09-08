import { NextResponse } from 'next/server';
import { env } from '@/env';

export const dynamic = 'force-dynamic';

/** Liveness. No content, and no version disclosure beyond a build id. */
export function GET() {
  return NextResponse.json({ status: 'ok', build: env.BUILD_ID }, { headers: { 'cache-control': 'no-store' } });
}
