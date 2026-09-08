/**
 * Runs once, when the server starts, before it listens.
 *
 * This is where the whole environment is validated: a missing or malformed
 * variable exits here, naming the variable, the shape expected and an example.
 * Individual modules ask for only what they use — the migration runner needs a
 * database URL and nothing else — so this is the one place that insists on all
 * of it, and it is the right place, because it is the moment a *server* starts.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { loadEnv, exitOnConfigError } = await import('./env');
  try {
    loadEnv();
  } catch (error) {
    exitOnConfigError(error);
  }
}
