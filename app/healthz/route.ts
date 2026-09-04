export const dynamic = 'force-dynamic';

/** Liveness. No content, no version disclosure beyond a build id (spec §9). */
export function GET() {
  return Response.json(
    { status: 'ok', build: process.env.BUILD_ID ?? 'dev' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
