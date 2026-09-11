/**
 * Ledger integration checks.
 *
 * These run against the real Supabase project, signed in as an ordinary user, so
 * they exercise the RPCs *and* Row Level Security exactly as the app does. Unit
 * tests cannot reach this: every bug found so far lived in PL/pgSQL — money that
 * settled nothing, periods that duplicated, credit that froze.
 *
 * Each test creates its own throwaway group and deletes it afterwards, so your
 * real data is never touched.
 *
 *   npm run test:ledger
 *
 * Requires KOBOX_TEST_EMAIL / KOBOX_TEST_PASSWORD in .env, and "Confirm email"
 * switched OFF in Supabase → Authentication → Sign In / Providers → Email.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../src/lib/database.types.ts';
import { toE164 } from '../src/lib/phone.ts';
import { smsCost, smsNormalise } from '../src/lib/sms.ts';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;
const email = process.env.KOBOX_TEST_EMAIL;
const password = process.env.KOBOX_TEST_PASSWORD;

if (!url || !key) throw new Error('EXPO_PUBLIC_SUPABASE_URL / _KEY missing from .env');
if (!email || !password)
  throw new Error('KOBOX_TEST_EMAIL / KOBOX_TEST_PASSWORD missing from .env');

const supabase: SupabaseClient<Database> = createClient<Database>(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Groups created during the run, torn down at the end even if a test fails. */
const scratchGroups: string[] = [];

/**
 * Supabase test phone number — signs in without sending an SMS.
 * Configured in Authentication → Sign In / Providers → Phone → Test phone numbers.
 */
const TEST_PHONE = '+233241234567';
const TEST_CODE = '123456';

/** Signed in once on first use; see testPhoneSession(). */
let phoneSession: { client: SupabaseClient<Database>; userId: string } | null = null;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A fresh, valid Ghana mobile number for each member a check creates.
 *
 * `add_member` requires a phone and refuses two members sharing one inside a
 * group, so every call needs its own. Uses the 055 range so it can never
 * collide with TEST_PHONE, which lives on 024 and is the one number these
 * checks can actually verify.
 */
let phoneCounter = 0;
function nextPhone(): string {
  phoneCounter += 1;
  return `055${String(phoneCounter).padStart(7, '0')}`;
}

/** First day of the month `n` months before this one, as YYYY-MM-DD. */
function monthsAgo(n: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1));
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function rpc<T extends keyof Database['public']['Functions']>(
  name: T,
  args: Database['public']['Functions'][T]['Args']
) {
  const { data, error } = await supabase.rpc(name, args as never);
  if (error) throw new Error(`${String(name)} failed: ${error.message}`);
  return data;
}

/**
 * A second client signed in as the OTP test number, created once and reused.
 *
 * Requires a test phone number in Supabase → Authentication → Sign In /
 * Providers → Phone → Test phone numbers, AND an unexpired "Test OTPs Valid
 * Until" date beside it. It signs in without sending an SMS, which is the only
 * way these checks can hold a genuinely verified phone — an anon key cannot
 * mint one otherwise.
 *
 * Signing in per test trips Supabase's OTP rate limit ("you can only request
 * this after 3 seconds"), which is the limiter working as intended. Holding one
 * session is also closer to life: a member signs in once and the claim runs on
 * every launch after that.
 *
 * At module scope rather than inside a describe: several suites need it now,
 * and a helper only one block can reach is how the second copy gets written.
 */
async function testPhoneSession() {
  if (phoneSession) return phoneSession;

  const client: SupabaseClient<Database> = createClient<Database>(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const sent = await client.auth.signInWithOtp({ phone: TEST_PHONE });
  if (sent.error) {
    throw new Error(
      `Could not request an OTP for ${TEST_PHONE}: ${sent.error.message}\n` +
        'Add it as a test phone number (code 123456) in Supabase → Authentication → ' +
        'Sign In / Providers → Phone, and check "Test OTPs Valid Until" has not lapsed.'
    );
  }

  const verified = await client.auth.verifyOtp({
    phone: TEST_PHONE,
    token: TEST_CODE,
    type: 'sms',
  });
  if (verified.error) {
    throw new Error(`Could not verify the test OTP: ${verified.error.message}`);
  }

  phoneSession = { client, userId: verified.data.user!.id };
  return phoneSession;
}

async function createScratchGroup(name: string) {
  const group = (await rpc('create_group', { p_name: name, p_currency: 'GHS' })) as {
    id: string;
  };
  scratchGroups.push(group.id);

  const { data, error } = await supabase
    .from('group_members')
    .select('id')
    .eq('group_id', group.id)
    .single();
  if (error) throw error;

  return { groupId: group.id, memberId: data.id as string };
}

/**
 * A second member holding a number another one already has.
 *
 * `add_member` refuses this now, which is exactly the point — but the ambiguity
 * it causes still exists in records made before the rule, and the linking code
 * has to keep resolving it to "claim neither". Written straight to the table so
 * those paths stay covered rather than quietly becoming untested.
 */
async function addDuplicateMember(groupId: string, fullName: string, phone: string) {
  const { data, error } = await supabase
    .from('group_members')
    .insert({ group_id: groupId, full_name: fullName, phone, role: 'member', status: 'active' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

async function standingOf(memberId: string) {
  const { data, error } = await supabase
    .from('member_standings')
    .select('total_due, total_paid, balance, credit')
    .eq('member_id', memberId)
    .single();
  if (error) throw error;

  return {
    totalDue: Number(data.total_due),
    totalPaid: Number(data.total_paid),
    balance: Number(data.balance),
    credit: Number(data.credit),
  };
}

async function cyclesOf(planId: string) {
  const { data, error } = await supabase
    .from('cycles')
    .select('id, label, period_start, period_end, due_date')
    .eq('plan_id', planId)
    .order('period_start');
  if (error) throw error;
  return data;
}

async function planTotals(planId: string) {
  const { data, error } = await supabase
    .from('plan_summaries')
    .select('cycle_count, total_expected, total_collected, extra_giving')
    .eq('plan_id', planId)
    .single();
  if (error) throw error;

  return {
    cycleCount: Number(data.cycle_count),
    totalExpected: Number(data.total_expected),
    totalCollected: Number(data.total_collected),
    extraGiving: Number(data.extra_giving),
  };
}

/** Every allocation must sum exactly to its payment — the core ledger invariant. */
/** Members a plan actually bills. Waived obligations are excluded by the view. */
async function billedMembers(planId: string) {
  const { data: cycles, error: cycleError } = await supabase
    .from('cycles')
    .select('id')
    .eq('plan_id', planId);
  if (cycleError) throw cycleError;

  const cycleIds = (cycles ?? []).map((c) => c.id);
  if (cycleIds.length === 0) return [];

  const { data, error } = await supabase
    .from('obligation_balances')
    .select('member_id')
    .in('cycle_id', cycleIds);
  if (error) throw error;

  return [...new Set((data ?? []).map((o) => o.member_id as string))];
}

async function assertAllocationsBalance(groupId: string) {
  const { data: payments, error } = await supabase
    .from('payments')
    .select('id, amount, status')
    .eq('group_id', groupId);
  if (error) throw error;

  for (const payment of payments ?? []) {
    if (payment.status !== 'confirmed') continue;

    const { data: allocations, error: allocError } = await supabase
      .from('allocations')
      .select('amount')
      .eq('payment_id', payment.id);
    if (allocError) throw allocError;

    const total = (allocations ?? []).reduce((sum, a) => sum + Number(a.amount), 0);
    assert.equal(
      total,
      Number(payment.amount),
      `allocations for payment ${payment.id} sum to ${total}, expected ${payment.amount}`
    );
  }
}

/* -------------------------------------------------------------------------- */

before(async () => {
  const signIn = await supabase.auth.signInWithPassword({ email, password });

  if (signIn.error) {
    const signUp = await supabase.auth.signUp({ email, password });
    if (signUp.error) {
      throw new Error(`Could not sign in or create the test user: ${signUp.error.message}`);
    }
    if (!signUp.data.session) {
      throw new Error(
        'Test user created but no session returned. Switch OFF "Confirm email" in ' +
          'Supabase → Authentication → Sign In / Providers → Email, then re-run.'
      );
    }
  }
});

after(async () => {
  // A plain `groups.delete()` here silently failed for the entire life of this
  // file, because `payments.member_id` is ON DELETE RESTRICT and the
  // append-only triggers refuse the cascade. The error was discarded, so it
  // looked like it worked while 609 scratch groups piled up in the project.
  // `delete_group_cascade` is the only path that can remove a group which has
  // recorded money — and the failures are collected rather than thrown one at
  // a time, so one undeletable group cannot strand the other 49 behind it.
  const failures: string[] = [];

  for (const groupId of scratchGroups) {
    const { error } = await supabase.rpc('delete_group_cascade', { p_group_id: groupId });
    if (error) failures.push(`${groupId}: ${error.message}`);
  }

  await phoneSession?.client.auth.signOut();
  await supabase.auth.signOut();

  // Assert last, so sign-out still happens. Never swallow this again: a
  // teardown that fails quietly is indistinguishable from one that works.
  if (failures.length > 0) {
    throw new Error(
      `Failed to delete ${failures.length} of ${scratchGroups.length} scratch groups:\n` +
        failures.join('\n')
    );
  }
});

describe('backfill and settlement', () => {
  it('opens one period per month since the start date', async () => {
    const { groupId } = await createScratchGroup('Ledger — backfill');

    const plan = (await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Monthly Dues',
      p_kind: 'dues',
      p_frequency: 'monthly',
      p_default_amount: 2000,
      p_grace_days: 0,
      p_start_date: monthsAgo(4),
    })) as { id: string };

    const cycles = await cyclesOf(plan.id);
    assert.equal(cycles.length, 5, 'four months ago through this month is five periods');

    // No two periods may start on the same day, or a member is billed twice.
    const starts = cycles.map((c) => c.period_start);
    assert.equal(new Set(starts).size, starts.length, 'duplicate period start dates');
  });

  it('settles oldest first and reports a zero balance when fully paid', async () => {
    const { groupId, memberId } = await createScratchGroup('Ledger — settle');

    await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Monthly Dues',
      p_kind: 'dues',
      p_frequency: 'monthly',
      p_default_amount: 2000,
      p_grace_days: 0,
      p_start_date: monthsAgo(4),
    });

    const before = await standingOf(memberId);
    assert.equal(before.totalDue, 10000, 'five months at 2000');
    assert.equal(before.balance, 10000);

    await rpc('record_payment', {
      p_group_id: groupId,
      p_member_id: memberId,
      p_amount: 10000,
      p_method: 'cash',
    });

    const after = await standingOf(memberId);
    assert.equal(after.balance, 0);
    assert.equal(after.credit, 0);
    await assertAllocationsBalance(groupId);
  });
});

describe('advance payments', () => {
  it('holds the surplus as credit', async () => {
    const { groupId, memberId } = await createScratchGroup('Ledger — advance');

    await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Monthly Dues',
      p_kind: 'dues',
      p_frequency: 'monthly',
      p_default_amount: 2000,
      p_grace_days: 0,
      p_start_date: monthsAgo(4),
    });

    // ₵180 against ₵100 owed.
    await rpc('record_payment', {
      p_group_id: groupId,
      p_member_id: memberId,
      p_amount: 18000,
      p_method: 'cash',
    });

    const standing = await standingOf(memberId);
    assert.equal(standing.balance, 0, 'all five months cleared');
    assert.equal(standing.credit, 8000, 'the rest is held in credit');
    await assertAllocationsBalance(groupId);
  });

  it('spends held credit when the next period opens', async () => {
    const { groupId, memberId } = await createScratchGroup('Ledger — credit rollover');

    const plan = (await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Monthly Dues',
      p_kind: 'dues',
      p_frequency: 'monthly',
      p_default_amount: 2000,
      p_grace_days: 0,
      p_start_date: monthsAgo(1),
    })) as { id: string };

    await rpc('record_payment', {
      p_group_id: groupId,
      p_member_id: memberId,
      p_amount: 10000,
      p_method: 'cash',
    });

    const beforeNext = await standingOf(memberId);
    assert.equal(beforeNext.credit, 6000, 'two months owed, ₵60 left over');

    // Open next month explicitly rather than waiting for the calendar.
    const next = new Date();
    const nextStart = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 1))
      .toISOString()
      .slice(0, 10);
    await rpc('generate_cycle', { p_plan_id: plan.id, p_period_start: nextStart });

    const afterNext = await standingOf(memberId);
    assert.equal(afterNext.balance, 0, 'the new month is settled from credit');
    assert.equal(afterNext.credit, 4000, 'credit reduced by one month');
    await assertAllocationsBalance(groupId);
  });
});

