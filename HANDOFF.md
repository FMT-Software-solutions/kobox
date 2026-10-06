# Kobox — project handoff

Read this first in a new session. It records what Kobox is, what is built, the
rules the code enforces, and what to do next.

_Last updated: 6 October 2026._

---

## What Kobox is

A mobile app for **group contributions** — dues, welfare contributions, one-off
levies, voluntary appeals and **susu** (rotating savings). Aimed at any group
size and simple enough for anyone to use.

It **records** money, it does not process it. A treasurer enters cash and mobile
money by hand; members see receipts and balances. Payment-provider integration
(Paystack/MoMo) is deliberately out of scope for v1.

Bundle id `com.fmtss.kobox`. Owner `ankomahenes-team`. EAS project
`8d5867f0-c5cc-4645-a232-3c015c36ee34`.

---

## Stack

| Layer   | Choice                                                                              |
| ------- | ----------------------------------------------------------------------------------- |
| App     | Expo SDK **57**, React Native 0.86, React 19.2, TypeScript 6                        |
| Routing | Expo Router, typed routes, React Compiler on. Routes live in `src/app/`             |
| UI      | NativeWind v4.2.6 + Tailwind 3.4.17, shadcn-style primitives in `src/components/ui` |
| Data    | Supabase (Postgres + RLS + Auth), TanStack Query, Zod                               |
| Icons   | lucide-react-native                                                                 |
| Tests   | Node's built-in runner (`node --test`), zero test dependencies                      |

**NativeWind v4, not v5** — v5 is a pre-release _and older_ than current stable
v4, which post-dates RN 0.86. Verified by bundling.

### Testing on device

**Expo Go does not work** — it supports SDK 54 and this project is SDK 57. Use
the **development build** (an installable APK from EAS). Rebuild it only when a
package with native code is added; pure-JS packages need no rebuild.

> **Native modules are current as of 11 September 2026.** The development build
> of that date (commit `2ecba73`) is the first to carry `google-services.json`,
> which Android push needs — an older build cannot get a push token at all. It
> carries everything: `expo-clipboard`, `expo-image-picker`,
> `expo-image-manipulator`, plus `expo-print`, `expo-sharing`,
> `expo-file-system` (reports), `expo-notifications` and
> `@react-native-community/datetimepicker` — the last two installed ahead of
> the work that needs them, precisely so it does not cost another rebuild.
>
> When a native package IS added, remember Metro serves the JS happily against
> an old binary, so the failure looks like a code bug rather than a missing
> library. Run `eas build --profile development --platform android`.
>
> **No native picker was added, on purpose.** Long lists like members need
> search, and a platform wheel of 200 names is no better than the inline list it
> would replace. `src/components/ui/select.tsx` is one control on React Native's
> own `Modal`: collapsed to a row, opens a sheet, filters as you type.
> `OptionGroup` stays for short sets where seeing every choice at once is the
> point.

```bash
npx expo start --dev-client
```

The laptop's LAN IP changes between sessions — check it and give the phone
`http://<ip>:8081` if the app does not reconnect on its own.

---

## Commands

```bash
npm run check         # typecheck + lint + prettier + unit tests — must be green
npm test              # unit tests only (money, cycles)
npm run test:ledger   # integration checks against the real Supabase project
npm run db:types      # regenerate src/lib/database.types.ts safely
npm run purge:scratch # dry-run the leftover-scratch-group cleanup (--delete to commit)
npx supabase db push  # apply migrations (no Docker needed)
```

The Supabase CLI is a devDependency (added 6 October 2026), so `npx supabase`
runs the pinned copy instead of downloading one. `npx supabase db query
--linked "<sql>"` runs SQL against the live project with the login role — it
is how the state of `app_config`, the outbox and the cron jobs was checked
without the dashboard.

**After any migration that adds an RPC, push it and then run `npm run db:types`
before `npm run check`.** `database.types.ts` is generated from the live
database, so a new RPC is a typecheck error until both have run — the failure
reads as "not assignable to parameter of type" listing every existing function,
which looks alarming and means only "you have not regenerated yet".

`npm run db:types` writes to a temp file, refuses output under 5 KB and strips
the BOM PowerShell adds. Never redirect straight onto `database.types.ts` — a
failure truncates it before the command runs.

`supabase db push`, `gen types` and `migration list` do **not** need Docker.
Only the local stack (`supabase start`, `db diff`, `db reset`) does.

If the CLI and dashboard drift apart:
`npx supabase migration repair --status applied <version>`.

---

## The domain model

Everything derives from one chain, in `src/lib/domain.ts`:

```
Plan  →  Cycles (periods)  →  Obligations (what each member owes)
Payment  →  Allocations  →  applied against Obligations
```

`PlanKind` is the single discriminator that lets one app serve every case:
`dues | contribution | levy | open | rotating | savings`.

### Invariants — do not break these

1. **Money is integer minor units (pesewas).** Never floats. `src/lib/money.ts`.
2. **Balances are derived, never stored.** Views: `obligation_balances`,
   `member_standings`, `group_summaries`, `plan_summaries`, `rotation_status`.
3. **Payments are append-only.** Corrections insert a reversing entry; a trigger
   refuses edits and deletes. Approved expenses are protected the same way.
4. **Allocations always sum exactly to their payment.** Asserted in every ledger
   check.
5. **Issued obligations are never re-priced** once any money exists on the plan.
6. **RLS is the security boundary**, not key secrecy. Every table is
   deny-by-default; `is_group_member()` / `has_group_role()` are SECURITY
   DEFINER to avoid infinite RLS recursion.
7. **One function decides who is billed and how much**:
   `plan_obligation_amount(plan, member)`. NULL means do not bill. Never inline
   that rule again — three copies had already drifted apart. Its two companions
   are just as single-purpose: `reissue_plan_obligations` adds and waives but
   never re-prices, `reprice_plan_obligations` re-prices but never adds or
   waives, and refuses outright once `plan_has_money`.

### Rules a user would ask about

- **Raising an amount** affects future periods only. Nobody is billed the
  difference. If _nothing_ has been paid into the plan yet, everything re-prices
  (the plan is still being set up).
- **Start date** may move earlier freely (backfills). Moving it later is allowed
  only while the periods being dropped are empty; otherwise it names the period
  that blocks it.
- **A yearly contribution does not have to follow the calendar.** December to
  November is an ordinary subscription year and is fully supported. The period
  label reflects it: a January start is `2026`, anything else is `2026/27`.
  Forcing January was tried on 7 September 2026 and reverted the same day — it
  silently moves every member's due date, and the calendar year is the common
  case, not the only one.
- **Delete a contribution** only while nobody has paid in; the button is hidden
  otherwise. **End** it instead — records stay, no new periods open.
- **General vs designated payments.** General settles the oldest obligation
  across every contribution and its surplus becomes credit. Designated settles
  only its own plan and its surplus stays there. Neither crosses contributions.
- **Advance payments** are held as credit and applied automatically as each new
  period opens.
- **Arrears are never netted against money paid ahead.** A plan's "Still owing"
  is `total_expected − settled`, where settled excludes `extra_giving` — money
  designated to the plan that no obligation has claimed yet. Subtracting the
  whole of `total_collected` (fixed 7 September 2026) let one member's advance
  cancel another member's debt: ₵500 from one and ₵0 from another against ₵400
  each read as "still owing ₵300" when the group was owed ₵400 and separately
  holding ₵100. Money paid ahead gets its own line. The view was always right —
  `total_collected` and `extra_giving` are separate columns — only the screen
  conflated them.
- **New members** are asked explicitly whether they inherit past arrears.
- **A susu is only for the people in its rotation.** Membership is explicit —
  you are in it because an admin gave you a position, not because you are in the
  group. A susu therefore collects nothing until the order is set, and joining
  the group later does not join you to the susu.
- **A phone number is required for every member.** It is the only signal that
  links a record to the person it describes, so a blank one guarantees a
  duplicate the moment they sign up. `add_member` refuses without it, refuses
  two members sharing one, and email sign-ups are made to add and verify a
  number before they can reach a group. Records made before this rule still
  work; they simply can never be linked.
- **Admins are told about waiting requests without going to look**: a tappable
  card at the top of the dashboard, and a "N waiting" badge on More → Members.
  Shown only to admins, since only they can approve — telling a treasurer about
  work they cannot do is noise. Pull-to-refresh on the dashboard refetches it.
