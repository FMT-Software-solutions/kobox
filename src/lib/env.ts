import { z } from 'zod';

/**
 * Environment access, validated once at startup.
 *
 * Expo inlines `EXPO_PUBLIC_*` variables at build time, but only when they are
 * referenced as complete static property accesses — `process.env.EXPO_PUBLIC_FOO`
 * works, `process.env[name]` does not. That is why each variable is spelled out.
 *
 * Validating here means a missing or malformed value fails loudly on launch with
 * a useful message, instead of surfacing later as a confusing network error.
 */
const envSchema = z.object({
  supabaseUrl: z.string().url('EXPO_PUBLIC_SUPABASE_URL must be a valid URL'),
  supabaseKey: z.string().min(1, 'EXPO_PUBLIC_SUPABASE_KEY is required'),
  backendUrl: z.string().url('EXPO_PUBLIC_BACKEND_URL must be a valid URL'),
});

const parsed = envSchema.safeParse({
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  supabaseKey: process.env.EXPO_PUBLIC_SUPABASE_KEY,
  /**
   * fmt-ss-backend, which owns SMS sending and credit purchases.
   *
   * The fallback is PRODUCTION, never localhost, and that is not laziness. The
   * value is baked in at build time from a gitignored `.env`, so a build from a
   * clean checkout or a second machine sees nothing here. Print Suite Pro
   * shipped v1.2.0 with `localhost:3001` compiled in and every SMS and purchase
   * in it failed against a server on the customer's own laptop. A wrong
   * production URL fails loudly; a localhost one fails silently and only for
   * other people.
   */
  backendUrl: process.env.EXPO_PUBLIC_BACKEND_URL ?? 'https://api.fmtsoftware.com/api',
});

if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `  • ${issue.message}`).join('\n');
  throw new Error(
    `Kobox is missing required environment variables:\n${details}\n\n` +
      'Copy .env.example to .env and fill in the values from your Supabase project settings.'
  );
}

export const env = parsed.data;