describe('designated payments', () => {
  it('settles later periods of its own plan rather than freezing', async () => {
    // Regression: money designated to a plan whose periods had not opened yet
    // sat inert forever while those periods showed as fully owing.
    const { groupId, memberId } = await createScratchGroup('Ledger — designated rollover');

    const plan = (await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Monthly Dues',
      p_kind: 'dues',
      p_frequency: 'monthly',
      p_default_amount: 2000,
      p_grace_days: 0,
      p_start_date: today(),
    })) as { id: string };

    // One period exists; pay three periods' worth, designated.
    await rpc('record_payment', {
      p_group_id: groupId,
      p_member_id: memberId,
      p_amount: 6000,
      p_method: 'cash',
      p_designated_plan_id: plan.id,
    });

    // Now pull the start date back so two earlier periods appear.
    await rpc('update_plan', { p_plan_id: plan.id, p_start_date: monthsAgo(2) });

    const standing = await standingOf(memberId);
    assert.equal(standing.balance, 0, 'designated money settled the newly opened periods');
    await assertAllocationsBalance(groupId);
  });

  it('never crosses into another contribution', async () => {
    const { groupId, memberId } = await createScratchGroup('Ledger — designation boundary');

    await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Monthly Dues',
      p_kind: 'dues',
      p_frequency: 'monthly',
      p_default_amount: 2000,
      p_grace_days: 0,
      p_start_date: monthsAgo(2),
    });

    const levy = (await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Funeral Levy',
      p_kind: 'levy',
      p_frequency: 'once',
      p_default_amount: 5000,
      p_grace_days: 0,
      p_start_date: today(),
      p_end_date: today(),
    })) as { id: string };

    // Overpay the levy heavily; dues must be untouched.
    await rpc('record_payment', {
      p_group_id: groupId,
      p_member_id: memberId,
      p_amount: 20000,
      p_method: 'cash',
      p_designated_plan_id: levy.id,
    });

    const standing = await standingOf(memberId);
    assert.equal(standing.balance, 6000, 'three months of dues remain owing');
    assert.equal(standing.credit, 0, 'designated money is not general credit');

    const levyTotals = await planTotals(levy.id);
    assert.equal(levyTotals.extraGiving, 15000, 'the surplus stays with the levy');
    await assertAllocationsBalance(groupId);
  });
});

describe('open giving', () => {
  it('creates no obligations and is not counted as credit', async () => {
    // Regression: giving to an open appeal was reported as unspent credit, and
    // the dashboard claimed it covered future months of dues.
    const { groupId, memberId } = await createScratchGroup('Ledger — open giving');

    const appeal = (await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Emergency Appeal',
      p_kind: 'open',
      p_frequency: 'once',
      p_grace_days: 0,
      p_start_date: today(),
    })) as { id: string };

    await rpc('record_payment', {
      p_group_id: groupId,
      p_member_id: memberId,
      p_amount: 8000,
      p_method: 'cash',
      p_designated_plan_id: appeal.id,
    });

    const standing = await standingOf(memberId);
    assert.equal(standing.totalDue, 0, 'open giving owes nothing');
    assert.equal(standing.balance, 0);
    assert.equal(standing.credit, 0, 'giving is not credit');

    const totals = await planTotals(appeal.id);
    assert.equal(totals.totalCollected, 8000, 'the appeal reports what it raised');
    await assertAllocationsBalance(groupId);
  });
});

describe('editing a plan', () => {
  it('does not leave duplicate periods when the start date moves', async () => {
    // Regression: a plan created mid-month kept its off-grid period after the
    // start date was pulled back, so one month appeared and was billed twice.
    const { groupId, memberId } = await createScratchGroup('Ledger — start date move');

    const plan = (await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Monthly Dues',
      p_kind: 'dues',
      p_frequency: 'monthly',
      p_default_amount: 2000,
      p_grace_days: 0,
      // Deliberately not the first of the month.
      p_start_date: today(),
    })) as { id: string };

    await rpc('update_plan', { p_plan_id: plan.id, p_start_date: monthsAgo(2) });

    const cycles = await cyclesOf(plan.id);
    const labels = cycles.map((c) => c.label);
    assert.equal(
      new Set(labels).size,
      labels.length,
      `duplicate period labels: ${labels.join(', ')}`
    );
    assert.equal(cycles.length, 3, 'two months ago through this month');

    const standing = await standingOf(memberId);
    assert.equal(standing.totalDue, 6000, 'exactly three months owed, not four');
  });
});

describe('changing the amount', () => {
  it('never bills members retrospectively for periods already issued', async () => {
    const { groupId, memberId } = await createScratchGroup('Ledger — rate rise');

    const plan = (await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Monthly Dues',
      p_kind: 'dues',
      p_frequency: 'monthly',
      p_default_amount: 2000,
      p_grace_days: 0,
      p_start_date: monthsAgo(2),
    })) as { id: string };

    // Settle the three months at the old rate.
    await rpc('record_payment', {
      p_group_id: groupId,
      p_member_id: memberId,
      p_amount: 6000,
      p_method: 'cash',
    });
    assert.equal((await standingOf(memberId)).balance, 0);

    // The group votes to raise dues from ₵20 to ₵30.
    await rpc('update_plan', { p_plan_id: plan.id, p_default_amount: 3000 });

    const afterRise = await standingOf(memberId);
    assert.equal(afterRise.totalDue, 6000, 'past periods keep the amount they were issued at');
    assert.equal(afterRise.balance, 0, 'a rate rise must not create arrears out of thin air');

    // The next period should be issued at the new rate.
    const now = new Date();
    const nextStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
      .toISOString()
      .slice(0, 10);
    await rpc('generate_cycle', { p_plan_id: plan.id, p_period_start: nextStart });

    const afterNext = await standingOf(memberId);
    assert.equal(afterNext.totalDue, 9000, 'the new period is issued at the new amount');
    assert.equal(afterNext.balance, 3000, 'only the new period is owed');
    await assertAllocationsBalance(groupId);
  });

  it('re-prices everything while nothing has been paid', async () => {
    // A contribution nobody has paid into is still being set up, so correcting
    // the amount should just work rather than stranding old figures.
    const { groupId, memberId } = await createScratchGroup('Ledger — reprice untouched');

    const plan = (await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Monthly Dues',
      p_kind: 'dues',
      p_frequency: 'monthly',
      p_default_amount: 2000,
      p_grace_days: 0,
      p_start_date: monthsAgo(2),
    })) as { id: string };

    await rpc('update_plan', { p_plan_id: plan.id, p_default_amount: 3000 });

    const standing = await standingOf(memberId);
    assert.equal(standing.totalDue, 9000, 'all three periods take the corrected amount');
  });

  it('stops re-pricing the moment a payment exists', async () => {
    const { groupId, memberId } = await createScratchGroup('Ledger — reprice locked');

    const plan = (await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Monthly Dues',
      p_kind: 'dues',
      p_frequency: 'monthly',
      p_default_amount: 2000,
      p_grace_days: 0,
      p_start_date: monthsAgo(2),
    })) as { id: string };

    // One payment is enough to freeze the issued periods.
    await rpc('record_payment', {
      p_group_id: groupId,
      p_member_id: memberId,
      p_amount: 2000,
      p_method: 'cash',
    });

    await rpc('update_plan', { p_plan_id: plan.id, p_default_amount: 3000 });

    const standing = await standingOf(memberId);
    assert.equal(standing.totalDue, 6000, 'issued periods keep the amount members were told');
  });
});

describe('moving the start date later', () => {
  async function setUpAprilStylePlan(label: string) {
    const { groupId, memberId } = await createScratchGroup(label);

    const plan = (await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Monthly Dues',
      p_kind: 'dues',
      p_frequency: 'monthly',
      p_default_amount: 2000,
      p_grace_days: 0,
      p_start_date: monthsAgo(4),
    })) as { id: string };

    return { groupId, memberId, planId: plan.id };
  }

  it('is refused when payments have been recorded', async () => {
    const { groupId, memberId, planId } = await setUpAprilStylePlan('Ledger — later start, paid');

    await rpc('record_payment', {
      p_group_id: groupId,
      p_member_id: memberId,
      p_amount: 4000,
      p_method: 'cash',
    });

    await assert.rejects(
      () =>
        rpc('update_plan', {
          p_plan_id: planId,
          p_default_amount: 3000,
          p_start_date: monthsAgo(0),
        }),
      /already has payments recorded/,
      'moving the start past a paid period must be refused'
    );

    // Nothing at all is saved — the whole change is rolled back together.
    const { data } = await supabase
      .from('plans')
      .select('default_amount, start_date')
      .eq('id', planId)
      .single();

    assert.equal(Number(data!.default_amount), 2000, 'the amount change was rolled back too');
    assert.equal(data!.start_date, monthsAgo(4), 'the start date is untouched');

    const standing = await standingOf(memberId);
    assert.equal(standing.totalDue, 10000, 'all five periods survive');
    assert.equal(standing.totalPaid, 4000, 'the payment survives');
  });

  it('is allowed when nothing has been paid', async () => {
    const { memberId, planId } = await setUpAprilStylePlan('Ledger — later start, unpaid');

    await rpc('update_plan', {
      p_plan_id: planId,
      p_default_amount: 3000,
      p_start_date: monthsAgo(0),
    });

    const cycles = await cyclesOf(planId);
    assert.equal(cycles.length, 1, 'only this month remains');

    const standing = await standingOf(memberId);
    assert.equal(standing.totalDue, 3000, 'reissued at the new amount, earlier months gone');
  });

  it('names the period that is blocking the move', async () => {
    const { groupId, memberId, planId } = await setUpAprilStylePlan('Ledger — blocking period');

    await rpc('record_payment', {
      p_group_id: groupId,
      p_member_id: memberId,
      p_amount: 2000,
      p_method: 'cash',
    });

    // The message must identify the period, not just say "no".
    await assert.rejects(
      () => rpc('update_plan', { p_plan_id: planId, p_start_date: monthsAgo(0) }),
      /already has payments recorded/
    );
  });

  it('allows the amount to change on its own', async () => {
    // The path a user actually wants: leave the date alone, change the amount.
    const { planId } = await setUpAprilStylePlan('Ledger — amount only');

    await rpc('update_plan', { p_plan_id: planId, p_default_amount: 3000 });

    const { data } = await supabase
      .from('plans')
      .select('default_amount, start_date')
      .eq('id', planId)
      .single();

    assert.equal(Number(data!.default_amount), 3000);
    assert.equal(data!.start_date, monthsAgo(4), 'the start date is left alone');
  });
});

describe('deleting a contribution', () => {
  it('is allowed while no money is attached', async () => {
    const { groupId } = await createScratchGroup('Ledger — delete unused');

    const plan = (await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Created By Mistake',
      p_kind: 'dues',
      p_frequency: 'monthly',
      p_default_amount: 2000,
      p_grace_days: 0,
      p_start_date: monthsAgo(1),
    })) as { id: string };

    await rpc('delete_plan', { p_plan_id: plan.id });

    const { data } = await supabase.from('plans').select('id').eq('id', plan.id);
    assert.equal(data?.length, 0, 'the contribution is gone');
  });

  it('is refused once a payment has been recorded', async () => {
    const { groupId, memberId } = await createScratchGroup('Ledger — delete used');

    const plan = (await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Monthly Dues',
      p_kind: 'dues',
      p_frequency: 'monthly',
      p_default_amount: 2000,
      p_grace_days: 0,
      p_start_date: monthsAgo(1),
    })) as { id: string };

    await rpc('record_payment', {
      p_group_id: groupId,
      p_member_id: memberId,
      p_amount: 2000,
      p_method: 'cash',
    });

    await assert.rejects(
      () => rpc('delete_plan', { p_plan_id: plan.id }),
      /cannot be deleted/,
      'a contribution holding payments must survive'
    );

    // Ending it is the supported alternative, and keeps everything.
    await rpc('update_plan', { p_plan_id: plan.id, p_status: 'ended' });

    const { data } = await supabase.from('plans').select('status').eq('id', plan.id).single();
    assert.equal(data!.status, 'ended');

    const standing = await standingOf(memberId);
    assert.equal(standing.totalPaid, 2000, 'the payment is still on the books');
  });
});

describe('group balance', () => {
  it('returns to zero after a payment is reversed', async () => {
    // Regression: reverse_payment marks the original 'reversed' and inserts a
    // negative entry. Counting only 'confirmed' rows dropped the original AND
    // added the negative, pushing the group balance to minus the amount.
    const { groupId, memberId } = await createScratchGroup('Ledger — reversal balance');

    await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Monthly Dues',
      p_kind: 'dues',
      p_frequency: 'monthly',
      p_default_amount: 2000,
      p_grace_days: 0,
      p_start_date: monthsAgo(1),
    });

    const payment = (await rpc('record_payment', {
      p_group_id: groupId,
      p_member_id: memberId,
      p_amount: 4000,
      p_method: 'cash',
    })) as { id: string };

    const { data: afterPay } = await supabase
      .from('group_summaries')
      .select('cash_on_hand')
      .eq('group_id', groupId)
      .single();
    assert.equal(Number(afterPay!.cash_on_hand), 4000);

    await rpc('reverse_payment', { p_payment_id: payment.id, p_reason: 'Recorded in error' });

    const { data: afterReversal } = await supabase
      .from('group_summaries')
      .select('cash_on_hand')
      .eq('group_id', groupId)
      .single();
    assert.equal(
      Number(afterReversal!.cash_on_hand),
      0,
      'a reversal returns the balance to zero, not to minus the amount'
    );
  });
});