- **Outstanding join requests are listed in More → Your groups**, beside the
  real memberships, with a Pending badge. "Which groups am I in?" and "which am
  I waiting on?" are the same question to the person asking, and a request was
  otherwise only visible on the onboarding screen they had already left.
- **Joining another group is reachable at any time**, from the dashboard's group
  name or More → Your groups. `(app)/_layout.tsx` deliberately does NOT mirror
  its own redirect here: forcing anyone without a group onto `/onboarding` is
  right, but bouncing anyone WITH one off it made joining a second group
  impossible. Onboarding navigates away itself once it succeeds, so nobody is
  stranded, and it only shows a back button to someone who already belongs
  somewhere.
- **A join code is an invitation, not a door.** It expires (14 days by default),
  it can be regenerated, and by default someone using it becomes a **request**
  an admin approves or declines. A group can opt into letting anyone with the
  code straight in.
- **Being added by an admin skips approval.** An admin who typed you into the
  group has already decided you belong in it; asking a second time is the
  confusing version of the flow.
- **Approving folds the request into the record an admin already made** for that
  number, rather than leaving the group with two of the same person.
- **A contribution is for everyone unless it is pointed at a tag.** Tags are
  sub-groups (Executives, Committee). Joining a tag mid-way asks the same
  arrears question as joining the group mid-way. Leaving a tag clears what you
  had not paid and leaves what you had.

---

## What is built

**Phase 0–2 complete**: auth, groups, members, contributions, payments,
expenses, susu.

**Creating a new susu is switched off in the UI** (11 September 2026). The
option shows in `plans/new.tsx` as "Coming soon" and cannot be chosen, until
susu has been tested on its own. The database still accepts `rotating` and
existing susu plans keep working. Remove `disabled` and `badge` from
`KIND_OPTIONS` to open it.

| Area          | Screens                                                                              |
| ------------- | ------------------------------------------------------------------------------------ |
| Auth          | `(auth)/sign-in.tsx` chooser, `phone.tsx`, `verify.tsx`, `email.tsx`                 |
| Onboarding    | `(app)/name.tsx` — asked when blank, then `(app)/onboarding.tsx`                     |
| Profile       | `(app)/profile.tsx` — name and picture                                               |
| Dashboard     | `(app)/(tabs)/index.tsx`                                                             |
| Statement     | `(app)/statement.tsx` — what you owe, broken down, plus your payments                |
| Contributions | `(tabs)/contributions.tsx`, `plans/new.tsx`, `plans/[id].tsx`, `plans/[id]/edit.tsx` |
| Susu          | `plans/[id]/rotation.tsx`, `payouts/[slotId].tsx`                                    |
| Members       | `members.tsx`, `members/new.tsx`                                                     |
| Payments      | `payments/new.tsx`                                                                   |
| Expenses      | `expenses.tsx`, `expenses/new.tsx`                                                   |
| Tags          | `tags.tsx`, `tags/new.tsx`, `tags/[id].tsx`, `plans/[id]/amounts.tsx`                |

51 migrations, all applied and tracked. Feature code in `src/features/*` as
`api.ts` + `use-*.ts` pairs.

### Auth — OTP and email done; PIN not started

Goal: members sign in with **phone + PIN**, admins keep **email + password**.

**The launch screen offers a way to sign in, never a role.** `role` lives on
`group_members`, so it is per-group: the same person is owner of the group they
created and an ordinary member of two others. Asking "member or admin?" at
login would bake a per-group attribute into the identity and make multi-group
membership unanswerable. One account, many memberships, role resolved per group.

Built so far:

- **`src/lib/phone.ts`** — Ghana numbers, one canonical form (`+233XXXXXXXXX`)
  and every way a Ghanaian writes their own accepted (`024 123 4567`,
  `0241234567`, `241234567`, `+233…`, `00233…`, and `+233 024…` with the trunk
  zero dropped rather than refused). Mobile only — 2 or 5 after the code;
  landlines (3) cannot receive an OTP and are named as such.
  Network names are **display only**: validation is structural, so a range the
  NCA allocates later cannot lock a real member out.
- **`src/lib/identity.ts` + `src/features/auth/last-login.ts`** — remembers
  which door someone came through, for the launch-screen hint. Stores a
  **masked** identifier only (`024 ••• 4567`, `a•••@gmail.com`), never reads it
  as part of authentication, and survives sign-out because being signed out is
  exactly when the hint is needed.
- **Migration `20260804030000_phone_normalisation.sql`** — `phone_e164` beside
  `phone`, maintained by a trigger. **`phone` is never overwritten**: it keeps
  what the treasurer typed, which is what they recognise in a list.
  `duplicate_member_phones` reports two members sharing a number, which linking
  must treat as "link nothing" rather than guess between them.

**The normalisation rule now exists twice** — `normalise_gh_phone()` in SQL and
`parseGhanaPhone()` in TypeScript — because SQL cannot call the app and input
has to be validated before it reaches the database. This is the exact shape of
mistake that cost this project three times over. The mitigation is a ledger
check that feeds **the same corpus to both and asserts they agree**. Change one,
change the other, and run `npm run test:ledger`.

**Linking — done.** Migrations `…040000_phone_linking` and `…050000_link_target`.

A member who signs in must land on the record the treasurer already made for
them, not a second empty one beside two years of contributions. This
**reverses** the note in `20260802020000_members.sql` that said linking is "a
deliberate admin action, not something we guess at from a phone number" — that
note was about an _unverified_ number typed at signup; an OTP-confirmed number
proves possession of the SIM, which is the same proof a treasurer relies on.

Guard rails, because the residual risk is a treasurer's typo:

- only a **confirmed** phone claims anything (`current_verified_phone()` returns
  NULL for not-signed-in, no phone, unconfirmed, or not a Ghana mobile — callers
  treat all four identically);
- only **unclaimed** rows (`user_id IS NULL`, not `left`);
- **two records with one number in one group claims neither** — unresolvable, so
  it raises an alert instead;
- every claim is recorded in `member_link_events` and shown to the group's
  admins on the members screen until dismissed.

`link_target_for_phone(group, phone)` is the single place the rule lives —
`claim_memberships()` and `join_group()` both ask it. It takes the number as an
argument **so it can be tested**: the claim itself needs an OTP-confirmed phone,
which the ledger checks cannot mint with an anon key, so without this the
adoption and ambiguity paths would have shipped unverified. It is not a hole —
you may ask about your own verified number, or any number in a group you
administer, and an admin can already read every member's phone there.

`claim_memberships()` runs on **every launch**, not only after a phone sign-in:
a treasurer may add someone to a new group months later, and that member should
see it without doing anything.

**Phone OTP — built, needs dashboard configuration.**

Screens: `(auth)/sign-in.tsx` is now the **chooser** (phone vs email, with the
last-used door marked), `(auth)/phone.tsx` takes the number, `(auth)/verify.tsx`
takes the code, and the old email form moved to `(auth)/email.tsx`.

`supabase/functions/send-sms-hook/index.ts` is the Send SMS Hook. It is **only
the transport** — Supabase generates, hashes, expires, rate-limits and verifies
every code; we never see or store one, and never mint a JWT. It verifies the
Standard Webhooks signature, then posts to fmt-ss-backend `/sms/send` with
sender `Kobox`, **omitting organizationId/appId** so no group is charged for a
login (see the Arkesel notes under Known gaps).

**The hook aborts its backend call at 3.5 s** (`BACKEND_TIMEOUT_MS`). Supabase
kills the whole hook at 5 s with `Failed to reach hook within maximum time of
5.000000 seconds` — a message the person signing in never sees; they simply
never get a code. A bare `await fetch` has no timeout of its own, so it would
spend the entire budget and leave no room to say anything useful. Aborting
early keeps ~1.5 s to log a named cause and distinguish "did not respond in
time" from "could not reach" — different fixes, so they must not share a log
line. Measured 5 September 2026: the backend answers in 0.7–1.4 s warm, so this
only trips on a cold start or a genuinely degraded backend.

Deploy with `npx supabase functions deploy send-sms-hook --no-verify-jwt`
— **no Docker needed**, and `--no-verify-jwt` matters because Auth calls the
hook without a user JWT. Misconfiguration fails loudly (500 with a named
reason) rather than returning 200 without sending, which would be
indistinguishable from "the SMS never arrived".

`tsconfig.json` excludes `supabase/functions` — Edge Functions are Deno, import
from URLs and use the `Deno` global, none of which the app's TypeScript knows.

