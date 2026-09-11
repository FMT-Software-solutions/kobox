// Deletes the caller's own account.
//
// Two halves, and the order matters:
//
//   1. AS THE USER: `prepare_account_deletion()` refuses if they are the only
//      owner of a group other people use, deletes groups nobody else can open,
//      and withdraws their pending join requests. It must run with the user's
//      token — the owner checks inside it read `auth.uid()`.
//   2. AS THE SERVICE ROLE: remove their avatar files and the auth user. The
//      database cascades or unlinks everything else (see the migration
//      `20260911050000_account_deletion.sql` for what stays and why).
//
// Called from the app and from kobox.fmtsoftware.com/delete-account, so it
// answers CORS preflights. JWT verification is left ON at the gateway: an
// unauthenticated request never reaches this code.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) {
    console.error('[delete-account] missing SUPABASE_URL, ANON_KEY or SERVICE_ROLE_KEY');
    return json({ error: 'The server is not configured to delete accounts.' }, 500);
  }

  const authorization = req.headers.get('Authorization');
  if (!authorization) return json({ error: 'Sign in first.' }, 401);

  // A client that acts as the caller, so RLS and auth.uid() see the real person.
  const asUser = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const {
    data: { user },
    error: userError,
  } = await asUser.auth.getUser();
  if (userError || !user) return json({ error: 'Sign in first.' }, 401);

  const { data: summary, error: prepareError } = await asUser.rpc('prepare_account_deletion');
  if (prepareError) {
    // The only expected refusal is "you are the only owner of …", which is a
    // sentence written for the person reading it.
    return json({ error: prepareError.message }, 409);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Best effort. A photo left behind is not worth failing the deletion over —
  // but it is somebody's face, so it is not skipped either.
  try {
    const { data: files } = await admin.storage.from('avatars').list(user.id);
    if (files && files.length > 0) {
      await admin.storage.from('avatars').remove(files.map((file) => `${user.id}/${file.name}`));
    }
  } catch (err) {
    console.error(`[delete-account] could not remove avatars for ${user.id}`, err);
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error(`[delete-account] deleteUser failed for ${user.id}`, deleteError.message);
    return json({ error: 'Your account could not be deleted. Please try again.' }, 500);
  }

  console.log(`[delete-account] deleted ${user.id}`);
  return json({ deleted: true, groupsDeleted: summary?.deleting ?? [] });
});