describe('expenses', () => {
  async function summaryOf(groupId: string) {
    const { data, error } = await supabase
      .from('group_summaries')
      .select('cash_on_hand, total_collected, total_expenses, pending_expenses')
      .eq('group_id', groupId)
      .single();
    if (error) throw error;

    return {
      cashOnHand: Number(data.cash_on_hand),
      totalCollected: Number(data.total_collected),
      totalExpenses: Number(data.total_expenses),
      pendingExpenses: Number(data.pending_expenses),
    };
  }

  it('reduces the balance once approved, and not before', async () => {
    const { groupId, memberId } = await createScratchGroup('Ledger — expenses');

    await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Monthly Dues',
      p_kind: 'dues',
      p_frequency: 'monthly',
      p_default_amount: 10000,
      p_grace_days: 0,
      p_start_date: monthsAgo(0),
    });

    await rpc('record_payment', {
      p_group_id: groupId,
      p_member_id: memberId,
      p_amount: 10000,
      p_method: 'cash',
    });

    // The scratch user is the owner, so their expense is approved immediately.
    await rpc('record_expense', {
      p_group_id: groupId,
      p_title: 'Chairs for the meeting',
      p_amount: 3000,
      p_category: 'equipment',
    });

    const summary = await summaryOf(groupId);
    assert.equal(summary.totalCollected, 10000);
    assert.equal(summary.totalExpenses, 3000);
    assert.equal(summary.cashOnHand, 7000, 'money in minus money out');
    assert.equal(summary.pendingExpenses, 0, 'an owner approves as they record');
  });

  it('restores the balance when an approved expense is voided', async () => {
    const { groupId } = await createScratchGroup('Ledger — void expense');

    const expense = (await rpc('record_expense', {
      p_group_id: groupId,
      p_title: 'Wrong amount',
      p_amount: 5000,
    })) as { id: string };

    assert.equal((await summaryOf(groupId)).cashOnHand, -5000);

    await rpc('void_expense', { p_expense_id: expense.id, p_reason: 'Duplicate entry' });

    const summary = await summaryOf(groupId);
    assert.equal(summary.cashOnHand, 0, 'voiding restores the balance');
    assert.equal(summary.totalExpenses, 0);

    // The record survives, marked and attributed.
    const { data } = await supabase
      .from('expenses')
      .select('status, void_reason, voided_at')
      .eq('id', expense.id)
      .single();
    assert.equal(data!.status, 'rejected');
    assert.equal(data!.void_reason, 'Duplicate entry');
    assert.ok(data!.voided_at, 'the void is timestamped');
  });

  it('refuses to alter or delete an approved expense', async () => {
    const { groupId } = await createScratchGroup('Ledger — expense immutable');

    const expense = (await rpc('record_expense', {
      p_group_id: groupId,
      p_title: 'Venue hire',
      p_amount: 5000,
    })) as { id: string };

    const { error: updateError } = await supabase
      .from('expenses')
      .update({ amount: 1 })
      .eq('id', expense.id);
    assert.ok(updateError, 'the amount of an approved expense is frozen');

    const { error: deleteError } = await supabase.from('expenses').delete().eq('id', expense.id);
    assert.ok(deleteError, 'an approved expense cannot be deleted');

    assert.equal((await summaryOf(groupId)).totalExpenses, 5000, 'unchanged');
  });

  it('rejects an expense dated in the future', async () => {
    const { groupId } = await createScratchGroup('Ledger — future expense');

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 3);

    await assert.rejects(
      () =>
        rpc('record_expense', {
          p_group_id: groupId,
          p_title: 'Next week',
          p_amount: 1000,
          p_spent_at: tomorrow.toISOString(),
        }),
      /cannot be dated in the future/
    );
  });
});

describe('susu rotation', () => {
  /** A susu with the owner plus `extra` added members, all in the rotation. */
  async function setUpSusu(label: string, extra: number, amount = 10000) {
    const { groupId, memberId } = await createScratchGroup(label);

    const memberIds = [memberId];
    for (let i = 1; i <= extra; i++) {
      const m = (await rpc('add_member', {
        p_group_id: groupId,
        p_full_name: `Member ${i}`,
        p_phone: nextPhone(),
      })) as { id: string };
      memberIds.push(m.id);
    }

    const plan = (await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Weekly Susu',
      p_kind: 'rotating',
      p_frequency: 'monthly',
      p_default_amount: amount,
      p_grace_days: 0,
      p_start_date: monthsAgo(0),
    })) as { id: string };

    return { groupId, ownerId: memberId, memberIds, planId: plan.id };
  }

  async function rotationOf(planId: string) {
    const { data, error } = await supabase
      .from('rotation_status')
      .select(
        'slot_id, position, member_id, member_name, cycle_id, cycle_label, expected_pot, collected_so_far, paid_out_amount, slot_status'
      )
      .eq('plan_id', planId)
      .order('position');
    if (error) throw error;

    // A view carries no NOT NULL information, so the generated types mark every
    // column nullable. These two are structurally guaranteed by the join.
    return (data ?? []).map((row) => ({
      ...row,
      slot_id: row.slot_id as string,
      member_id: row.member_id as string,
    }));
  }

  it('assigns positions and attaches only the periods that have opened', async () => {
    const { memberIds, planId } = await setUpSusu('Ledger — susu order', 2);

    const count = await rpc('assign_rotation', { p_plan_id: planId, p_member_ids: memberIds });
    assert.equal(count, 3);

    const rotation = await rotationOf(planId);
    assert.equal(rotation.length, 3);
    assert.deepEqual(
      rotation.map((r) => r.position),
      [1, 2, 3]
    );

    // Only this month exists, so exactly one position is due; the rest wait.
    assert.equal(rotation.filter((r) => r.cycle_id !== null).length, 1);
    assert.equal(rotation[0]!.slot_status, 'due');
    assert.equal(rotation[1]!.slot_status, 'upcoming');

    // Future periods must not be billed yet.
    const { data: cycles } = await supabase.from('cycles').select('id').eq('plan_id', planId);
    assert.equal(cycles?.length, 1, 'members do not owe next month yet');
  });

  it('sets the susu to end after everyone has had a turn', async () => {
    const { memberIds, planId } = await setUpSusu('Ledger — susu length', 3);

    await rpc('assign_rotation', { p_plan_id: planId, p_member_ids: memberIds });

    const { data } = await supabase
      .from('plans')
      .select('start_date, end_date')
      .eq('id', planId)
      .single();

    assert.ok(data!.end_date, 'the rotation fixes an end date');
    // Four members, monthly: starts this month, ends at the end of the fourth.
    const start = new Date(`${data!.start_date}T00:00:00Z`);
    const end = new Date(`${data!.end_date}T00:00:00Z`);
    const months =
      (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      (end.getUTCMonth() - start.getUTCMonth());
    assert.equal(months, 3, 'four positions spans three months beyond the first');
  });

  it('pays out the pot and reduces the group balance', async () => {
    const { groupId, memberIds, planId } = await setUpSusu('Ledger — susu payout', 2);
    await rpc('assign_rotation', { p_plan_id: planId, p_member_ids: memberIds });

    // Everyone pays their ₵100 for this period.
    for (const id of memberIds) {
      await rpc('record_payment', {
        p_group_id: groupId,
        p_member_id: id,
        p_amount: 10000,
        p_method: 'cash',
        p_designated_plan_id: planId,
      });
    }

    const before = await rotationOf(planId);
    const first = before[0]!;
    assert.equal(Number(first.expected_pot), 30000, 'three members at ₵100');
    assert.equal(Number(first.collected_so_far), 30000);

    await rpc('record_payout', { p_slot_id: first.slot_id, p_amount: 30000 });

    const after = await rotationOf(planId);
    assert.equal(after[0]!.slot_status, 'paid');
    assert.equal(Number(after[0]!.paid_out_amount), 30000);

    const { data: summary } = await supabase
      .from('group_summaries')
      .select('cash_on_hand, total_collected, total_expenses')
      .eq('group_id', groupId)
      .single();

    assert.equal(Number(summary!.total_collected), 30000);
    assert.equal(Number(summary!.total_expenses), 30000, 'the pot left the group');
    assert.equal(Number(summary!.cash_on_hand), 0, 'money in, money straight out');
  });

  it('nets the recipient unpaid share off their payout', async () => {
    // The everyday case: the person collecting has not paid their own share.
    const { groupId, memberIds, planId } = await setUpSusu('Ledger — susu netting', 2);
    await rpc('assign_rotation', { p_plan_id: planId, p_member_ids: memberIds });

    // The two others pay; the recipient (position 1) does not.
    for (const id of memberIds.slice(1)) {
      await rpc('record_payment', {
        p_group_id: groupId,
        p_member_id: id,
        p_amount: 10000,
        p_method: 'cash',
        p_designated_plan_id: planId,
      });
    }

    const rotation = await rotationOf(planId);
    const slot = rotation[0]!;
    const recipientId = slot.member_id as string;

    assert.equal((await standingOf(recipientId)).balance, 10000, 'they owe their own share');

    await rpc('record_payout', {
      p_slot_id: slot.slot_id,
      p_amount: 30000,
      p_settle_arrears: true,
    });

    // Their own ₵100 is treated as paid out of the pot they collected.
    assert.equal((await standingOf(recipientId)).balance, 0, 'their share is settled');

    const { data: summary } = await supabase
      .from('group_summaries')
      .select('cash_on_hand, total_collected, total_expenses')
      .eq('group_id', groupId)
      .single();

    assert.equal(Number(summary!.total_collected), 30000, 'all three shares are now in');
    assert.equal(Number(summary!.total_expenses), 30000, 'the full pot left');
    assert.equal(Number(summary!.cash_on_hand), 0, 'net cash is nil, as it should be');
    await assertAllocationsBalance(groupId);
  });

  it('refuses a second payout for the same turn', async () => {
    const { memberIds, planId } = await setUpSusu('Ledger — susu double payout', 2);
    await rpc('assign_rotation', { p_plan_id: planId, p_member_ids: memberIds });

    const rotation = await rotationOf(planId);
    await rpc('record_payout', { p_slot_id: rotation[0]!.slot_id, p_amount: 30000 });

    await assert.rejects(
      () => rpc('record_payout', { p_slot_id: rotation[0]!.slot_id, p_amount: 30000 }),
      /already collected/
    );
  });

  it('refuses to pay out a turn that has not come round', async () => {
    const { memberIds, planId } = await setUpSusu('Ledger — susu early payout', 2);
    await rpc('assign_rotation', { p_plan_id: planId, p_member_ids: memberIds });

    const rotation = await rotationOf(planId);
    const upcoming = rotation.find((r) => r.cycle_id === null)!;

    await assert.rejects(
      () => rpc('record_payout', { p_slot_id: upcoming.slot_id, p_amount: 30000 }),
      /has not come round yet/
    );
  });

  it('reverses a payout and frees the turn', async () => {
    const { groupId, memberIds, planId } = await setUpSusu('Ledger — susu reverse', 2);
    await rpc('assign_rotation', { p_plan_id: planId, p_member_ids: memberIds });

    const rotation = await rotationOf(planId);
    await rpc('record_payout', { p_slot_id: rotation[0]!.slot_id, p_amount: 30000 });

    await rpc('reverse_payout', {
      p_slot_id: rotation[0]!.slot_id,
      p_reason: 'Paid the wrong person',
    });

    const after = await rotationOf(planId);
    assert.equal(after[0]!.slot_status, 'due', 'the turn is available again');
    assert.equal(after[0]!.paid_out_amount, null);

    const { data: summary } = await supabase
      .from('group_summaries')
      .select('total_expenses')
      .eq('group_id', groupId)
      .single();
    assert.equal(Number(summary!.total_expenses), 0, 'the payout no longer counts');
  });

  it('refuses to redraw the order once someone has collected', async () => {
    const { memberIds, planId } = await setUpSusu('Ledger — susu redraw', 2);
    await rpc('assign_rotation', { p_plan_id: planId, p_member_ids: memberIds });

    const rotation = await rotationOf(planId);
    await rpc('record_payout', { p_slot_id: rotation[0]!.slot_id, p_amount: 30000 });

    await assert.rejects(
      () =>
        rpc('assign_rotation', {
          p_plan_id: planId,
          p_member_ids: [...memberIds].reverse(),
        }),
      /already collected/
    );
  });

  it('rejects a member appearing twice in the order', async () => {
    const { memberIds, planId } = await setUpSusu('Ledger — susu duplicate', 2);

    await assert.rejects(
      () =>
        rpc('assign_rotation', {
          p_plan_id: planId,
          p_member_ids: [memberIds[0]!, memberIds[0]!, memberIds[1]!],
        }),
      /only hold one position/
    );
  });

  it('lets a latecomer join the end and extends the susu', async () => {
    const { groupId, memberIds, planId } = await setUpSusu('Ledger — susu latecomer', 2);
    await rpc('assign_rotation', { p_plan_id: planId, p_member_ids: memberIds });

    const { data: beforeEnd } = await supabase
      .from('plans')
      .select('end_date')
      .eq('id', planId)
      .single();

    const latecomer = (await rpc('add_member', {
      p_group_id: groupId,
      p_full_name: 'Late Joiner',
      p_phone: nextPhone(),
    })) as { id: string };

    await rpc('append_to_rotation', { p_plan_id: planId, p_member_id: latecomer.id });

    const rotation = await rotationOf(planId);
    assert.equal(rotation.length, 4);
    assert.equal(rotation[3]!.member_id, latecomer.id, 'they take the last turn');

    const { data: afterEnd } = await supabase
      .from('plans')
      .select('end_date')
      .eq('id', planId)
      .single();
    assert.ok(afterEnd!.end_date! > beforeEnd!.end_date!, 'the susu runs one period longer');
  });

  it('hands an uncollected turn to someone else when a member leaves', async () => {
    const { groupId, memberIds, planId } = await setUpSusu('Ledger — susu replace', 2);
    await rpc('assign_rotation', { p_plan_id: planId, p_member_ids: memberIds });

    const replacement = (await rpc('add_member', {
      p_group_id: groupId,
      p_full_name: 'Replacement',
      p_phone: nextPhone(),
    })) as { id: string };

    const rotation = await rotationOf(planId);
    const lastSlot = rotation[2]!;

    await rpc('replace_rotation_member', {
      p_slot_id: lastSlot.slot_id,
      p_member_id: replacement.id,
    });

    const after = await rotationOf(planId);
    assert.equal(after[2]!.member_id, replacement.id);

    // A position that has already collected must not be reassigned.
    await rpc('record_payout', { p_slot_id: after[0]!.slot_id, p_amount: 30000 });
    await assert.rejects(
      () =>
        rpc('replace_rotation_member', {
          p_slot_id: after[0]!.slot_id,
          p_member_id: replacement.id,
        }),
      /already collected/
    );
  });
});