**Verified end to end (4 August 2026).** Phone provider on, hook wired, secrets
set, sender ID `Kobox`. The ledger checks now hold a genuinely verified phone
via Supabase's **test phone number** `+233241234567` / code `123456`
(Authentication → Sign In / Providers → Phone → Test phone numbers) — it signs
in without sending an SMS, which is the only way an anon key can get a confirmed
phone.

**That test number has an expiry date, and it is the thing that breaks.**
"Test OTPs Valid Until" sits directly under the number in the dashboard. When
it lapses, the number keeps _looking_ configured while Supabase silently stops
honouring it — so the three linking checks start calling the real SMS hook and
fail with a confusing mixture of `Token has expired or is invalid`,
`For security purposes, you can only request this after 0 seconds` and
`Failed to reach hook within maximum time of 5.000000 seconds`. That is not
three bugs; it is one lapsed date, and it also means the run **sent real SMS**.
It expired on 31 August 2026 and cost most of a session to diagnose on
5 September. If these checks fail, look at the date before anything else.

**Sign in ONCE per run and reuse the session.** Requesting an OTP per test trips
Supabase's rate limit (`you can only request this after 3 seconds`). See
`testPhoneSession()`.

Still to do: the PIN with device trust. Nothing of it exists in `src` — members
sign in with an OTP every time. The group switcher is done (section 5).

### Susu specifics

- A rotation slot holds a **position**; its period attaches when that period
  opens. Future periods are never created early.
- Assigning the rotation sets the plan's **end date** — one period per person.
- A payout is recorded as an **approved expense**, reusing the balance machinery.
- **Arrears netting**: the pot leaves at full value as an expense and the
  recipient's unpaid share is recorded as a payment in. Cash nets to what
  actually changed hands.
- One round per plan. When everyone has collected it is complete.
- **Only members holding a position are billed**, and the pot is the sum of
  their obligations. `assign_rotation`, `append_to_rotation` and
  `replace_rotation_member` each call `reissue_plan_obligations`, because the
  first period opens before any rotation can exist.

---

## Testing

- **60 unit tests** — `money`, `cycles`, `phone`, `identity`, `sms`
- **112 ledger checks** — `scripts/ledger-check.ts`, run against the real
  project, signed in as an ordinary user so **RLS is exercised too**. Each test
  builds a throwaway group and deletes it afterwards.

Credentials: `KOBOX_TEST_EMAIL` / `KOBOX_TEST_PASSWORD` in `.env` (no
`EXPO_PUBLIC_` prefix, so never bundled). Requires **"Confirm email" OFF** in
Supabase → Authentication → Sign In / Providers → Email.

**Run `npm run test:ledger` after any migration that touches money.** It has
already caught six real bugs that `npm run check` could not see:

1. Four RPCs with duplicate overloads — PostgREST refused to choose, so creating
   a recurring contribution was broken. `CREATE OR REPLACE FUNCTION` does **not**
   replace when the argument list changes; it adds an overload. Drop the old one.
2. Duplicate periods surviving a start-date change when they held a payment.
3. `group_summaries` double-counting a reversal, sending the balance negative.
4. Designated money freezing instead of settling its own plan's later periods.
5. `record_expense` could never insert — a bare `CASE` yields `text`, which
   Postgres will not coerce into an enum. Assign to a typed variable first.
6. Credit counting designated giving, so an open-appeal gift claimed to cover
   future months of dues.
7. Every plan billing every active member, so a susu of 5 inside a group of 20
   billed all 20 — and since the pot is derived from the obligations issued for
   the period, `record_payout` was offered an inflated figure with no money
   behind it. Fixed by `plan_obligation_amount`; six checks reproduced it first.
8. `add_member` ignoring `plan_member_overrides` entirely, so adding a member
   billed the plan default to someone the group had deliberately exempted. Found
   by reading the three copies of the rule side by side, not by a test.

---

## Gotchas worth remembering

- **An UPDATE policy is not a column list.** `groups_update` let any admin
  write EVERY column of their group — `sms_sender_id` straight past the
  approval queue, `currency` underneath every amount ever recorded. RLS
  answers "which rows"; only column privileges answer "which columns".
  `groups` now has table-level UPDATE revoked and granted back per column
  (`20260911010000`). Any other table the app writes directly deserves the
  same question.
- **NativeWind's `colorScheme.set` throws outside a browser.** Expo
  pre-renders the web build in Node, and a call at module scope in the root
  layout threw there, killed Metro, and took every connected phone with it.
  `applyAppearance` now returns early when there is no `window`.
- **Revoking EXECUTE takes two revokes, and neither one alone works.**
  Postgres grants `EXECUTE` on a new function to **PUBLIC**, which `anon` and
  `authenticated` inherit without being named. So
  `revoke ... from anon, authenticated` leaves the function wide open while
  reading as though it is locked — the worst shape a security bug can take.
  And the converse: `revoke ... from public` does NOT undo an explicit
  `grant ... to authenticated` written earlier. Name every grantee:
  `revoke execute on function f(...) from public, anon, authenticated;` then
  grant back what genuinely needs it. Both halves were found on 9 September
  2026 by one ledger check calling `add_sms_credits` with an anon key and
  expecting refusal — twice, one run apart. Until it was fixed, any signed-in
  person could mint unlimited SMS credits for any group. Migrations
  `20260909050000` and `20260909060000`.
- **`create or replace view` can only append columns** — it cannot insert or
  rename one. Put new columns last.
- **Expo Router typegen is unreliable here.** It reported `/members/index` when
  the runtime route was `/members`, and invents routes like
  `/../features/groups/api`. Verify against runtime, not typegen.
- **Dynamic routes need the object form**:
  `router.push({ pathname: '/plans/[id]', params: { id } })`. A template literal
  is not assignable.
- **Metro caches the module map.** A brand-new file can fail to resolve until
  `npx expo start --clear`.
- **Optional RPC arguments must be omitted, not `null`** — Postgres `DEFAULT`
  parameters type as `string | undefined`; sending `null` overrides the default.
- **Flat ESLint config: last matching block wins.** An override placed before a
  general rules block silently does nothing.
- **Generated `database.types.ts` is excluded** from Prettier and ESLint.
- **View columns come back nullable** in generated types — views carry no NOT
  NULL information. Cast at the query helper.
- **RLS is not a row filter for "my …" queries.** `fetchMyMemberships` had no
  `user_id` filter (fixed 4 August 2026). A member may SELECT every row in their
  own groups, so it returned the whole membership list of every group — measured
  at 473 rows, 142 of them other people's — and `memberships[0]`, with no
  `.order()`, was whichever row Postgres returned first. That row drives the
  dashboard standing, the statement screen and **who a non-treasurer's payment
  is recorded against**. Invisible while only the owner used the app, a live bug
  the moment members sign in. Always filter explicitly, and always `.order()`.
- **Postgres has no `min()` for `uuid`.** `link_target_for_phone` used it to
  pick the single match and raised `function min(uuid) does not exist` — but
  only once a row actually matched, so every early-return path passed and the
  first ledger run caught it. Aggregate a uuid with a CTE, or `array_agg(...)[1]`.
- **A no-argument RPC types its `Args` as `never`.** The `rpc()` helper in
  `scripts/ledger-check.ts` cannot express that; call `supabase.rpc(name)`
  directly for those.
- **`node --test` resolves value imports for real.** A local `import type` is
  erased and never resolved, so `from './domain'` is fine — but a value import
  inside the test graph needs the explicit extension (`from './phone.ts'`), or
  the suite dies with ERR_MODULE_NOT_FOUND. Metro and `tsc` accept both.
- **React Compiler forbids seeding state from an effect**
  (`react-hooks/set-state-in-effect`). To edit server data, hold each field as
  `null` until touched and fall back to the server value
  (`const name = nameDraft ?? tag.name`). It also fixes the real bug: a
  background refetch can no longer overwrite what is being typed.
