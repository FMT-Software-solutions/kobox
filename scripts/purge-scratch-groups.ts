/*
 * One-off cleanup for the groups the ledger checks stranded.
 *
 * `after()` in scripts/ledger-check.ts called `groups.delete()` and discarded
 * the error for the whole life of that file. `payments.member_id` is ON DELETE
 * RESTRICT and the append-only triggers refuse the cascade, so every run left
 * roughly fifty `Ledger — …` groups behind. 609 had accumulated by 5 Sep 2026.
 *
 * The teardown now uses `delete_group_cascade` and asserts, so this is only
 * needed for the backlog — but it is kept rather than thrown away, because the
 * same command is the honest way to answer "did that actually clear?".
 *
 *   node --env-file=.env scripts/purge-scratch-groups.ts          # dry run
 *   node --env-file=.env scripts/purge-scratch-groups.ts --delete
 *
 * Only groups whose name starts with the scratch prefix are ever touched, and
 * only ones the test account owns — RLS and `delete_group_cascade`'s own
 * owner check both enforce that independently of this script.
 */

import { createClient } from '@supabase/supabase-js';

import type { Database } from '../src/lib/database.types.ts';

const PREFIX = 'Ledger — ';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;
const email = process.env.KOBOX_TEST_EMAIL;
const password = process.env.KOBOX_TEST_PASSWORD;

if (!url || !key || !email || !password) {
  throw new Error('Set EXPO_PUBLIC_SUPABASE_URL/KEY and KOBOX_TEST_EMAIL/PASSWORD in .env');
}

const commit = process.argv.includes('--delete');
const supabase = createClient<Database>(url, key);

const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
if (signInError) throw signInError;

const { data, error } = await supabase
  .from('groups')
  .select('id, name')
  .like('name', `${PREFIX}%`)
  .order('created_at');

if (error) throw error;

const targets = data ?? [];
console.log(`${targets.length} scratch group(s) found.`);

if (!commit) {
  console.log('Dry run — pass --delete to remove them.');
  await supabase.auth.signOut();
  process.exit(0);
}

let deleted = 0;
const failures: string[] = [];

for (const group of targets) {
  const { error: deleteError } = await supabase.rpc('delete_group_cascade', {
    p_group_id: group.id,
  });

  if (deleteError) {
    failures.push(`${group.id} (${group.name}): ${deleteError.message}`);
  } else {
    deleted += 1;
    if (deleted % 25 === 0) console.log(`  …${deleted}/${targets.length}`);
  }
}

await supabase.auth.signOut();

console.log(`Deleted ${deleted} of ${targets.length}.`);
if (failures.length > 0) {
  console.error(`\n${failures.length} could not be deleted:`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