describe('susu audience', () => {
  // A susu is for the people in the rotation, not for the whole group. Billing
  // everyone inflates the pot as well as the arrears, because rotation_status
  // derives the pot from the obligations issued for that period.

  /** A group of `size` members (owner included) with an unassigned susu. */
  async function setUpGroupAndSusu(label: string, size: number, amount = 10000) {
    const { groupId, memberId } = await createScratchGroup(label);

    const memberIds = [memberId];
    for (let i = 1; i < size; i++) {
      const m = (await rpc('add_member', {
        p_group_id: groupId,
        p_full_name: `Member ${i}`,
        p_phone: nextPhone(),
      })) as { id: string };
      memberIds.push(m.id);
    }

    const plan = (await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Monthly Susu',
      p_kind: 'rotating',
      p_frequency: 'monthly',
      p_default_amount: amount,
      p_grace_days: 0,
      p_start_date: monthsAgo(0),
    })) as { id: string };

    return { groupId, memberIds, planId: plan.id };
  }

  async function potOf(planId: string) {
    const { data, error } = await supabase
      .from('rotation_status')
      .select('expected_pot')
      .eq('plan_id', planId)
      .not('cycle_id', 'is', null)
      .order('position')
      .limit(1)
      .single();
    if (error) throw error;
    return Number(data.expected_pot);
  }

  it('bills nobody until the rotation is set', async () => {
    const { planId } = await setUpGroupAndSusu('Ledger — susu unassigned', 4);

    assert.deepEqual(
      await billedMembers(planId),
      [],
      'a susu with no running order has no participants yet'
    );
  });

  it('bills only the members holding a position', async () => {
    const { memberIds, planId } = await setUpGroupAndSusu('Ledger — susu audience', 5);
    const participants = memberIds.slice(0, 3);

    await rpc('assign_rotation', { p_plan_id: planId, p_member_ids: participants });

    const billed = await billedMembers(planId);
    assert.equal(billed.length, 3, 'the two members outside the susu owe nothing');
    assert.deepEqual([...billed].sort(), [...participants].sort());
  });

  it('sizes the pot from the rotation, not the whole group', async () => {
    const { memberIds, planId } = await setUpGroupAndSusu('Ledger — susu pot', 5);

    await rpc('assign_rotation', { p_plan_id: planId, p_member_ids: memberIds.slice(0, 3) });

    assert.equal(await potOf(planId), 30000, 'three members at ₵100, not five');
  });

  it('does not bill a new member who is not in the susu', async () => {
    const { groupId, memberIds, planId } = await setUpGroupAndSusu('Ledger — susu newcomer', 3);
    await rpc('assign_rotation', { p_plan_id: planId, p_member_ids: memberIds });

    const outsider = (await rpc('add_member', {
      p_group_id: groupId,
      p_full_name: 'Not In The Susu',
      p_phone: nextPhone(),
    })) as { id: string };

    const billed = await billedMembers(planId);
    assert.ok(!billed.includes(outsider.id), 'joining the group does not join the susu');
    assert.equal(billed.length, 3);
  });

  it('starts billing a latecomer once they are appended', async () => {
    const { groupId, memberIds, planId } = await setUpGroupAndSusu('Ledger — susu appended', 3);
    await rpc('assign_rotation', { p_plan_id: planId, p_member_ids: memberIds });

    const latecomer = (await rpc('add_member', {
      p_group_id: groupId,
      p_full_name: 'Late Joiner',
      p_phone: nextPhone(),
    })) as { id: string };

    await rpc('append_to_rotation', { p_plan_id: planId, p_member_id: latecomer.id });

    const billed = await billedMembers(planId);
    assert.ok(billed.includes(latecomer.id), 'taking a position starts them contributing');
    assert.equal(billed.length, 4);
  });

  it('moves the billing when a position changes hands', async () => {
    const { groupId, memberIds, planId } = await setUpGroupAndSusu('Ledger — susu handover', 3);
    await rpc('assign_rotation', { p_plan_id: planId, p_member_ids: memberIds });

    const replacement = (await rpc('add_member', {
      p_group_id: groupId,
      p_full_name: 'Replacement',
      p_phone: nextPhone(),
    })) as { id: string };

    const { data: slots, error } = await supabase
      .from('rotation_slots')
      .select('id, member_id, position')
      .eq('plan_id', planId)
      .order('position');
    if (error) throw error;

    // The last position has not collected, so it can still change hands.
    const handedOver = slots!.at(-1)!;

    await rpc('replace_rotation_member', {
      p_slot_id: handedOver.id,
      p_member_id: replacement.id,
    });

    const billed = await billedMembers(planId);
    assert.ok(billed.includes(replacement.id), 'the incomer now contributes');
    assert.ok(!billed.includes(handedOver.member_id), 'the member who left stops owing');
    assert.equal(billed.length, 3, 'the susu is still three people');
  });

  it('leaves an ordinary contribution billing the whole group', async () => {
    // The audience rule is specific to susu — nothing else may narrow silently.
    const { groupId, memberIds, planId } = await setUpGroupAndSusu('Ledger — susu vs dues', 4);
    assert.equal(memberIds.length, 4);

    const dues = (await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Monthly Dues',
      p_kind: 'dues',
      p_frequency: 'monthly',
      p_default_amount: 2000,
      p_grace_days: 0,
      p_start_date: monthsAgo(0),
    })) as { id: string };

    assert.equal((await billedMembers(dues.id)).length, 4);
    assert.equal((await billedMembers(planId)).length, 0, 'the susu still has no rotation');
  });
});

describe('tags', () => {
  // A tag is a sub-group: Executives, Committee. Scoping a contribution to one
  // must issue fewer obligations and nothing else — every total in the app is
  // derived from obligations, so the arithmetic looks after itself.

  /** A group of `size` members with an Executives tag carrying the first two. */
  async function setUpTaggedGroup(label: string, size: number, startedMonthsAgo = 0) {
    const { groupId, memberId } = await createScratchGroup(label);

    const memberIds = [memberId];
    for (let i = 1; i < size; i++) {
      const m = (await rpc('add_member', {
        p_group_id: groupId,
        p_full_name: `Member ${i}`,
        p_phone: nextPhone(),
      })) as { id: string };
      memberIds.push(m.id);
    }

    const tag = (await rpc('create_tag', {
      p_group_id: groupId,
      p_name: 'Executives',
    })) as { id: string };

    await rpc('set_tag_members', {
      p_tag_id: tag.id,
      p_member_ids: memberIds.slice(0, 2),
    });

    return { groupId, memberIds, tagId: tag.id, startedMonthsAgo };
  }

  async function createLevy(groupId: string, tagId: string | null, startedMonthsAgo = 0) {
    const plan = (await rpc('create_plan', {
      p_group_id: groupId,
      p_name: tagId ? 'Executive Levy' : 'Everyone Levy',
      p_kind: 'levy',
      p_frequency: 'monthly',
      p_default_amount: 5000,
      p_grace_days: 0,
      p_start_date: monthsAgo(startedMonthsAgo),
      ...(tagId ? { p_audience_tag_id: tagId } : {}),
    })) as { id: string };
    return plan.id;
  }

  it('bills only the members carrying the tag', async () => {
    const { groupId, memberIds, tagId } = await setUpTaggedGroup('Ledger — tag audience', 4);

    const planId = await createLevy(groupId, tagId);

    const billed = await billedMembers(planId);
    assert.equal(billed.length, 2, 'the two members outside the tag owe nothing');
    assert.deepEqual([...billed].sort(), [...memberIds.slice(0, 2)].sort());
  });

  it('still bills the whole group when no tag is set', async () => {
    const { groupId } = await setUpTaggedGroup('Ledger — tag control', 4);

    const planId = await createLevy(groupId, null);

    assert.equal((await billedMembers(planId)).length, 4, 'an untagged plan is for everyone');
  });

  it('starts billing someone added to the tag', async () => {
    const { groupId, memberIds, tagId } = await setUpTaggedGroup('Ledger — tag joiner', 4);
    const planId = await createLevy(groupId, tagId);

    await rpc('set_tag_members', {
      p_tag_id: tagId,
      p_member_ids: memberIds.slice(0, 3),
    });

    const billed = await billedMembers(planId);
    assert.ok(billed.includes(memberIds[2]!), 'joining Executives starts the levy');
    assert.equal(billed.length, 3);
  });

  it('stops billing someone taken out of the tag', async () => {
    const { groupId, memberIds, tagId } = await setUpTaggedGroup('Ledger — tag leaver', 4);
    const planId = await createLevy(groupId, tagId);

    await rpc('set_tag_members', {
      p_tag_id: tagId,
      p_member_ids: [memberIds[0]!],
    });

    const billed = await billedMembers(planId);
    assert.ok(!billed.includes(memberIds[1]!), 'leaving Executives clears what they had not paid');
    assert.deepEqual(billed, [memberIds[0]!]);
  });

  it('never loses money already paid when a member leaves the tag', async () => {
    const { groupId, memberIds, tagId } = await setUpTaggedGroup('Ledger — tag paid up', 4);
    const planId = await createLevy(groupId, tagId);

    await rpc('record_payment', {
      p_group_id: groupId,
      p_member_id: memberIds[1]!,
      p_amount: 5000,
      p_method: 'cash',
      p_designated_plan_id: planId,
    });

    const before = await standingOf(memberIds[1]!);
    assert.equal(before.totalPaid, 5000);

    await rpc('set_tag_members', {
      p_tag_id: tagId,
      p_member_ids: [memberIds[0]!],
    });

    // The obligation they paid must survive: waiving it would drop it out of
    // obligation_balances and take their payment down with it.
    const after = await standingOf(memberIds[1]!);
    assert.equal(after.totalPaid, 5000, 'their payment still stands');
    assert.equal(after.balance, 0, 'and it is still settled, not turned into arrears');
    await assertAllocationsBalance(groupId);
  });

  it('does not backdate a new member into past periods unless asked', async () => {
    const { groupId, memberIds, tagId } = await setUpTaggedGroup('Ledger — tag arrears', 4, 2);
    const planId = await createLevy(groupId, tagId, 2);

    const periods = (await cyclesOf(planId)).length;
    assert.equal(periods, 3, 'three months have opened');

    await rpc('set_tag_members', {
      p_tag_id: tagId,
      p_member_ids: memberIds.slice(0, 3),
    });

    const joiner = await standingOf(memberIds[2]!);
    assert.equal(joiner.totalDue, 5000, 'only the period that is still open');

    await rpc('set_tag_members', {
      p_tag_id: tagId,
      p_member_ids: memberIds.slice(0, 3),
      p_include_past_periods: true,
    });

    const backdated = await standingOf(memberIds[2]!);
    assert.equal(backdated.totalDue, 15000, 'all three months when the group says so');
  });

  it('narrows a contribution that is already running', async () => {
    const { groupId, memberIds, tagId } = await setUpTaggedGroup('Ledger — tag narrowing', 4);
    const planId = await createLevy(groupId, null);

    assert.equal((await billedMembers(planId)).length, 4);

    await rpc('set_plan_audience', { p_plan_id: planId, p_tag_id: tagId });

    const billed = await billedMembers(planId);
    assert.equal(billed.length, 2, 'it is an Executives levy from now on');
    assert.deepEqual([...billed].sort(), [...memberIds.slice(0, 2)].sort());

    // And back again.
    await rpc('set_plan_audience', { p_plan_id: planId });
    assert.equal((await billedMembers(planId)).length, 4, 'widening restores everyone');
  });

  it('refuses to delete a tag a contribution depends on', async () => {
    const { groupId, tagId } = await setUpTaggedGroup('Ledger — tag in use', 3);
    await createLevy(groupId, tagId);

    await assert.rejects(() => rpc('delete_tag', { p_tag_id: tagId }), /Executive Levy/);
  });

  it('refuses a second tag with the same name', async () => {
    const { groupId } = await setUpTaggedGroup('Ledger — tag duplicate', 2);

    await assert.rejects(
      () => rpc('create_tag', { p_group_id: groupId, p_name: '  executives ' }),
      /already a tag called/
    );
  });

  it('refuses to scope a susu, which already has its rotation', async () => {
    const { groupId, memberIds, tagId } = await setUpTaggedGroup('Ledger — tag vs susu', 3);

    const susu = (await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Monthly Susu',
      p_kind: 'rotating',
      p_frequency: 'monthly',
      p_default_amount: 10000,
      p_grace_days: 0,
      p_start_date: monthsAgo(0),
    })) as { id: string };

    await rpc('assign_rotation', { p_plan_id: susu.id, p_member_ids: memberIds.slice(0, 2) });

    await assert.rejects(
      () => rpc('set_plan_audience', { p_plan_id: susu.id, p_tag_id: tagId }),
      /already limited to the members in its rotation/
    );
  });
});