- **You can check a screen compiles without the phone.** The dev entry bundle
  does _not_ contain route code — Expo Router loads routes lazily — so grepping
  it proves nothing. Ask Metro to bundle the module directly instead, which
  exercises resolution and the Babel/React-Compiler transform:

  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8081/src/app/%28app%29/tags.bundle?platform=android&dev=true"
  ```

  Parentheses in route groups must be percent-encoded (`%28` / `%29`), and
  `[id]` as `%5Bid%5D`.

---

## Next steps

### 1. Member tags / sub-groups — DONE (4 August 2026)

Migration `20260804010000_tags.sql`, plus `src/features/tags/*` and three
screens. Covers requirement (b): **a contribution scoped to only certain
members**.

| Table / column          | Purpose                                      |
| ----------------------- | -------------------------------------------- |
| `tags`                  | `(group_id, name, colour)`                   |
| `member_tags`           | `(tag_id, member_id)`                        |
| `plans.audience_tag_id` | Nullable — when set, only that tag is billed |

RPCs: `create_tag`, `rename_tag`, `delete_tag`, `set_tag_members`,
`set_member_tags`, `set_plan_audience`. `create_plan` gained
`p_audience_tag_id` (the 8-argument overload was dropped — see the gotcha).

Decisions taken while building:

- **Deleting a tag a contribution depends on is refused**, not cascaded. The FK
  is `on delete restrict` and `delete_tag` names the contribution. Cascading
  would silently widen that contribution to the whole group and bill everybody.
- **Joining a tag mid-plan asks about arrears**, reusing `add_member`'s
  question. `reissue_plan_obligations` gained `p_include_past_periods` to carry
  the answer; waiving is never limited to open periods, because leaving a tag
  clears what you never owed.
- **A susu cannot also be scoped to a tag** — its rotation already is its
  audience. Both `create_plan` and `set_plan_audience` refuse it.
- Tag names are unique per group, case- and whitespace-insensitively
  (`tags_group_name_idx`), because two "Executives" would be indistinguishable
  in every picker.

**Requirement (a) — different tags paying different amounts — is also DONE**,
migration `20260804020000_plan_tag_amounts.sql`, screen
`plans/[id]/amounts.tsx`.

The full resolution chain, most specific first, all inside
`plan_obligation_amount`:

1. not in the audience (susu rotation, or `audience_tag_id`) → not billed
2. `plan_member_overrides` → that amount, NULL meaning exempt
3. first matching `plan_tag_amounts` row **by rank** → that amount
4. `plans.default_amount`

Overlaps are settled by an explicit `rank`, lowest first — the amounts screen
exposes it as up/down arrows, because guessing (cheapest? dearest? newest?) is
unexplainable to a treasurer. A number they set is not.

Pricing a tag is bound by the **same rule as changing the default amount**:
re-price freely while nobody has paid in, never afterwards. That check now lives
in one place, `reprice_plan_obligations`, which returns 0 when
`plan_has_money`. `update_plan` calls it instead of its old inline copy — that
copy knew about overrides but could not know about tag amounts, so any plan edit
would have flattened every tag price back to the default. There is a ledger
check for exactly that.

Refused for a susu (everyone in a rotation pays the same, or the pot stops
meaning anything) and for open giving (no set amount at all).

`plan_member_overrides` still has no UI — it is now reachable only by direct
table write. A `set_plan_override` RPC plus a small screen is the remaining gap.

### 2. Susu audience — DONE (4 August 2026)

Migration `20260804000000_plan_audience.sql`. Confirmed real, reproduced by six
failing ledger checks, then fixed:

- `plan_obligation_amount(plan, member)` is now the only place that decides who
  is billed and how much. NULL means do not bill, for all three reasons that
  can happen: open giving, an exemption, and a susu you hold no position in.
- `reissue_plan_obligations(plan)` reconciles after the audience changes. It
  **only adds or waives, never re-prices**, so invariant 5 still holds. It
  leaves alone any obligation carrying confirmed money — waiving one would drop
  it out of `obligation_balances` and take the member's payment down with it.
  Rows it waives are marked `waived_reason = 'Not part of this contribution'`
  so a later run can undo its own work without reviving a treasurer's waiver.
- `rotation_status.expected_pot` now sums `obligation_balances`, not
  `obligations` — the latter counted waived rows.

### 3. Suggested order

1. ~~Verify and fix the susu audience bug.~~ Done.
2. ~~Tags as a first-class feature.~~ Done — audience scoping.
3. ~~Different amounts per tag.~~ Done.
4. ~~A `set_plan_override` RPC plus UI.~~ Done.
5. ~~Fix the ledger teardown.~~ Done.
6. ~~Reports.~~ Done — five of them, with CSV/PDF/text export.
7. ~~Notifications.~~ Switched on; nothing has been delivered yet. See
   section 11.
8. ~~SMS credits and the billing mapping.~~ Done — a group is the organization.
   See section 12.

### What is actually left (6 October 2026)

In rough order of how much they block real use:

1. **Get a first notification delivered.** The pipeline is on, but no phone
   has ever registered a push token and no group holds SMS credit, so nothing
   has reached anybody. See section 11.
2. **`@react-native-community/datetimepicker` is installed and unused.** The
   custom `DateField` still ships. Swapping it costs no rebuild now.
3. **Leaving a group.** `join_group` already reactivates a `left` membership
   and keeps the history, so the database half is done — it needs a
   `leave_group` RPC and a button.
4. **Withdrawing your own join request.** `decline_join_request` is admin-only;
   a member who typed the wrong code cannot take it back.
5. **Sender ID approval has no admin UI**, in this repo or in fmt-ss-frontend.
   A request lands in `sender_id_requests` and emails `ADMIN_EMAILS`; approving
   it today is `update sender_id_requests set status = 'approved' where id = …`
   run with the service role. Deliberate for now — the console is the right
   home for it and belongs to the platform, not to Kobox.
6. **`plan_member_overrides` has no per-member UI for a susu or open plan** —
   both refuse overrides by design, so this is only a gap if that changes.
7. **The reports index is five items and will keep growing.** At seven or eight
   it wants grouping into "Money" and "People".
8. **iOS is untested**, and push there needs APNs certificates, which needs the
   Apple Developer account.
9. **No audit log.** Every money RPC records who acted, but nothing surfaces it.
10. **Web phase 2 — the signed-in app in a browser. Done 6 October 2026**, so
    people can use Kobox before the Android release. What it took, because each
    is a rule for anything added later:
    - does nothing in a browser. Use from
      , never directly.
    - does nothing after a refresh or a shared link. Use
      from .
    - Report export has a web twin, : CSV downloads, PDF is the
      print dialog, text is the share sheet or the clipboard. What a report
      contains lives once, in .
    - renders the value itself when it is — a
      console error on the web and a crash on a phone. A phone-only account
      has an empty email. Use for anything from the database.
    - A tab opened after an is blocked by Safari; the Paystack
      checkout opens its tab first and points it afterwards.
    - classes keep the picker sheets inside the 560px column.

    Run it locally with . Still open: no web manifest or
    home-screen icon, the Paystack purchase and new sign-up are untested on
    the web, and nothing has been tried in Safari on an iPhone.

11. **Message history has no per-recipient view.** It shows counts (texted,
    delivered, pushed, not texted); "which three were not texted?" needs a
    detail screen over the outbox rows.
12. **PDF reports do not carry the group logo.** `expo-print` renders
    remote images unreliably; embedding would mean fetching the logo as
    base64 first.

### 4. Per-member amounts — DONE (5 September 2026)

Migration `20260905010000_plan_overrides_rpc.sql`, plus
`src/features/plans/overrides-api.ts`, `use-overrides.ts` and the screen
`plans/[id]/members.tsx` ("Amounts by member", linked from the plan detail).

`plan_member_overrides` was the last step of the pricing chain reachable only by
direct table write — and `plan_overrides_write` lets any admin do exactly that,
which made it the one path that could re-price an obligation somebody had
already paid against. `set_plan_override` / `clear_plan_override` close it.

Both call `reissue_plan_obligations` **then** `reprice_plan_obligations`, and
that order matters: reissue settles whether the member is billed at all (adding
a row back, or waiving one when they become exempt), and only reprice is bound
by `plan_has_money`, so an amount change on a plan that has taken money is a
no-op rather than a rewrite. A NULL amount means exempt and **waives** rather
than deletes, so a member's existing payments stay on the books.

Refused for a susu and for open giving, matching `set_plan_tag_amount`. The
table keeps its RLS policy — revoking it would be a silent behaviour change for
anything already reading it — but the app now only ever calls the RPCs.

### 11. Notifications — SWITCHED ON, NOTHING DELIVERED YET (6 October 2026)

Migrations `20260909000000`–`20260909030000`, the `dispatch-notifications` Edge
Function, and `src/features/notifications/*`.

**The pipeline has been live since 11 September 2026.** Checked on 6 October:
the function is deployed (version 5), `DISPATCH_SECRET`, `BACKEND_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are set, `app_config` holds the dispatch URL and
secret, and all four cron jobs are active. The outbox is drained within a
minute of a row becoming due.

**And yet nothing has ever reached anybody.** 639 rows were claimed between
8 September and 5 October with `push_sent` and `sms_sent` false on every one:

- **`expo_push_tokens` is empty.** No phone has ever registered. The
  11 September development build is the first that can; either it has not been
  opened signed in, or `registerPushToken` is failing — and it swallows every
  error, so a failure is indistinguishable from never having run. Open that
  build signed in, allow notifications, then
  `select count(*) from expo_push_tokens`. If it is still zero, log the caught
  error in `push.ts` before guessing.
- **Expo also needs an FCM V1 service account key** on the EAS project
  (`eas credentials` → Android → Google Service Account) before it can deliver
  to Android. Not verified — the command is interactive. Without it a token
  registers and the push ticket comes back `InvalidCredentials`.
- **No group holds SMS credit**, so `want_sms` is false on every row.
  `sms_credit_transactions` is empty: nobody has bought any.

**"Sent" means claimed, not delivered.** A row with no token and no credit is
still marked `sent`. Read `push_sent` and `sms_sent` for what happened.

**Almost all of that traffic is test debris.** 83 of the 86 groups are leftover
ledger scratch groups, and the daily reminder jobs queue rows for each of them.
Harmless while they hold no credit; `npm run purge:scratch -- --delete` clears
them.

An unconfigured project still queues and sends nothing: with `app_config`
empty the cron job sees no dispatcher and returns.

**One outbox, two channels.** Triggers write a `notifications` row in the same
transaction as the event; a worker drains it afterwards. Sending inline was
never an option — a payment trigger that texts "₵100 recorded for you" and then
rolls back has told somebody their money is safe when no such row exists.

`pg_cron` + `pg_net`, not database webhooks: a webhook fires per row, so one
cycle opening for 200 members would be 200 calls.

**The dispatcher claims a batch BEFORE sending.** A crash mid-send then loses
messages rather than repeating them. That trade is deliberate — a missed
reminder is recovered next cycle, a duplicate SMS costs money and trust.

**SMS costs money; push does not.** A group sends SMS when it holds credit —
see section 12. SMS is limited to the categories that justify it —
`payment_recorded`, `payment_reversed`, `period_opened`, `overdue`,
`susu_payout` — and gated by a per-group monthly credit cap, re-checked at
dispatch because both a budget and a wallet can empty between queueing and
sending. A 402 from the backend means out of credits and stops that group's run.

Other guards: `dedupe_key` is unique, so a retry or a double-fired trigger
cannot text twice; `next_sendable_at` holds anything queued between 21:00 and
07:00 until morning; reminders batch to **one message per member** carrying the
total, never one per contribution.

**Receipts cannot be switched off.** Preferences cover push, SMS and reminders,
but `payment_recorded` and `payment_reversed` ignore them: a receipt is a record
of somebody's money, and a member who silenced it cannot later say they were
never told.

Preferences are per **member**, not per account — somebody may want every
reminder from the group collecting their rent and none from the old students'
association.

#### Switching notifications on

Done on this project. Kept for a fresh one:

1. Set the Edge Function secrets: `DISPATCH_SECRET`, `BACKEND_URL`, and
   `SUPABASE_SERVICE_ROLE_KEY`.
2. `update app_config set dispatch_url = '<function url>', dispatch_secret = '<same secret>';`
   — deliberately not in a migration, because a migration is in the repo and a
   secret in the repo is a secret in everybody's git history.

Nothing else. A group needs no configuration to send SMS: it needs credit. See
section 12.

Cron jobs: `kobox-dispatch-notifications` (every minute), `kobox-period-reminders`
(08:00 daily), `kobox-overdue-reminders` (Mondays 09:00),
`kobox-invite-expiry` (10:00 daily).

### 14. Web target, public pages and account deletion — DONE (11 September 2026)

Migration `20260911050000_account_deletion.sql`, the `delete-account` Edge
Function, `src/features/account/*`, `src/app/(public)/*`,
`src/components/shared/public-page.tsx` and `netlify.toml`.

**One codebase, two targets.** The web app is this app built with
`npx expo export --platform web` and hosted on Netlify at
`kobox.fmtsoftware.com`, as FMT's other subdomains are. Phase 1 carries only
the pages Google Play needs to reach from a browser; phase 2 (what is left,
item 10) opens the signed-in app for iPhone users.

**Web output is `single`, not `static`.** Static rendering runs the app in Node
at build time, where the Supabase client reads AsyncStorage and there is no
`window` — it crashed the dev server twice. A single-page app renders only in
the browser; Netlify's `/* → /index.html` rule makes every route a real URL.

**Test both targets after any change**, because one codebase means a web fix
can break the phone: `npm run check`, `npx expo export --platform web` (proves
the web build compiles), and the Android bundle through Metro
(`/node_modules/expo-router/entry.bundle?platform=android&dev=true`). The
in-app browser pane in Claude Code does open `localhost` now.

**`(public)` routes sit outside both guards**: `/privacy` and
`/delete-account`. A signed-in member reaches the same screens from Settings.

**Account deletion.** Until this migration it was impossible:
`groups.created_by` was NOT NULL with no ON DELETE rule. Now it is SET NULL,
and the rule is:

- the account, profile, photo, devices and notifications go (cascades);
- groups where the leaver is the only ACCOUNT are deleted with them — nobody
  else can open them;
- groups they alone own that other people use BLOCK the deletion, by name,
  until they hand over ownership or delete the group;
- in shared groups the member row is unlinked, not deleted: it is the group's
  financial record, and other balances are computed from it.

`prepare_account_deletion()` runs AS the user (the owner checks read
`auth.uid()`); the Edge Function then removes avatars and the auth user with
the service role. If that second step fails the first is safe to repeat. The
web page signs people in inline, with `shouldCreateUser: false` so it can
never create an account, and confirms with a second tap because `Alert` does
nothing on the web.

**The privacy policy is written against the code** — every processor it names
is one Kobox calls, and its deletion section matches the rule above. Change
one, change the other. It is a draft for the owner's review, not legal advice.

### 13. Messages, settings and brand — DONE (11 September 2026)

Migrations `20260911000000`–`20260911030000`, `src/features/messages/*`,
`src/features/groups/{brand.tsx,settings-api.ts,use-settings.ts}`,
`src/lib/{brand.ts,sms.ts,appearance.ts}`, and the screens `messages.tsx`,
`messages/new.tsx`, `settings.tsx`, `settings/group.tsx`.

**UI text is minimal, by the owner's decision.** Labels, numbers and errors;
no explanatory captions or notices. Several were removed on 11 September
because pages read as "texty" rather than as a simple flow. The reasoning
belongs in code comments and in this file, not on the screen.

**Receipts, finally as described.** A receipt's PUSH always goes — it is free
and a record of money. Its SMS respects the member's "no texts", because
forcing it spends the group's credit against their stated wishes. Receipts are
`payment_recorded`, `payment_reversed` and `susu_payout`.

**Group messages are built on the outbox, not beside it.** An admin writes to
everyone, a tag, or chosen members; `send_group_message` writes one
`notifications` row per recipient (category `message`), so preferences,
credits, the ceiling, GSM-7 normalisation, push and delivery receipts all
apply without a second copy. The client never calls `/sms/send` — that
endpoint takes any organisation id it is given, so authorisation must live in
the database.

- **All-or-nothing on money.** If the group cannot afford to text every
  recipient who would be texted, the send is refused; the composer then offers
  push only. A notice that reaches thirty of forty people is worse than none,
  because the admin believes it went.
- **The preview and the send share one audience function and one cost
  estimate**, so the numbers the composer shows are the numbers that happen.
- `{name}` becomes the first name. The SMS is prefixed `Group name: ` while
  the group sends as `Kobox`, since a member in three groups cannot otherwise
  tell who is writing.
- The sender is left out of "everyone" and "a tag", included when chosen by
  name (which is how you test a message).
- `send_group_message` wakes the dispatcher itself rather than waiting for
  cron.

**The cost of a text exists twice**, in `src/lib/sms.ts` for the live counter
and in SQL (`sms_normalise`, `sms_credit_estimate`) for the check that refuses
a send. A ledger check feeds both the same corpus and demands they agree. The
SQL is written with `\u` escapes throughout: `translate()` maps by position
and half the characters are invisible, so one wrong code point shifts every
mapping after it.

**Settings are split by whose they are.** "This group" (admins): name,
description, logo, brand colour, and links to Messages and Text messages.
"You" (everyone): profile, reminders, and appearance (follow phone / light /
dark), which is per DEVICE and stored in AsyncStorage.

**Brand colour is a named palette**, not free hex (`src/lib/brand.ts`, enforced
by `groups_brand_colour_known`). `BrandScope` overrides `--primary` through
NativeWind `vars()`, which re-colours every `bg-primary`/`text-primary` at once;
`useBrand()` gives the hex for icon `color` props, which CSS variables cannot
reach. NULL means the default, jade, so a future change of default reaches
every group that never chose. Logos live in the `group-logos` bucket under the
group's id, writable only by that group's admins.

**Password fields show a show/hide toggle** — built into `Input` for any field
given `secureTextEntry`, so no password field can be written without one.

### 12. SMS credits — DONE (9 September 2026)

Migration `20260909040000_sms_credits.sql`, `src/features/sms/*`, the screens
`(app)/sms.tsx` and `sms/sender-id.tsx`, and one entry in fmt-ss-backend's
`apps.config.ts`.

**A GROUP IS THE ORGANIZATION.** This is the answer to the question section 11
was blocked on, and it is worth stating plainly because everything else here
follows from it. `organizationId` on every call to fmt-ss-backend — the credit
pre-flight on `/sms/send`, the Paystack purchase, the webhook that credits it —
is a `groups.id`. Nothing is provisioned, nobody hands an id out, and a group
can only ever spend credit it bought itself.

The alternative, a separate organization record per group, was rejected for the
reason that keeps recurring in this file: it is a second copy of "who this group
is", and two copies drift.

`groups.sms_organization_id` and `sms_app_id` are **dropped**. A column that can
only ever hold a copy of the primary key is a column that will one day hold a
stale copy of it. What they were really doing — keeping SMS off until somebody
configured it — moves to something honest: **a group sends SMS when it has
credit.** Zero credit is the new "off", enforced by the thing that actually
costs money. `sms_enabled` remains as a deliberate switch, so an owner who wants
push only does not have to empty the wallet to prove it.

**The backend is app-agnostic and its table names are the contract.** It
resolves `appId` to a Supabase project and then reads and writes exactly four
things in it, all now present here and re-keyed onto `groups(id)`:
`organization_sms_balances`, `sms_credit_transactions`, `payment_records`, and
the RPCs `add_sms_credits` / `deduct_sms_credits`. Those names are not ours to
rename.

**`organizations` is a VIEW over `groups`.** The admin console walks every
registered app and runs one query against each — `organizations` → id, name,
email, phone, is_active, sms_sender_id. Kobox has no such table. The view costs
nothing and makes Kobox a first-class citizen of the console: balances,
low-balance alerts and the alert SMS all work unchanged. Contact details are the
**owner's**, because a low-balance warning has to reach somebody who can act on
it. Service role only — it exposes one member's phone and email, and no app
screen has any business reading it.

**The cap counts credits, not messages.** It used to count outbox rows. Arkesel
charges per 160-character GSM-7 segment per recipient, so a cap of 200
"messages" was a cap of somewhere between 200 and 600 credits depending on how
long the group's name is. `group_sms_used_this_month` now sums the ledger the
backend writes, rather than keeping a second counter of the same fact.

**The dispatcher normalises typographic characters.** It only stripped `{}`
before. One curly apostrophe — which a phone keyboard inserts unasked — forces
the whole message from GSM-7 into UCS-2, dropping a segment from 160 characters
to 70 and tripling the bill for every member, every month. The backend
normalises again on send; doing it here as well is what makes the dispatcher's
own budget arithmetic honest.

**Buying credits.** Paystack, through the backend, opened in the system browser
rather than a WebView — Ghanaian mobile money checkouts hand off to a network's
own page or app, and a WebView is where those redirects go to die. The app then
**polls** the reference. That is the point: the Paystack webhook credits the
group server-side whether or not the app is still running, so closing the
browser, killing the app or losing signal costs the confirmation, never the
credits. A poll that gives up says so without claiming failure.

Credits are priced server-side at GHS 0.048 each from the amount Paystack
confirms was charged. The client's figure is display only, and deliberately
ignored: it used to travel in the callback URL, and editing it bought arbitrary
credits for GHS 20.

**Sender IDs.** Every group sends as `Kobox` — already registered, needs no
approval — until it asks for its own. `sender_id_requests` holds the queue, at
most three per group, and a rejected request does not consume a slot. Approving
adopts the ID if the group has none; rejecting or deleting the one in use falls
back to the next approved one or to the default, so a group is never left
pointing at a name it may not use.

**RLS refuses to let a group approve itself.** There is an insert policy and a
delete policy and no update policy at all. An admin who could set `status` could
send messages signed as anybody. Approval is an FMT act, performed with the
service role — and today by hand, because no admin UI exists yet.

**Delivery receipts.** The dispatcher passes `messageRef: notifications.id`, so
Arkesel's report comes back through the backend into `notifications.sms_status`.
Without it, "sent" means only "the provider accepted it" — not the same claim,
and not the one a treasurer chasing an unpaid member needs.

### 10. Reports — DONE (8 September 2026)

Migration `20260908000000_reports.sql`, `src/features/reports/*`, and the
screens `(app)/reports.tsx`, `reports/cash.tsx`, `reports/arrears.tsx`.

**Why this needed SQL at all.** All ten existing views answer "as of now" —
`group_summaries` sums every payment ever recorded, `member_standings` and
`plan_summaries` likewise. None could answer "between two dates", which is what
a report is. The screens were the easy half.

**Five reports, not a report builder**, because they answer different questions
and merging them yields figures that do not reconcile:

| Report          | Question                                                  | Ranged by                             |
| --------------- | --------------------------------------------------------- | ------------------------------------- |
| By contribution | "Who has paid into the Hall Levy, and what is the total?" | none — one plan, all of it            |
| Cash book       | "What moved in September and what is left?"               | `paid_at` / `spent_at`                |
| Collections     | "What came in this month, and from whom?"                 | `paid_at`                             |
| Who owes what   | "Who is behind?"                                          | `cycles.period_start`, or all periods |
| By member       | "Where does one person stand?"                            | none                                  |

**By contribution** is the one groups actually circulate — name at the top,
numbered members with what each paid, total at the bottom. `plan_member_report`
lists everyone in the plan's audience **including those who have paid nothing**;
a list that quietly omits them is exactly the list nobody can chase from. It
uses `plan_obligation_amount` for the audience, so a susu shows only its
rotation and a tagged contribution only that tag — one rule, already written.

**Arrears gained a date range, and the earlier note stands.** "Who was behind on
3 June" still has no honest answer once somebody has paid. But "who owes for the
June to August periods" is answerable, so the range filters
`cycles.period_start` and never `paid_at`. `credit` and `last_paid_at` stay
unscoped inside a range on purpose — credit belongs to no period, and scoping
the last payment would show "never paid" for somebody who paid last week.

The original pair, kept for the distinction that drove the design:

- **Cash book** — `group_cash_report(group, from, to)` plus by-plan and
  by-method splits. About `paid_at` / `spent_at`.
- **Who owes what** — `member_arrears_report(group)`. About CYCLES, and
  deliberately **not** date-ranged: arrears are a position, not a flow, and
  "who was behind in June" has no honest answer once they have since paid.

`opening_balance` is every movement **strictly before** `p_from`, so
consecutive windows chain — one window's closing balance is the next one's
opening balance exactly. That is what lets a treasurer read successive months
aloud without the numbers drifting, and there is a ledger check asserting it.

Reversals are counted (`status in ('confirmed','reversed')`) because a reversal
is itself a negative payment row: the correction belongs in the period it was
made, not silently removed from the period being reported.

**Access is `has_group_role(gid, 'auditor')`**, which means auditor and above.
The auditor role had existed since the first migration and unlocked nothing;
read-only sight of the books is exactly what it is for. `group_cash_report`
**raises** rather than returning an empty row — a refusal must never look like
a group with no money.

**Export lives in one component**, `reports/export-actions.tsx`. Every screen
had grown its own copy of the buttons and its own `run()`, which is exactly how
the save actions ended up on one screen and not the others.

Five routes out: share as a message, share a CSV or PDF, and **save** a CSV or
PDF to a folder. Saving uses `Directory.pickDirectoryAsync()` — the system
folder picker — rather than the share sheet, because "share this" and "put this
somewhere I can find it" are different intentions and the sheet buries the
second behind an app chooser. Dismissing the picker throws rather than
resolving, so it is caught and reported as nothing at all: a cancellation is not
a failure. The PDF copy writes `bytesSync()`, not `textSync()` — a PDF is binary
and text would corrupt it.

**The contribution report excludes non-payers from the export by default**, with
a checkbox to include them. On screen everybody belongs, because a treasurer
needs to see who has not paid. But a shared list is read as a record of what
came in, and a column of zeroes invites the reading that those people owed
nothing — or that they are being named for not paying. The people who paid are
the report; the rest are a chase list, which is a different document with a
different audience.

**Export formats**: text (WhatsApp/SMS), CSV and PDF, all through the system
share sheet. CSV carries a UTF-8 BOM so Excel renders ₵ and non-ASCII names, and
exports **major units** because a spreadsheet will do arithmetic on it. PDF goes
through `expo-print` — the platform's own renderer, so no font or layout engine
ships with the app, and `reportHtml` deliberately references no external asset.

### 9. Who may do what — DONE (7 September 2026)

Migration `20260907000000_roles_and_member_phone.sql`.

**Treasurer runs the books; admin sets policy.** A treasurer recorded payments
and expenses but could not add the member they were recording a payment for,
nor set up the contribution it was against — not a coherent job. Lowered to
treasurer: `add_member`, `create_plan`, `update_plan`, the five tag RPCs, and
the plan tag/member amount RPCs.

Deliberately **kept with admins and owners**, each because it is a control
rather than a task:

| Kept at admin                    | Why                                                                                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `approve_expense`                | A treasurer records spending and somebody else agrees to it. Collapsing both into one person removes the only check on money leaving the group. |
| `reverse_payment`, `delete_plan` | Rewriting or removing history.                                                                                                                  |
| invite code, join approvals      | Who gets into the group at all.                                                                                                                 |
| `set_member_role`                | Who holds any of this authority.                                                                                                                |
| susu rotation                    | Fixes who collects, when, and the plan's end date.                                                                                              |

The migration rewrites **only the role test** inside each function
(`regexp_replace` on `has_group_role(<arg>, 'admin')`), leaving every other line
of the body untouched — restating thirteen definitions would be the duplication
that has already cost this project three bugs. It counts what it changed and
raises if the total is not 13, because a rewrite that matches nothing looks
identical to one that worked.

**`set_member_role`** refuses three things the UI cannot: appointing or removing
an owner without being one, demoting the last owner, and changing your own role
(an admin could otherwise quietly grant themselves everything).

**The member card lost its phone number.** Adding a verified number updated
`profiles.phone` and stopped — `group_members.phone` is a different column, the
one every members screen reads, and `create_group` never set it at all. So an
owner who added their number by OTP still showed "No phone number" on their own
card. `sync_profile_phone` now carries it onto blank member records too,
`create_group` takes it from the profile, and the migration backfills existing
blanks. Numbers a treasurer typed are never overwritten.

**Members list** gained search (name for everyone; name or number for treasurer
and above, since offering number search to a member would let them confirm who
owns a phone by guessing) and a 12-row preview with "View N more".

### 8. Role gating and the phone-change bug — DONE (6 September 2026)

**`send-sms-hook` read only `user.phone`.** When a number is being ADDED or
CHANGED, Supabase puts the destination in `user.new_phone` — and `phone` is
empty for an account created with an email. So every "add your phone number"
attempt hit the hook's own "missing phone or otp" branch, and Supabase surfaced
that to the user as a bare `500` on `/auth/v1/user`. Sign-in kept working the
whole time, which is what made it look like the app rather than the hook. It now
reads `new_phone || phone`.

**Raw auth errors were being shown to users.** The client puts an unparseable
response body into `message`, so the screen displayed
`{"status":500,"statusText":"","redirected":false,"url":"https://<project>.supabase.co/auth/v1/user"}`
— useless to a member and it leaks the project URL. `src/lib/auth-errors.ts`
maps the cases worth naming (number already on another account, rate limited,
expired code, offline) and replaces anything that still reads as machine noise —
JSON, a URL, a bare status — with a plain sentence. Used by `add-phone`,
`email` and `verify`.

**What an ordinary member may see.** The rule is that a member sees their own
money and the list of who is in the group; everything else is the treasurer's or
the admin's. Specifically hidden from `member`:

- other members' phone numbers, balances, roles and tags — the name and an
  account dot are all that is left
- the dashboard's "Group at a glance" totals, and the group-wide "Recent
  payments" — a member sees **"Your recent payments"** instead, scoped to their
  own rows. Hiding it outright was tried on 7 September 2026 and reverted: it
  left the member dashboard half empty and removed the thing they open the app
  for. The narrowing is in the QUERY (`fetchRecentPayments(..., memberId)`),
  not the view — RLS lets a member read every payment in their group, so a
  view-only filter would still fetch everyone's. Same trap as
  `fetchMyMemberships`.
- "Record a payment" — a member could only ever file a pending one, which reads
  as "I have paid" while not yet being true
- "Amounts by tag" and "Amounts by member" on a contribution
- Tags, Expenses and Reports in More, and the invite code

The "Has a Kobox account" line is gone; a small primary-coloured dot beside the
name says it instead, which stops it displacing the phone number.

### 7. Joining, approval and required phones — DONE (6 September 2026)

Migrations `20260906000000_member_status_pending.sql`,
`…010000_membership_approval.sql`, `…020000_duplicate_guard_allows_pending.sql`,
plus `src/features/groups/membership-api.ts`, `use-membership.ts` and
`(app)/add-phone.tsx`.

**The bug that started it was not in the linking SQL at all.** A member whose
record had been correctly claimed still saw "create or join a group". Every
query key in the app is user-agnostic — `['groups','memberships']`,
`['profile','me']`, `['member-links','claim']` — and nothing cleared the
TanStack cache on sign-out. Signing out of the owner account and in as the
member in the same app session served the owner's cached answers, and the claim
query's `staleTime: Infinity` meant it never re-ran. `SessionProvider` now
clears the cache when the user id actually changes, guarded on the previous id
so a token refresh does not wipe it. **Any new query key that is per-user is
still a trap; this fix is the backstop, not a licence to skip scoping.**

Two gaps found while answering a question about how linking behaves, both
reproduced by ledger checks first:

- `join_group` never issued obligations, while `add_member` did. A self-joined
  member silently owed nothing for the open period. The rule now lives once, in
  `issue_member_obligations`, and both callers use it.
- `claim_memberships` skipped a group when ANY row there held the caller's
  user_id, **with no status filter**. A duplicate an admin had marked `left`
  kept its uid and permanently blocked the real record — so the one obvious
  repair for a duplicate did nothing. It now ignores `left` rows and releases
  the stale uid before claiming, keeping the row itself because it may carry
  payment history.

The `pending` enum value is alone in its own migration because Postgres refuses
to use a new enum value in the transaction that adds it, and Supabase runs each
file as one transaction.

**The duplicate-number guard has one deliberate hole**: it ignores `pending`
rows. Without that, an admin could not record someone who had a request
outstanding, which is precisely the case `approve_join_request` merges — the
guard made its own merge unreachable. A ledger check caught it in setup.

`is_group_member()` already required `status = 'active'`, so a pending member
sees nothing of the ledger for free. They also could not see their own row,
which is why `group_members_select_self` and `my_join_requests()` exist — they
return that person's own status and nothing else.

**The More menu is role-gated** by `minRole` per entry. An ordinary member could
previously see Tags, Expenses and the invite code and change none of them, which
made the app look like it was full of dead buttons. A member's view of the money
is the dashboard and their statement.

### 6. Profiles, invites and dead ends — DONE (5 September 2026)

Migration `20260905020000_profiles_and_avatars.sql`, `src/features/profile/*`,
and the screens `(app)/profile.tsx` and `(app)/name.tsx`.

**Why names were blank.** The `profiles` table, the `handle_new_user` trigger
and `profiles_update_self` all existed from the initial migration, and nothing
in the app had ever written to them. Email sign-up got away with it because it
passes `full_name` through `raw_user_meta_data`. **Phone sign-up has nowhere to
ask** — an OTP proves possession of a SIM and nothing else — so those users
arrived with `full_name = ''`, and both `create_group` and `join_group` fall
back to a literal `'Owner'` / `'Member'`. That placeholder is what a whole group
then calls them.

`(app)/name.tsx` is gated in `(app)/_layout.tsx` and deliberately sits **before
onboarding**: asking afterwards would leave the placeholder already written into
`group_members`.

`set_my_name` repairs existing rows, but only where `group_members.full_name` is
still one of those placeholders or empty. **A name a treasurer typed is never
overwritten** — they entered it so the group would recognise the person in a
list, which is the same reasoning that stops phone normalisation from
overwriting `phone`. Changing your own profile name is not a licence to rewrite
what a group calls you.

**Avatars** live in a public-read `avatars` bucket, one folder per uid, with the
storage policies keyed on `(storage.foldername(name))[1] = auth.uid()::text`.
Public-read because a face is shown beside a name to everyone in the group and
signing every URL would buy nothing — the ledger is the secret, and that stays
behind RLS. `profiles_select_group_members` was added for the same reason: the
original policy allowed reading only your own row, so there was no way to show
anyone else's picture.

Uploads are resized to **512px and re-encoded as JPEG at 0.7** before they
leave the phone (~40-60 KB). The bucket's 2 MB ceiling is a backstop, not the
budget: a raw camera-roll image is 3-5 MB, so anything near the limit means the
client pipeline was bypassed and it should fail.

Also in this pass:

- **Join code** is tap-to-copy (`expo-clipboard`) with a share sheet
  (React Native's own `Share`, so it reaches WhatsApp/SMS/anything without a
  per-app integration). Reading a code down a phone line is where invites
  actually fail.
- **The home avatar did nothing when tapped.** It showed the _group's_ initials
  in a spot where every app puts _you_. It is now your own picture and opens
  your profile.
- **"Record a payment" is disabled when the group has no active contribution.**
  There are no obligations to settle, so any amount entered would become
  unallocated credit against a plan that may not exist — money the treasurer
  then has to explain. Admins get a "Create a contribution" button instead.

### 5. Group switcher — DONE (5 September 2026)

`CurrentGroupProvider` has always exposed `selectGroup`, and **nothing had ever
called it** — so anyone in two groups was pinned to their oldest membership with
no way out. That matters more now that phone linking drops people into groups a
treasurer created for them months ago. There is now a "Your groups" list in the
More tab, shown only when there is somewhere to switch to.

The choice is **persisted** to AsyncStorage, which the old comment deliberately
deferred. Making it selectable is what made persistence necessary: a switcher
that forgot itself on every launch is worse than none. It is read as a query,
not an effect — React Compiler rejects seeding state from an effect — so while
it loads the app falls back to the first membership, exactly as before. A stored
id for a group the user has since left falls through to the same fallback.

---

## Moving this project

Everything below assumes the folder is **copied**, not re-cloned. That is no
longer the only safe way: everything has been committed and pushed to
`origin/main` since 11 September 2026, so a clone brings the whole app. It
still does not bring the gitignored files below.

### Must travel with it

| Thing                        | Why                                                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `.env`                       | **Gitignored.** Holds the Supabase URL, publishable key and the ledger test account. Nothing runs without it and no clone will bring it. |
| `supabase/.temp/project-ref` | The `--linked` project id. Without it, re-link with `npx supabase link --project-ref zvybpxxcrdenlmgcwnmq`.                              |
| `src/lib/database.types.ts`  | Generated, but from the LIVE database — regenerate with `npm run db:types` rather than hand-editing.                                     |

### Safe to leave behind

`node_modules/`, `.expo/`, `dist/` — all regenerate from `npm install` and
`npx expo start --clear`.

### After the move

```bash
npm install
npx supabase migration list --linked   # expect every row local == remote
npm run check                          # typecheck, lint, prettier, 60 unit tests
npm run test:ledger                    # 112 checks against the real project
```

If `migration list` shows drift, `npx supabase migration repair --status applied <version>`.

**Nothing in the project is path-dependent** — no absolute paths in config, and
the EAS project is identified by id rather than directory. The dev build already
installed on the phone keeps working; only the Metro URL changes if the laptop's
LAN IP does.

### What lives outside this repo

- **Supabase project `zvybpxxcrdenlmgcwnmq`** — migrations, RLS, the three Edge
  Functions and their secrets, the phone-auth test number and its expiry date.
- **EAS project `8d5867f0-c5cc-4645-a232-3c015c36ee34`** — builds and
  credentials, under the `ankomahenes-team` account.
- **fmt-ss-backend** — `POST /sms/send`, the SMS-credit purchase endpoints, and
  the app registry entry (`apps.config.ts`) that points `appId: 'kobox'` at this
  Supabase project. Needs `KOBOX_SUPABASE_URL` and `KOBOX_SUPABASE_SECRET_KEY`.

---

## Known gaps

- **Phone + PIN sign-in is not built.** Phone OTP is (verified 4 August 2026,
  through Supabase's **Send SMS Hook**), so members sign in with a code every
  time; the PIN with device trust that was meant to replace it has not been
  started.

- **SMS goes through fmt-ss-backend.** Notes for anything that sends one:

  **Arkesel is already solved elsewhere in this org — do not re-implement it.**
  Source of truth: `fmt-ss-backend/src/common/arkesel/arkesel.service.ts`
  (Arkesel v2 API, `api-key` header). Everything else goes through that
  backend's `POST /sms/send` at `https://api.fmtsoftware.com/api`:

  ```
  { sender (<=11 chars), message, recipients: [{ phone }],
    organizationId?, appId?, sandbox?, messageRef? }
  ```

  - **`organizationId` + `appId` are optional, and that matters.** The credit
    pre-flight only runs when BOTH are present (`sms.service.ts:77`). A login
    OTP must omit them — at that moment we do not yet know which group the
    person belongs to, so no group's credits can or should be charged. Group
    notifications pass them, and `organizationId` **is the group's own id**.
    Handle **402 = out of credits**.
  - The backend normalises GSM-7 on the way out, and the dispatcher normalises
    again on the way in. That is not redundant: a curly quote silently triples
    the cost by forcing UCS-2, and the dispatcher's own budget arithmetic is
    only honest if it measures the text that actually gets sent.
  - **Never put `{` or `}` in a message** — the backend reads them as template
    placeholders and routes to Arkesel's template API, which then rejects it.
  - Working Edge Function to copy:
    `PSP-V2/print-calc-pro/supabase/functions/dispatch-job-reminders/index.ts`.

- **iOS is untested.** Config is maintained (`app.json`, `eas.json`) so shipping
  is `eas build --platform ios`, but a physical iPhone needs an Apple Developer
  account for provisioning.
- **Payments are always dated now.** `record_payment` accepts `p_paid_at` and
  validates it, but the UI does not expose back-dating.
- **No offline mode.**
- **The ledger checks run against the live project.** That is what makes them
  real, but a staging Supabase project would be a safer home for the destructive
  functions (`realign_cycles`, `prune_misaligned_cycles`).
- ~~**The ledger teardown has never worked.**~~ Fixed 5 September 2026,
  migration `20260905000000_delete_group_cascade.sql`. It had reached **609**
  leftover scratch groups. `delete_group_cascade(uuid)` is now the owner-only
  path that can delete a group which has recorded money, and `after()` collects
  every failure and throws, so it can never fail silently again. Clear an
  existing backlog with `npm run purge:scratch -- --delete` (it dry-runs
  without the flag).

  The interesting part is _why_ a plain delete could never work, which is worth
  keeping: `payments.member_id` is ON DELETE **RESTRICT**, and RESTRICT is
  checked immediately rather than at end of statement, so the cascade into
  `group_members` aborts on the first payment. Removing that alone would not
  have helped either — a cascading delete still fires row triggers on the child
  table, so `protect_confirmed_payments` would refuse it next.

  Both triggers therefore gained one narrow bypass, and its security rests on a
  condition a client cannot forge: `purging_group()` requires **both** a
  transaction-local GUC naming the group **and** `current_user` being the owner
  of the guarded table. PostgREST always runs as `authenticated`; only the body
  of a SECURITY DEFINER function owned by the table owner runs as the owner. So
  an admin issuing a raw `DELETE` on `payments` is refused exactly as before —
  the "refuses to delete a confirmed payment" check is the regression test.
  This grants no new authority: `groups_delete` already said an owner may
  delete their group, and this only makes that permitted action possible.

- **The repo cannot reach the real group.** `.env` holds only the anon key and
  the ledger test account, and RLS confines that account to the groups it
  created. Anything that has to touch the real group is either done in the app,
  or run in the dashboard SQL editor (see `scripts/seed-test-members.sql`), or
  needs a service-role key that is deliberately not in the repo.