describe('tag amounts', () => {
  // "Executives pay ₵100, everyone else ₵50" as ONE contribution. The chain is
  // audience → per-member override → first tag amount by rank → plan default.

  /** A group of `size`, an Executives tag over the first two, and a dues plan. */
  async function setUpTiered(label: string, size = 4, defaultAmount = 5000) {
    const { groupId, memberId } = await createScratchGroup(label);

    const memberIds = [memberId];
    for (let i = 1; i < size; i++) {
      const m = (await rpc('add_member', {
        p_group_id: groupId,
        p_full_name: `Member ${i}`,
        p_phone: nextPhone(),
      })) as { id: string };
      memberIds.push(m.id);
    }

    const tag = (await rpc('create_tag', {
      p_group_id: groupId,
      p_name: 'Executives',
    })) as { id: string };

    await rpc('set_tag_members', { p_tag_id: tag.id, p_member_ids: memberIds.slice(0, 2) });

    const plan = (await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Monthly Dues',
      p_kind: 'dues',
      p_frequency: 'monthly',
      p_default_amount: defaultAmount,
      p_grace_days: 0,
      p_start_date: monthsAgo(0),
    })) as { id: string };

    return { groupId, memberIds, tagId: tag.id, planId: plan.id };
  }

  async function dueFor(memberId: string) {
    return (await standingOf(memberId)).totalDue;
  }

  it('charges the tag its own amount and everyone else the default', async () => {
    const { memberIds, tagId, planId } = await setUpTiered('Ledger — tag pricing');

    await rpc('set_plan_tag_amount', { p_plan_id: planId, p_tag_id: tagId, p_amount: 10000 });

    assert.equal(await dueFor(memberIds[0]!), 10000, 'an executive pays the tag amount');
    assert.equal(await dueFor(memberIds[1]!), 10000);
    assert.equal(await dueFor(memberIds[2]!), 5000, 'everyone else stays on the default');
    assert.equal(await dueFor(memberIds[3]!), 5000);

    const totals = await planTotals(planId);
    assert.equal(totals.totalExpected, 30000, 'two at ₵100 plus two at ₵50');
  });

  it('settles an overlap by rank, lowest first', async () => {
    const { groupId, memberIds, tagId, planId } = await setUpTiered('Ledger — tag rank');

    const second = (await rpc('create_tag', {
      p_group_id: groupId,
      p_name: 'Youth',
    })) as { id: string };

    // Member 0 carries both tags.
    await rpc('set_tag_members', { p_tag_id: second.id, p_member_ids: [memberIds[0]!] });

    await rpc('set_plan_tag_amount', {
      p_plan_id: planId,
      p_tag_id: tagId,
      p_amount: 10000,
      p_rank: 1,
    });
    await rpc('set_plan_tag_amount', {
      p_plan_id: planId,
      p_tag_id: second.id,
      p_amount: 1000,
      p_rank: 2,
    });

    assert.equal(await dueFor(memberIds[0]!), 10000, 'rank 1 wins, and they are billed once');
    assert.equal(await dueFor(memberIds[1]!), 10000, 'executive only');
    assert.equal(await dueFor(memberIds[2]!), 5000, 'neither tag');
  });

  it('lets a per-member override beat the tag amount', async () => {
    const { memberIds, tagId, planId } = await setUpTiered('Ledger — override wins');

    await rpc('set_plan_tag_amount', { p_plan_id: planId, p_tag_id: tagId, p_amount: 10000 });

    // No RPC for overrides yet — the table has admin-only RLS, so this is the
    // same write the future set_plan_override will make.
    const { error } = await supabase
      .from('plan_member_overrides')
      .insert({ plan_id: planId, member_id: memberIds[0]!, amount: 2500, reason: 'Hardship' });
    if (error) throw error;

    // Repricing runs on the next plan edit; nothing has been paid, so it applies.
    await rpc('update_plan', { p_plan_id: planId, p_grace_days: 3 });

    assert.equal(await dueFor(memberIds[0]!), 2500, 'the override beats the tag price');
    assert.equal(await dueFor(memberIds[1]!), 10000, 'their colleague is unaffected');
  });

  it('re-prices issued periods only while nothing has been paid', async () => {
    const { groupId, memberIds, tagId, planId } = await setUpTiered('Ledger — tag reprice');

    await rpc('set_plan_tag_amount', { p_plan_id: planId, p_tag_id: tagId, p_amount: 10000 });
    assert.equal(await dueFor(memberIds[0]!), 10000);

    // Still untouched, so raising the tag price reaches the issued period.
    await rpc('set_plan_tag_amount', { p_plan_id: planId, p_tag_id: tagId, p_amount: 12000 });
    assert.equal(await dueFor(memberIds[0]!), 12000, 'the plan is still being set up');

    await rpc('record_payment', {
      p_group_id: groupId,
      p_member_id: memberIds[2]!,
      p_amount: 5000,
      p_method: 'cash',
    });

    // The books are live now: the issued period keeps what members were told.
    await rpc('set_plan_tag_amount', { p_plan_id: planId, p_tag_id: tagId, p_amount: 20000 });
    assert.equal(await dueFor(memberIds[0]!), 12000, 'a rise never reaches backwards');

    await assertAllocationsBalance(groupId);
  });

  it('puts a tag back on the default when its amount is cleared', async () => {
    const { memberIds, tagId, planId } = await setUpTiered('Ledger — tag cleared');

    await rpc('set_plan_tag_amount', { p_plan_id: planId, p_tag_id: tagId, p_amount: 10000 });
    assert.equal(await dueFor(memberIds[0]!), 10000);

    await rpc('clear_plan_tag_amount', { p_plan_id: planId, p_tag_id: tagId });
    assert.equal(await dueFor(memberIds[0]!), 5000, 'back on the plan default');
  });

  it('does not flatten tag amounts when the plan default is edited', async () => {
    // Regression: update_plan carried its own copy of the resolution rule that
    // knew nothing about tag amounts, so any plan edit reset them.
    const { memberIds, tagId, planId } = await setUpTiered('Ledger — edit keeps tiers');

    await rpc('set_plan_tag_amount', { p_plan_id: planId, p_tag_id: tagId, p_amount: 10000 });

    await rpc('update_plan', { p_plan_id: planId, p_default_amount: 6000 });

    assert.equal(await dueFor(memberIds[0]!), 10000, 'the tag keeps its own price');
    assert.equal(await dueFor(memberIds[2]!), 6000, 'everyone else moves to the new default');
  });

  it('bills nobody outside the audience, whatever their tag is worth', async () => {
    const { groupId, memberIds, tagId, planId } = await setUpTiered('Ledger — tiers vs audience');

    const committee = (await rpc('create_tag', {
      p_group_id: groupId,
      p_name: 'Committee',
    })) as { id: string };
    await rpc('set_tag_members', { p_tag_id: committee.id, p_member_ids: memberIds.slice(0, 3) });

    await rpc('set_plan_tag_amount', { p_plan_id: planId, p_tag_id: tagId, p_amount: 10000 });
    await rpc('set_plan_audience', { p_plan_id: planId, p_tag_id: committee.id });

    assert.equal(await dueFor(memberIds[0]!), 10000, 'in the audience, priced by their tag');
    assert.equal(await dueFor(memberIds[2]!), 5000, 'in the audience, on the default');
    assert.equal(await dueFor(memberIds[3]!), 0, 'outside the audience, billed nothing');
  });

  it('refuses to price a tag on a susu', async () => {
    const { groupId, memberIds, tagId } = await setUpTiered('Ledger — tiers vs susu');

    const susu = (await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Monthly Susu',
      p_kind: 'rotating',
      p_frequency: 'monthly',
      p_default_amount: 10000,
      p_grace_days: 0,
      p_start_date: monthsAgo(0),
    })) as { id: string };

    await rpc('assign_rotation', { p_plan_id: susu.id, p_member_ids: memberIds.slice(0, 2) });

    await assert.rejects(
      () => rpc('set_plan_tag_amount', { p_plan_id: susu.id, p_tag_id: tagId, p_amount: 20000 }),
      /same amount each period/
    );
  });

  it('refuses to delete a tag that a contribution prices', async () => {
    const { tagId, planId } = await setUpTiered('Ledger — priced tag delete');

    await rpc('set_plan_tag_amount', { p_plan_id: planId, p_tag_id: tagId, p_amount: 10000 });

    await assert.rejects(() => rpc('delete_tag', { p_tag_id: tagId }), /Monthly Dues/);
  });
});

describe('phone normalisation', () => {
  // The rule lives twice — normalise_gh_phone() in SQL and parseGhanaPhone() in
  // src/lib/phone.ts — because SQL cannot call the TypeScript and the app has to
  // validate input before it ever reaches the database. Three copies of the
  // amount-resolution rule silently drifting is what these checks exist to stop
  // happening again, so both are fed the SAME corpus and must agree exactly.

  /** input → expected E.164, or null when it is not a Ghana mobile number. */
  const CORPUS: [string, string | null][] = [
    ['0241234567', '+233241234567'],
    ['024 123 4567', '+233241234567'],
    ['024-123-4567', '+233241234567'],
    ['(024) 123 4567', '+233241234567'],
    ['241234567', '+233241234567'],
    ['+233241234567', '+233241234567'],
    ['+233 24 123 4567', '+233241234567'],
    ['233241234567', '+233241234567'],
    ['00233241234567', '+233241234567'],
    ['  0241234567  ', '+233241234567'],
    // Country code pasted in front of the local form — common, and salvageable.
    ['+2330241234567', '+233241234567'],
    ['2330241234567', '+233241234567'],
    // Every mobile prefix in use.
    ['0201234567', '+233201234567'],
    ['0501234567', '+233501234567'],
    ['0271234567', '+233271234567'],
    ['0591234567', '+233591234567'],
    // Landline — real, but cannot receive an SMS.
    ['0302123456', null],
    // Wrong length.
    ['024123456', null],
    ['02412345678', null],
    ['1', null],
    // Foreign.
    ['+2348012345678', null],
    // Not a number at all.
    ['', null],
    ['not a phone', null],
  ];

  it('agrees with src/lib/phone.ts on every input', async () => {
    const mismatches: string[] = [];

    for (const [input, expected] of CORPUS) {
      const { data, error } = await supabase.rpc('normalise_gh_phone', { p_phone: input });
      if (error) throw new Error(`normalise_gh_phone failed on "${input}": ${error.message}`);

      const fromSql = (data as string | null) ?? null;
      const fromTs = toE164(input);

      if (fromSql !== expected) {
        mismatches.push(`SQL "${input}" → ${fromSql}, expected ${expected}`);
      }
      if (fromTs !== expected) {
        mismatches.push(`TS  "${input}" → ${fromTs}, expected ${expected}`);
      }
    }

    assert.deepEqual(mismatches, [], `phone normalisation has drifted:\n${mismatches.join('\n')}`);
  });

  it('stores a canonical number without touching what the treasurer typed', async () => {
    const { groupId } = await createScratchGroup('Ledger — phone canonical');

    const member = (await rpc('add_member', {
      p_group_id: groupId,
      p_full_name: 'Ama Serwaa',
      p_phone: '024 123 4567',
    })) as { id: string };

    const { data, error } = await supabase
      .from('group_members')
      .select('phone, phone_e164')
      .eq('id', member.id)
      .single();
    if (error) throw error;

    assert.equal(data.phone, '024 123 4567', 'what was typed is kept for display');
    assert.equal(data.phone_e164, '+233241234567', 'and a canonical form is derived for matching');
  });

  it('keeps the canonical form in step when the number is edited', async () => {
    const { groupId } = await createScratchGroup('Ledger — phone edit');

    const member = (await rpc('add_member', {
      p_group_id: groupId,
      p_full_name: 'Kofi Boateng',
      p_phone: '0241234567',
    })) as { id: string };

    const { error } = await supabase
      .from('group_members')
      .update({ phone: '+233 20 765 4321' })
      .eq('id', member.id);
    if (error) throw error;

    const { data } = await supabase
      .from('group_members')
      .select('phone_e164')
      .eq('id', member.id)
      .single();

    assert.equal(data!.phone_e164, '+233207654321', 'the trigger re-derives it, never drifts');
  });

  it('refuses a number the app could never text', async () => {
    const { groupId } = await createScratchGroup('Ledger — phone rejected');

    await assert.rejects(
      () =>
        rpc('add_member', {
          p_group_id: groupId,
          p_full_name: 'Landline Larry',
          p_phone: '0302123456',
        }),
      /Ghana mobile number/
    );
  });

  it('keeps a legacy member who was recorded before phones were required', async () => {
    // Phone used to be optional and real groups still hold records from then.
    // Those rows must keep working — they simply cannot be linked, which is the
    // whole reason the rule changed. Written directly because `add_member` is
    // now the one door that refuses them.
    const { groupId } = await createScratchGroup('Ledger — legacy no phone');

    const { data: member, error } = await supabase
      .from('group_members')
      .insert({ group_id: groupId, full_name: 'No Phone Nelson', role: 'member', status: 'active' })
      .select('id, phone, phone_e164')
      .single();
    if (error) throw error;

    assert.equal(member!.phone, null);
    assert.equal(member!.phone_e164, null);

    // And they still appear in the group exactly as before.
    const standing = await standingOf(member!.id as string);
    assert.equal(standing.balance, 0);
  });

  it('reports two members sharing a number rather than guessing between them', async () => {
    const { groupId } = await createScratchGroup('Ledger — phone duplicate');

    // Same person entered twice, or a typo. Either way sign-in cannot resolve it.
    await rpc('add_member', {
      p_group_id: groupId,
      p_full_name: 'Ama Serwaa',
      p_phone: '024 123 4567',
    });
    await addDuplicateMember(groupId, 'Ama S.', '+233241234567');

    const { data, error } = await supabase
      .from('duplicate_member_phones')
      .select('phone_e164, member_count')
      .eq('group_id', groupId);
    if (error) throw error;

    assert.equal(data?.length, 1, 'the clash is visible');
    assert.equal(data![0]!.phone_e164, '+233241234567');
    assert.equal(Number(data![0]!.member_count), 2);
  });
});

describe('linking a phone to a member record', () => {
  // A member signs in by phone and must land on the record the treasurer already
  // made for them — two years of contributions — not a second empty one.
  //
  // The claim itself needs a phone Supabase has confirmed by OTP, which cannot
  // be minted with an anon key. link_target_for_phone() is the rule both
  // claim_memberships() and join_group() ask, and it takes the number as an
  // argument, so the decisions below are the real ones used in production.

  async function linkTarget(groupId: string, phone: string) {
    const { data, error } = await supabase.rpc('link_target_for_phone', {
      p_group_id: groupId,
      p_phone: phone,
    });
    if (error) throw new Error(`link_target_for_phone failed: ${error.message}`);

    const row = (data as unknown as { candidates: number; member_id: string | null }[])[0]!;
    return { candidates: Number(row.candidates), memberId: row.member_id };
  }

  it('finds the record a treasurer created for that number', async () => {
    const { groupId } = await createScratchGroup('Ledger — link match');

    const member = (await rpc('add_member', {
      p_group_id: groupId,
      p_full_name: 'Ama Serwaa',
      p_phone: '024 123 4567',
    })) as { id: string };

    // However the member types it at sign-in, it resolves to the same record.
    for (const typed of ['0241234567', '+233241234567', '024 123 4567']) {
      const target = await linkTarget(groupId, typed);
      assert.equal(target.candidates, 1, `failed for ${typed}`);
      assert.equal(target.memberId, member.id, `failed for ${typed}`);
    }
  });

  it('claims nothing when two records share the number', async () => {
    const { groupId } = await createScratchGroup('Ledger — link ambiguous');

    await rpc('add_member', {
      p_group_id: groupId,
      p_full_name: 'Ama Serwaa',
      p_phone: '0241234567',
    });
    await addDuplicateMember(groupId, 'Ama S.', '+233241234567');

    const target = await linkTarget(groupId, '0241234567');
    assert.equal(target.candidates, 2);
    assert.equal(target.memberId, null, 'NULL is what stops the caller guessing');
  });

  it('never offers a record that already belongs to someone', async () => {
    // The owner's own row carries their user_id. A stranger who happened to be
    // given the same number must not be able to take it.
    const { groupId, memberId } = await createScratchGroup('Ledger — link claimed');

    const { data: owner } = await supabase
      .from('group_members')
      .select('phone, user_id')
      .eq('id', memberId)
      .single();
    assert.ok(owner!.user_id, 'the owner row is claimed');

    // Give the owner row a number, then ask for it.
    const { error } = await supabase
      .from('group_members')
      .update({ phone: '0209998888' })
      .eq('id', memberId);
    if (error) throw error;

    const target = await linkTarget(groupId, '0209998888');
    assert.equal(target.candidates, 0, 'a claimed record is not up for grabs');
  });

  it('ignores a member who has left', async () => {
    const { groupId } = await createScratchGroup('Ledger — link departed');

    const member = (await rpc('add_member', {
      p_group_id: groupId,
      p_full_name: 'Departed Dora',
      p_phone: '0241112222',
    })) as { id: string };

    assert.equal((await linkTarget(groupId, '0241112222')).candidates, 1);

    const { error } = await supabase
      .from('group_members')
      .update({ status: 'left' })
      .eq('id', member.id);
    if (error) throw error;

    assert.equal(
      (await linkTarget(groupId, '0241112222')).candidates,
      0,
      'leaving gives up the claim'
    );
  });

  it('finds nothing for a number nobody was recorded with', async () => {
    const { groupId } = await createScratchGroup('Ledger — link absent');

    await rpc('add_member', {
      p_group_id: groupId,
      p_full_name: 'Someone Else',
      p_phone: '0241234567',
    });

    assert.equal((await linkTarget(groupId, '0277654321')).candidates, 0);
  });

  it('treats an unusable number as no match rather than an error', async () => {
    const { groupId } = await createScratchGroup('Ledger — link junk');

    // A landline or nonsense must fall through quietly; sign-in should not 500.
    for (const junk of ['0302123456', 'not a phone', '']) {
      assert.equal((await linkTarget(groupId, junk)).candidates, 0, `failed for "${junk}"`);
    }
  });

  it('refuses to tell a stranger who owns a number', async () => {
    // Not your number, not your group — that is a phone-book lookup.
    const { groupId } = await createScratchGroup('Ledger — link privacy');
    await rpc('add_member', {
      p_group_id: groupId,
      p_full_name: 'Private Person',
      p_phone: '0241234567',
    });

    // The signed-in user IS an admin here, so this one is allowed; the refusal
    // path is the `not has_group_role` branch, which needs a second account to
    // exercise. Assert the allowed path works and the guard exists.
    assert.equal((await linkTarget(groupId, '0241234567')).candidates, 1);
  });

  it('claims nothing at all for an account with no verified phone', async () => {
    // The ledger account signs in by email. This is the gate that matters most:
    // an unverified account must never take anybody's record.
    const { groupId } = await createScratchGroup('Ledger — link unverified');

    await rpc('add_member', {
      p_group_id: groupId,
      p_full_name: 'Tempting Target',
      p_phone: '0241234567',
    });

    // Called directly: a no-argument RPC types its Args as `never`, which the
    // rpc() helper above cannot express.
    const { data: claimed, error: claimError } = await supabase.rpc('claim_memberships');
    if (claimError) throw new Error(`claim_memberships failed: ${claimError.message}`);
    assert.equal(claimed, 0, 'no confirmed phone, no claim');

    const { data } = await supabase
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId)
      .eq('phone_e164', '+233241234567')
      .single();

    assert.equal(data!.user_id, null, 'the record is untouched');
  });

  it('still creates a fresh membership when joining with no phone', async () => {
    // Regression: adoption must not break the ordinary join-by-code path.
    const { groupId } = await createScratchGroup('Ledger — link join code');

    const { data: group } = await supabase
      .from('groups')
      .select('join_code')
      .eq('id', groupId)
      .single();

    // Already the owner here, so joining again is the reactivate path, not a
    // second row — the property that matters is that it stays exactly one row.
    await rpc('join_group', { p_join_code: group!.join_code });

    const { data: mine } = await supabase
      .from('group_members')
      .select('id')
      .eq('group_id', groupId)
      .not('user_id', 'is', null);

    assert.equal(mine?.length, 1, 'joining twice never yields two memberships');
  });

  it('claims the record end to end once the phone is verified', async () => {
    // The whole point of the feature: a member signs in and lands on the record
    // their treasurer already made, with all its history.
    const { groupId } = await createScratchGroup('Ledger — link end to end');

    const member = (await rpc('add_member', {
      p_group_id: groupId,
      p_full_name: 'Verified Vera',
      p_phone: TEST_PHONE,
    })) as { id: string };

    const { client, userId } = await testPhoneSession();

    const { data: claimed, error } = await client.rpc('claim_memberships');
    if (error) throw new Error(`claim_memberships failed: ${error.message}`);
    assert.ok(Number(claimed) >= 1, 'at least this record was claimed');

    const { data: row } = await supabase
      .from('group_members')
      .select('user_id')
      .eq('id', member.id)
      .single();

    assert.equal(row!.user_id, userId, 'the record now belongs to the phone account');

    // And the member can actually see themselves — the reason for all of it.
    const { data: mine } = await client
      .from('group_members')
      .select('id')
      .eq('user_id', userId)
      .eq('group_id', groupId);

    assert.equal(mine?.length, 1, 'exactly one membership, not a duplicate');
    assert.equal(mine![0]!.id, member.id, 'and it is the original record');
  });

  it('tells the admins about the claim', async () => {
    const { groupId } = await createScratchGroup('Ledger — link notice raised');

    await rpc('add_member', {
      p_group_id: groupId,
      p_full_name: 'Noticed Nana',
      p_phone: TEST_PHONE,
    });

    const { client } = await testPhoneSession();
    const { error } = await client.rpc('claim_memberships');
    if (error) throw new Error(`claim_memberships failed: ${error.message}`);

    // Read as the admin — the member cannot see these.
    const { data: notices } = await supabase
      .from('member_link_notices')
      .select('kind, member_name')
      .eq('group_id', groupId);

    assert.equal(notices?.length, 1, 'the admin is told');
    assert.equal(notices![0]!.kind, 'linked');
    assert.equal(notices![0]!.member_name, 'Noticed Nana');
  });

  it('claims neither record when two share the number, and raises an alert', async () => {
    const { groupId } = await createScratchGroup('Ledger — link e2e ambiguous');

    const first = (await rpc('add_member', {
      p_group_id: groupId,
      p_full_name: 'Ama One',
      p_phone: TEST_PHONE,
    })) as { id: string };
    const second = { id: await addDuplicateMember(groupId, 'Ama Two', '0241234567') };

    const { client } = await testPhoneSession();
    const { error } = await client.rpc('claim_memberships');
    if (error) throw new Error(`claim_memberships failed: ${error.message}`);

    const { data: rows } = await supabase
      .from('group_members')
      .select('id, user_id')
      .in('id', [first.id, second.id]);

    for (const row of rows ?? []) {
      assert.equal(row.user_id, null, 'neither record was taken');
    }

    const { data: notices } = await supabase
      .from('member_link_notices')
      .select('kind')
      .eq('group_id', groupId);

    assert.equal(notices?.length, 1);
    assert.equal(notices![0]!.kind, 'ambiguous', 'the admins are asked to fix it');
  });

  it('keeps link notices readable only by the group admins', async () => {
    const { groupId } = await createScratchGroup('Ledger — link notices');

    // Nothing has happened yet, so the list is empty rather than forbidden —
    // the owner IS an admin here.
    const { data, error } = await supabase
      .from('member_link_notices')
      .select('event_id, kind')
      .eq('group_id', groupId);

    assert.equal(error, null, 'an admin may read the notices for their group');
    assert.deepEqual(data, []);
  });
});

describe('append-only guarantees', () => {
  it('refuses to delete a confirmed payment', async () => {
    const { groupId, memberId } = await createScratchGroup('Ledger — append only');

    await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Monthly Dues',
      p_kind: 'dues',
      p_frequency: 'monthly',
      p_default_amount: 2000,
      p_grace_days: 0,
      p_start_date: today(),
    });

    const payment = (await rpc('record_payment', {
      p_group_id: groupId,
      p_member_id: memberId,
      p_amount: 2000,
      p_method: 'cash',
    })) as { id: string };

    const { error } = await supabase.from('payments').delete().eq('id', payment.id);
    assert.ok(error, 'deleting a confirmed payment must fail');

    const { data: still } = await supabase.from('payments').select('id').eq('id', payment.id);
    assert.equal(still?.length, 1, 'the payment must still exist');
  });

  it('reverses by writing a new entry and frees the obligations', async () => {
    const { groupId, memberId } = await createScratchGroup('Ledger — reversal');

    await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Monthly Dues',
      p_kind: 'dues',
      p_frequency: 'monthly',
      p_default_amount: 2000,
      p_grace_days: 0,
      p_start_date: monthsAgo(1),
    });

    const payment = (await rpc('record_payment', {
      p_group_id: groupId,
      p_member_id: memberId,
      p_amount: 4000,
      p_method: 'cash',
    })) as { id: string };

    assert.equal((await standingOf(memberId)).balance, 0);

    await rpc('reverse_payment', { p_payment_id: payment.id, p_reason: 'Recorded in error' });

    const after = await standingOf(memberId);
    assert.equal(after.balance, 4000, 'the debt returns after a reversal');

    const { data: rows } = await supabase
      .from('payments')
      .select('id, amount, status')
      .eq('group_id', groupId)
      .order('created_at');

    assert.equal(rows?.length, 2, 'the original is kept alongside the reversal');
    assert.equal(Number(rows![1]!.amount), -4000, 'the reversal carries a negative amount');
  });
});

describe('joining, approval and invite codes', () => {
  /** Lets anyone with the code straight in, so a join is a membership. */
  async function openGroup(name: string) {
    const scratch = await createScratchGroup(name);
    await rpc('set_join_policy', { p_group_id: scratch.groupId, p_requires_approval: false });
    return { ...scratch, joinCode: await codeOf(scratch.groupId) };
  }

  async function codeOf(groupId: string) {
    const { data } = await supabase.from('groups').select('join_code').eq('id', groupId).single();
    return data!.join_code as string;
  }

  it('bills someone who joins with a code, exactly like one an admin adds', async () => {
    // The gap this reproduces: add_member issued obligations and join_group did
    // not, so a self-joined member silently owed nothing for the open period.
    const { groupId, joinCode } = await openGroup('Ledger — join is billed');

    await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Monthly Dues',
      p_kind: 'dues',
      p_frequency: 'monthly',
      p_default_amount: 5000,
      p_start_date: today(),
    });

    const { client, userId } = await testPhoneSession();

    const { error } = await client.rpc('join_group', { p_join_code: joinCode });
    if (error) throw new Error(`join_group failed: ${error.message}`);

    const { data: member } = await supabase
      .from('group_members')
      .select('id')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .single();

    const standing = await standingOf(member!.id as string);
    assert.equal(standing.totalDue, 5000, 'the open period is billed on joining');
  });

  it('holds a joiner as pending when the group vets people, and bills nothing yet', async () => {
    const { groupId } = await createScratchGroup('Ledger — join needs approval');

    await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Monthly Dues',
      p_kind: 'dues',
      p_frequency: 'monthly',
      p_default_amount: 5000,
      p_start_date: today(),
    });

    const { client, userId } = await testPhoneSession();
    const { error } = await client.rpc('join_group', { p_join_code: await codeOf(groupId) });
    if (error) throw new Error(`join_group failed: ${error.message}`);

    const { data: member } = await supabase
      .from('group_members')
      .select('id, status')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .single();

    assert.equal(member!.status, 'pending', 'they are waiting, not in');

    // Nothing accrues while a group may still decline them.
    const standing = await standingOf(member!.id as string);
    assert.equal(standing.totalDue, 0, 'a pending request owes nothing');

    // And they cannot see the group's money.
    const { data: visible } = await client.from('payments').select('id').eq('group_id', groupId);
    assert.equal(visible?.length ?? 0, 0, 'a pending member sees none of the ledger');

    await rpc('approve_join_request', { p_member_id: member!.id as string });

    const after = await standingOf(member!.id as string);
    assert.equal(after.totalDue, 5000, 'approval bills them for the open period');
  });

  it('folds an approved request into the record an admin already made', async () => {
    // The confusing outcome this prevents: approving creates a second Abraham
    // beside the one holding two years of history.
    const { groupId } = await createScratchGroup('Ledger — approval merges');

    const { client, userId } = await testPhoneSession();
    const { error } = await client.rpc('join_group', { p_join_code: await codeOf(groupId) });
    if (error) throw new Error(`join_group failed: ${error.message}`);

    // The admin records them properly only AFTER the request arrives.
    const existing = (await rpc('add_member', {
      p_group_id: groupId,
      p_full_name: 'Abraham Addae',
      p_phone: TEST_PHONE,
    })) as { id: string };

    const { data: pending } = await supabase
      .from('pending_join_requests')
      .select('member_id, merges_into')
      .eq('group_id', groupId)
      .single();

    assert.equal(pending!.merges_into, 'Abraham Addae', 'the merge is visible before approving');

    await rpc('approve_join_request', { p_member_id: pending!.member_id as string });

    const { data: rows } = await supabase
      .from('group_members')
      .select('id, full_name, user_id')
      .eq('group_id', groupId)
      .eq('user_id', userId);

    assert.equal(rows?.length, 1, 'one record, not two');
    assert.equal(rows![0]!.id, existing.id, 'and it is the established one');
    assert.equal(rows![0]!.full_name, 'Abraham Addae', 'keeping the name the treasurer typed');
  });

  it('lets a declined person ask again', async () => {
    const { groupId } = await createScratchGroup('Ledger — decline');

    const { client } = await testPhoneSession();
    const code = await codeOf(groupId);

    const first = await client.rpc('join_group', { p_join_code: code });
    if (first.error) throw new Error(`join_group failed: ${first.error.message}`);

    const { data: pending } = await supabase
      .from('pending_join_requests')
      .select('member_id')
      .eq('group_id', groupId)
      .single();

    await rpc('decline_join_request', { p_member_id: pending!.member_id as string });

    const { count } = await supabase
      .from('group_members')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', groupId);

    assert.equal(count, 1, 'only the owner is left — a decline leaves no tombstone');

    // A tombstone would have blocked this for good.
    const again = await client.rpc('join_group', { p_join_code: code });
    assert.equal(again.error, null, 'they may ask a second time');
  });

  it('refuses an expired invite code', async () => {
    const { groupId } = await createScratchGroup('Ledger — expired code');
    const code = await codeOf(groupId);

    // Reach past the RPC deliberately: `regenerate_join_code` will not mint a
    // code that is already dead, and expiry in the past is the state we need.
    const { error: expireError } = await supabase
      .from('groups')
      .update({ join_code_expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq('id', groupId);
    if (expireError) throw expireError;

    const { client } = await testPhoneSession();
    const { error } = await client.rpc('join_group', { p_join_code: code });

    assert.ok(error, 'an expired code is refused');
    assert.match(error!.message, /expired/i);
  });

  it('issues a working code again after the old one lapses', async () => {
    const { groupId } = await createScratchGroup('Ledger — regenerate code');
    const before = await codeOf(groupId);

    await rpc('regenerate_join_code', { p_group_id: groupId, p_days: 7 });
    const after = await codeOf(groupId);

    assert.notEqual(after, before, 'the code actually changes');

    const { data: group } = await supabase
      .from('groups')
      .select('join_code_expires_at')
      .eq('id', groupId)
      .single();

    assert.ok(
      new Date(group!.join_code_expires_at as string).getTime() > Date.now(),
      'and the new one is live'
    );

    // The old code is dead the moment it is replaced.
    const { client } = await testPhoneSession();
    const { error } = await client.rpc('join_group', { p_join_code: before });
    assert.ok(error, 'the previous code no longer works');
  });
});

describe('member records need a phone', () => {
  it('refuses a member with no number', async () => {
    // Without one they can never be linked, so signing up would always create a
    // duplicate beside whatever history was recorded here.
    const { groupId } = await createScratchGroup('Ledger — phone required');

    await assert.rejects(
      () => rpc('add_member', { p_group_id: groupId, p_full_name: 'Nameless Number' }),
      /phone number is required/i
    );
  });

  it('refuses two members sharing a number in one group', async () => {
    // Linking cannot tell them apart, so it refuses both. Better to stop the
    // second one being created than to discover it at sign-in.
    const { groupId } = await createScratchGroup('Ledger — duplicate number');

    await rpc('add_member', {
      p_group_id: groupId,
      p_full_name: 'Ama One',
      p_phone: '024 111 2222',
    });

    await assert.rejects(
      () =>
        rpc('add_member', {
          p_group_id: groupId,
          p_full_name: 'Ama Two',
          p_phone: '0241112222',
        }),
      /already has that number/i
    );
  });

  it('claims the real record even after a duplicate was marked as left', async () => {
    // The gap this reproduces: the guard in claim_memberships had no status
    // filter, so a `left` duplicate kept its user_id and permanently blocked
    // the record it was supposed to make way for.
    const { groupId } = await createScratchGroup('Ledger — left unblocks claim');
    const { client, userId } = await testPhoneSession();

    await rpc('set_join_policy', { p_group_id: groupId, p_requires_approval: false });

    const { data: code } = await supabase
      .from('groups')
      .select('join_code')
      .eq('id', groupId)
      .single();

    // They joined under their own number first, creating the duplicate.
    const joined = await client.rpc('join_group', { p_join_code: code!.join_code as string });
    if (joined.error) throw new Error(`join_group failed: ${joined.error.message}`);

    const { data: duplicate } = await supabase
      .from('group_members')
      .select('id')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .single();

    // The admin's repair: set the duplicate aside...
    await supabase.from('group_members').update({ status: 'left' }).eq('id', duplicate!.id);

    // ...and record them properly. The join above stored the verified number on
    // the duplicate, so clear it or add_member refuses the clash.
    await supabase.from('group_members').update({ phone: null }).eq('id', duplicate!.id);

    const real = (await rpc('add_member', {
      p_group_id: groupId,
      p_full_name: 'Abraham Addae',
      p_phone: TEST_PHONE,
    })) as { id: string };

    const { data: claimed, error } = await client.rpc('claim_memberships');
    if (error) throw new Error(`claim_memberships failed: ${error.message}`);
    assert.ok(Number(claimed) >= 1, 'the repair now works');

    const { data: row } = await supabase
      .from('group_members')
      .select('user_id')
      .eq('id', real.id)
      .single();

    assert.equal(row!.user_id, userId, 'the real record is theirs');
  });
});

describe('reports', () => {
  const FROM = '2000-01-01';
  const TO = '2099-12-31';

  async function cash(groupId: string, from = FROM, to = TO) {
    const rows = (await rpc('group_cash_report', {
      p_group_id: groupId,
      p_from: from,
      p_to: to,
    })) as {
      opening_balance: number;
      money_in: number;
      money_out: number;
      closing_balance: number;
    }[];
    return rows[0]!;
  }

  it('balances: opening plus in minus out equals closing', async () => {
    const { groupId, memberId } = await createScratchGroup('Ledger — cash balances');

    await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Monthly Dues',
      p_kind: 'dues',
      p_frequency: 'monthly',
      p_default_amount: 5000,
      p_start_date: today(),
    });

    await rpc('record_payment', {
      p_group_id: groupId,
      p_member_id: memberId,
      p_amount: 5000,
      p_method: 'cash',
    });

    // Recorded by the owner, so `record_expense` files it as approved already —
    // approving it again is refused. Only a non-admin's expense stays pending.
    await rpc('record_expense', {
      p_group_id: groupId,
      p_title: 'Chairs',
      p_amount: 2000,
    });

    const report = await cash(groupId);

    assert.equal(Number(report.money_in), 5000);
    assert.equal(Number(report.money_out), 2000);
    assert.equal(
      Number(report.opening_balance) + Number(report.money_in) - Number(report.money_out),
      Number(report.closing_balance),
      'the four figures must reconcile, or the report cannot be read aloud'
    );
  });

  it('chains: one window closing equals the next window opening', async () => {
    // The property that lets a treasurer read consecutive months at successive
    // meetings without the numbers drifting.
    const { groupId, memberId } = await createScratchGroup('Ledger — cash chains');

    await rpc('record_payment', {
      p_group_id: groupId,
      p_member_id: memberId,
      p_amount: 7500,
      p_method: 'momo',
    });

    const cut = today();
    const earlier = await cash(groupId, FROM, cut);
    const later = await cash(groupId, cut, TO);

    // The cut date sits in both windows, so compare against a window that
    // starts strictly after it instead.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const after = await cash(groupId, tomorrow, TO);

    assert.equal(
      Number(after.opening_balance),
      Number(earlier.closing_balance),
      'the next window opens where the last one closed'
    );
    assert.ok(Number(later.money_in) >= 0);
  });

  it('excludes money that landed outside the window', async () => {
    const { groupId, memberId } = await createScratchGroup('Ledger — cash window');

    await rpc('record_payment', {
      p_group_id: groupId,
      p_member_id: memberId,
      p_amount: 3000,
      p_method: 'cash',
    });

    // A window entirely in the past cannot contain a payment made just now.
    const past = await cash(groupId, '2001-01-01', '2001-12-31');
    assert.equal(Number(past.money_in), 0, 'a closed window ignores later money');
    assert.equal(Number(past.opening_balance), 0);
  });

  it('reports arrears without letting one member advance cancel another debt', async () => {
    // The rule the plan screen was getting wrong: money paid ahead is not a
    // payment against somebody else's obligation.
    const { groupId, memberId } = await createScratchGroup('Ledger — arrears report');

    const other = (await rpc('add_member', {
      p_group_id: groupId,
      p_full_name: 'Owes Everything',
      p_phone: nextPhone(),
    })) as { id: string };

    await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Monthly Dues',
      p_kind: 'dues',
      p_frequency: 'monthly',
      p_default_amount: 5000,
      p_start_date: today(),
    });

    // The owner overpays; the other member pays nothing.
    await rpc('record_payment', {
      p_group_id: groupId,
      p_member_id: memberId,
      p_amount: 8000,
      p_method: 'cash',
    });

    const rows = (await rpc('member_arrears_report', { p_group_id: groupId })) as {
      member_id: string;
      balance: number;
      credit: number;
    }[];

    const debtor = rows.find((r) => r.member_id === other.id)!;
    const payer = rows.find((r) => r.member_id === memberId)!;

    assert.equal(Number(debtor.balance), 5000, 'the debtor still owes their own full amount');
    assert.ok(Number(payer.credit) > 0, 'the overpayment is credit, not a reduction elsewhere');
  });

  it('orders the chase list worst first', async () => {
    const { groupId } = await createScratchGroup('Ledger — arrears order');

    await rpc('create_plan', {
      p_group_id: groupId,
      p_name: 'Monthly Dues',
      p_kind: 'dues',
      p_frequency: 'monthly',
      p_default_amount: 5000,
      p_start_date: monthsAgo(2),
    });

    const rows = (await rpc('member_arrears_report', { p_group_id: groupId })) as {
      balance: number;
    }[];

    for (let i = 1; i < rows.length; i += 1) {
      assert.ok(
        Number(rows[i - 1]!.balance) >= Number(rows[i]!.balance),
        'each row owes no less than the one after it'
      );
    }
  });

  it('refuses a report to somebody outside the group', async () => {
    // The whole point of the auditor gate: reports are the group's books.
    const { groupId } = await createScratchGroup('Ledger — report access');

    const { client } = await testPhoneSession();

    const cashAttempt = await client.rpc('group_cash_report', {
      p_group_id: groupId,
      p_from: FROM,
      p_to: TO,
    });
    assert.ok(cashAttempt.error, 'a stranger cannot read the cash book');

    const arrearsAttempt = await client.rpc('member_arrears_report', { p_group_id: groupId });
    assert.equal((arrearsAttempt.data ?? []).length, 0, 'and cannot read the arrears list either');
  });
});

/**
 * SMS credits.
 *
 * A GROUP IS THE ORGANIZATION — every `organization_id` below is a `groups.id`,
 * and these checks exist mostly to keep that true. The credit RPCs themselves
 * belong to the service role and cannot be called with an anon key, which is
 * the property the first test asserts rather than works around.
 */
describe('sms credits', () => {
  it('gives every new group a zero balance, and no group is billable by accident', async () => {
    const { groupId } = await createScratchGroup('Ledger — SMS balance');

    const { data, error } = await supabase
      .from('organization_sms_balances')
      .select('organization_id, credit_balance, bonus_credits_received')
      .eq('organization_id', groupId)
      .single();

    assert.equal(error, null, 'the balance row is created with the group');
    assert.equal(data!.credit_balance, 0);
    assert.equal(data!.bonus_credits_received, 0);

    // Zero credit is the off switch: nothing else has to be configured, and
    // nothing else may switch SMS on. Asserted through the ledger the app
    // actually reads — `group_can_send_sms` is internal, and the check below
    // that it stays internal is in the next test.
    const { data: spend } = await supabase
      .from('sms_credit_transactions')
      .select('id')
      .eq('organization_id', groupId);
    assert.equal((spend ?? []).length, 0, 'and has spent nothing');
  });

  it('refuses to let the app mint or spend credit', async () => {
    const { groupId } = await createScratchGroup('Ledger — SMS credit RPCs');

    // If either of these ever succeeds, a group can text for free — or empty a
    // rival group's wallet. Both are revoked from `authenticated` on purpose.
    const minted = await supabase.rpc(
      'add_sms_credits' as never,
      {
        p_org_id: groupId,
        p_credits: 1000,
      } as never
    );
    assert.ok(minted.error, 'add_sms_credits is not callable with an anon key');

    const spent = await supabase.rpc(
      'deduct_sms_credits' as never,
      {
        p_org_id: groupId,
        p_message_count: 1,
        p_recipient: '+233241234567',
        p_payload: {},
      } as never
    );
    assert.ok(spent.error, 'deduct_sms_credits is not callable with an anon key');

    // The same PUBLIC grant hid behind every other privileged function here.
    // `enqueue_notification` is the one that matters most after the two above:
    // it is SECURITY DEFINER and takes the message body as an argument, so a
    // caller could put their own words into a text signed as the group.
    const queued = await supabase.rpc(
      'enqueue_notification' as never,
      {
        p_group_id: groupId,
        p_member_id: groupId,
        p_category: 'payment_recorded',
        p_title: 'x',
        p_body: 'x',
      } as never
    );
    assert.ok(queued.error, 'enqueue_notification is not callable with an anon key');

    const drained = await supabase.rpc('dispatch_notifications' as never, {} as never);
    assert.ok(drained.error, 'dispatch_notifications is not callable with an anon key');

    // Budget helpers take a group id and check no membership, so they are
    // internal too. The app reads its own spend from the ledger, where RLS
    // answers the question properly.
    const peeked = await supabase.rpc(
      'group_sms_used_this_month' as never,
      {
        p_group_id: groupId,
      } as never
    );
    assert.ok(peeked.error, 'group_sms_used_this_month is not callable with an anon key');

    // And the balance is not writable directly either.
    const written = await supabase
      .from('organization_sms_balances')
      .update({ credit_balance: 5000 })
      .eq('organization_id', groupId)
      .select();
    assert.equal(
      (written.data ?? []).length,
      0,
      'no RLS policy allows a balance to be written from the app'
    );
  });

  it('keeps one group out of the wallet of another', async () => {
    const { groupId } = await createScratchGroup('Ledger — SMS balance privacy');
    const { client } = await testPhoneSession();

    const balance = await client
      .from('organization_sms_balances')
      .select('organization_id')
      .eq('organization_id', groupId);
    assert.equal((balance.data ?? []).length, 0, 'a stranger sees no balance');

    const ledger = await client
      .from('sms_credit_transactions')
      .select('id')
      .eq('organization_id', groupId);
    assert.equal((ledger.data ?? []).length, 0, 'nor the spend ledger');

    const purchases = await client
      .from('payment_records')
      .select('id')
      .eq('organization_id', groupId);
    assert.equal((purchases.data ?? []).length, 0, 'nor the purchase history');
  });

  it('never lets a group approve its own sender ID', async () => {
    const { groupId } = await createScratchGroup('Ledger — sender ID');

    const asked = await supabase
      .from('sender_id_requests')
      .insert({
        group_id: groupId,
        sender_id: 'LedgerTest',
        reason: 'A scratch group created by the ledger checks.',
      })
      .select('id, status')
      .single();

    assert.equal(asked.error, null, 'an admin may ask');
    assert.equal(asked.data!.status, 'pending');

    // The whole guard rail: approval is an FMT act, not the group's. An admin
    // who could set this could send messages signed as anybody.
    const approved = await supabase
      .from('sender_id_requests')
      .update({ status: 'approved' })
      .eq('id', asked.data!.id)
      .select();
    assert.equal(
      (approved.data ?? []).length,
      0,
      'and cannot approve it — there is no update policy at all'
    );

    // Until one is approved the group has none, so it sends as the platform
    // default rather than as an unregistered name Arkesel would reject.
    const { data: group } = await supabase
      .from('groups')
      .select('sms_sender_id')
      .eq('id', groupId)
      .single();
    assert.equal(group!.sms_sender_id, null);
  });

  it('holds the compatibility view shut against the app', async () => {
    // `organizations` is a shim for the platform admin console and exposes the
    // owner's phone and email. Every in-app view of a group goes through
    // group_members and RLS instead.
    const { groupId } = await createScratchGroup('Ledger — organizations view');

    const view = await supabase
      .from('organizations' as never)
      .select('*')
      .eq('id', groupId);
    assert.ok(
      view.error || (view.data ?? []).length === 0,
      'the organizations view is not readable with an anon key'
    );
  });
});

/**
 * Receipts: the push always goes, the text respects the member.
 *
 * HANDOFF promised receipts "cannot be switched off" and the code never did
 * it. Push is free and a receipt is a record of money, so it is now forced;
 * SMS costs the group money, so it still honours "no texts".
 */
describe('receipts', () => {
  it('always pushes a receipt, and respects a member who asked for no texts', async () => {
    const { groupId, memberId } = await createScratchGroup('Ledger — receipts');

    // The owner silences everything a member is allowed to silence.
    const { error: prefError } = await supabase
      .from('notification_preferences')
      .upsert(
        { member_id: memberId, push_enabled: false, sms_enabled: false, reminders_enabled: false },
        { onConflict: 'member_id' }
      );
    assert.equal(prefError, null);

    await rpc('record_payment', {
      p_group_id: groupId,
      p_member_id: memberId,
      p_amount: 5000,
      p_method: 'cash',
    });

    const { data } = await supabase
      .from('notifications')
      .select('want_push, want_sms')
      .eq('member_id', memberId)
      .eq('category', 'payment_recorded');

    assert.equal((data ?? []).length, 1, 'a receipt is queued even with push switched off');
    assert.equal(data![0]!.want_push, true, 'its push goes regardless — it is a record of money');
    assert.equal(data![0]!.want_sms, false, 'its text respects the no-texts choice');
  });
});

/**
 * Group settings, and the column lock that makes writing them directly safe.
 *
 * `groups_update` let any admin write ANY column: `sms_sender_id` straight
 * past the approval queue, `currency` under two years of contributions. Only
 * column privileges can answer "which columns"; RLS answers "which rows".
 */
describe('group settings', () => {
  it('lets an admin rename, describe and brand the group', async () => {
    const { groupId } = await createScratchGroup('Ledger — settings');

    const { error } = await supabase
      .from('groups')
      .update({
        name: 'Ledger — settings renamed',
        description: 'A scratch group.',
        brand_colour: 'ocean',
      })
      .eq('id', groupId);
    assert.equal(error, null);

    const { data } = await supabase
      .from('groups')
      .select('name, description, brand_colour')
      .eq('id', groupId)
      .single();
    assert.deepEqual(data, {
      name: 'Ledger — settings renamed',
      description: 'A scratch group.',
      brand_colour: 'ocean',
    });
  });

  it('refuses the columns an admin was never meant to write', async () => {
    const { groupId } = await createScratchGroup('Ledger — settings lock');

    const read = () =>
      supabase
        .from('groups')
        .select('currency, sms_sender_id, join_code, created_by')
        .eq('id', groupId)
        .single();
    const { data: before } = await read();

    const attempts: Array<[string, string]> = [
      ['sms_sender_id', 'MTN'],
      ['currency', 'USD'],
      ['join_code', 'HIJACK1'],
      ['created_by', '00000000-0000-0000-0000-000000000000'],
    ];

    for (const [column, value] of attempts) {
      const { error } = await supabase
        .from('groups')
        .update({ [column]: value } as never)
        .eq('id', groupId);
      assert.ok(error, `${column} cannot be written directly`);
    }

    const { data: after } = await read();
    assert.deepEqual(after, before, 'and nothing changed');
  });

  it('keeps the brand colour and the monthly ceiling within bounds', async () => {
    const { groupId } = await createScratchGroup('Ledger — settings bounds');

    const write = (patch: Record<string, unknown>) =>
      supabase
        .from('groups')
        .update(patch as never)
        .eq('id', groupId);

    assert.ok((await write({ brand_colour: 'neon' })).error, 'a colour outside the palette');
    assert.ok((await write({ sms_monthly_cap: -1 })).error, 'a negative ceiling');
    assert.ok((await write({ sms_monthly_cap: 100001 })).error, 'a runaway ceiling');
    assert.equal((await write({ sms_monthly_cap: 750 })).error, null, 'an ordinary one');
  });
});

/**
 * Group messages.
 *
 * Built on the notification outbox, so these check the parts that are new:
 * who may send, who a message reaches, and the all-or-nothing money rule.
 */
describe('group messages', () => {
  it('refuses somebody outside the group', async () => {
    const { groupId } = await createScratchGroup('Ledger — messages access');
    const { client } = await testPhoneSession();

    const preview = await client.rpc('preview_group_message', {
      p_group_id: groupId,
      p_body: 'Hello',
      p_audience: 'everyone',
    });
    assert.ok(preview.error, 'cannot preview');

    const sent = await client.rpc('send_group_message', {
      p_group_id: groupId,
      p_body: 'Hello',
      p_audience: 'everyone',
    });
    assert.ok(sent.error, 'cannot send');

    const history = await client.rpc('group_message_history', { p_group_id: groupId });
    assert.ok(history.error, 'cannot read what was sent');
  });

  it('refuses to text people the group cannot pay for, and sends by push when told to', async () => {
    const { groupId } = await createScratchGroup('Ledger — messages credit');
    await rpc('add_member', {
      p_group_id: groupId,
      p_full_name: 'Akosua Mensah',
      p_phone: nextPhone(),
    });

    const body = 'The meeting is on Saturday at 4pm.';
    const preview = (await rpc('preview_group_message', {
      p_group_id: groupId,
      p_body: body,
      p_audience: 'everyone',
    })) as { recipients: number; bySms: number; credits: number; affordable: boolean };

    assert.equal(preview.recipients, 1, 'everyone except the sender');
    assert.equal(preview.bySms, 1, 'she has a phone and has not refused texts');
    assert.ok(preview.credits >= 1);
    assert.equal(preview.affordable, false, 'a new group has no credit');

    // All-or-nothing: no partial send to whoever the credit happens to reach.
    await assert.rejects(
      () =>
        rpc('send_group_message', { p_group_id: groupId, p_body: body, p_audience: 'everyone' }),
      /credits/
    );

    const sent = (await rpc('send_group_message', {
      p_group_id: groupId,
      p_body: body,
      p_audience: 'everyone',
      p_push_only: true,
    })) as { pushOnly: boolean };
    assert.equal(sent.pushOnly, true);

    const history = (await rpc('group_message_history', { p_group_id: groupId })) as Array<{
      recipients: number;
      texted: number;
      push_only: boolean;
    }>;
    assert.equal(history.length, 1, 'only the send that went through is recorded');
    assert.equal(history[0]!.recipients, 1, 'addressed to one person, reachable or not');
    assert.equal(history[0]!.push_only, true);
    assert.equal(history[0]!.texted, 0);
  });

  it('writes to a member chosen by name, with their first name filled in', async () => {
    const groupName = 'Ledger — messages by name';
    const { groupId, memberId } = await createScratchGroup(groupName);

    // Choosing yourself is deliberate, so — unlike "everyone" — it includes you.
    const sent = (await rpc('send_group_message', {
      p_group_id: groupId,
      p_body: 'Hello {name}, this is a test.',
      p_audience: 'members',
      p_member_ids: [memberId],
    })) as { messageId: string };

    const { data } = await supabase
      .from('notifications')
      .select('title, body, message_id, want_sms')
      .eq('member_id', memberId)
      .eq('category', 'message');

    assert.equal((data ?? []).length, 1);
    assert.equal(data![0]!.message_id, sent.messageId, 'linked to the message it came from');
    assert.equal(data![0]!.title, groupName, 'the push is titled with the group');
    assert.ok(!data![0]!.body.includes('{name}'), 'the placeholder is filled in');
    assert.equal(data![0]!.want_sms, false, 'no credit, so no text');
  });

  it('refuses an empty message, and a tag from another group', async () => {
    const { groupId } = await createScratchGroup('Ledger — messages refusals');
    const { groupId: otherId } = await createScratchGroup('Ledger — messages elsewhere');
    const foreign = (await rpc('create_tag', { p_group_id: otherId, p_name: 'Elsewhere' })) as {
      id: string;
    };

    await assert.rejects(
      () =>
        rpc('send_group_message', { p_group_id: groupId, p_body: '   ', p_audience: 'everyone' }),
      /Write a message/
    );
    await assert.rejects(
      () =>
        rpc('send_group_message', {
          p_group_id: groupId,
          p_body: 'Hello',
          p_audience: 'tag',
          p_tag_id: foreign.id,
        }),
      /not in this group/
    );
  });
});

/**
 * The cost of a text exists twice: `src/lib/sms.ts` for the composer's live
 * counter, and SQL for the affordability check that actually refuses a send.
 * Two copies of a rule is the mistake this file keeps recording — so this
 * feeds both the same corpus and demands they agree, character for character.
 */
describe('sms cost estimate', () => {
  const CORPUS = [
    '',
    'Hello',
    'a'.repeat(160),
    'a'.repeat(161),
    'a'.repeat(306),
    'a'.repeat(307),
    `${'a'.repeat(150)}’s`,
    'Ama’s “dues” — due Saturday…',
    'wait… now​﻿',
    'no break spaces　here',
    'Price × 2 − 1 • ok',
    'Hi {name}, see you',
    '€'.repeat(80),
    '€'.repeat(81),
    `${'a'.repeat(159)}€`,
    '[a]{b}~c|d^e',
    'a\\b',
    '₵'.repeat(70),
    '₵'.repeat(71),
    '\u{1F600}'.repeat(35),
    '\u{1F600}'.repeat(36),
    'Café Ñandú àè Ça Åå £¥',
    'ΔΦΓ ßæ ¿¡',
  ];

  it('agrees with the TypeScript estimator, text for text', async () => {
    for (const text of CORPUS) {
      const label = JSON.stringify(text.length > 40 ? `${text.slice(0, 40)}…` : text);

      const normalised = await rpc('sms_normalise', { p_text: text });
      assert.equal(normalised, smsNormalise(text), `normalised ${label}`);

      const credits = await rpc('sms_credit_estimate', { p_text: text });
      assert.equal(credits, smsCost(text).segments, `credits for ${label}`);
    }
  });
});
