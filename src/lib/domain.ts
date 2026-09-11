import type { CurrencyCode, Minor } from './money';

/**
 * The Kobox domain model.
 *
 * These types live together rather than in per-feature folders because they are
 * mutually referential (an Obligation points at a Plan, a Cycle and a Member);
 * splitting them would only create circular imports. Feature folders own their
 * screens, hooks and queries — this file owns the shared vocabulary.
 *
 * The core idea, which every screen and report derives from:
 *
 *   Plan  →  generates Cycles  →  each Cycle creates Obligations (what is owed)
 *   Payment  →  split into Allocations  →  applied against Obligations
 *
 * Balances, arrears, collection rates and leaderboards are all *derived* from
 * that ledger. Nothing stores a running total that could drift out of sync.
 */

export type Uuid = string;
/** ISO-8601 date-time string, always stored in UTC. */
export type IsoDateTime = string;
/** ISO-8601 calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

/* -------------------------------------------------------------------------- */
/* Group & membership                                                          */
/* -------------------------------------------------------------------------- */

export interface Group {
  id: Uuid;
  name: string;
  /** Short human-shareable code used to join, e.g. "KBX-4821". */
  joinCode: string;
  currency: CurrencyCode;
  timezone: string;
  logoUrl: string | null;
  createdAt: IsoDateTime;
}

/**
 * Roles are ordered by privilege. `owner` implies every lower capability.
 * `auditor` is deliberately read-only: it exists so a group can grant scrutiny
 * without granting the ability to alter the books.
 */
export type MemberRole = 'owner' | 'admin' | 'treasurer' | 'member' | 'auditor';

export const ROLE_RANK: Record<MemberRole, number> = {
  owner: 5,
  admin: 4,
  treasurer: 3,
  auditor: 2,
  member: 1,
};

export type MemberStatus = 'active' | 'invited' | 'suspended' | 'left';

export interface Member {
  id: Uuid;
  groupId: Uuid;
  /** Null when the member has no Kobox account yet — many members never install the app. */
  userId: Uuid | null;
  fullName: string;
  phone: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: MemberRole;
  status: MemberStatus;
  joinedAt: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* Plans & cycles                                                              */
/* -------------------------------------------------------------------------- */

/**
 * What kind of money movement a plan describes. This single discriminator is
 * what lets one app serve dues, welfare contributions, levies and susu.
 */
export type PlanKind =
  /** Recurring obligation owed to the group, e.g. monthly membership dues. */
  | 'dues'
  /** Recurring or one-off contribution towards a shared purpose. */
  | 'contribution'
  /** Single-event levy, e.g. a funeral or a building fund. */
  | 'levy'
  /** No fixed obligation — members give what they wish. */
  | 'open'
  /** Rotating savings (ROSCA): everyone pays in, one member collects each cycle. */
  | 'rotating'
  /** Savings held on behalf of the member; the balance is owed *back* to them. */
  | 'savings';

export type PlanFrequency =
  'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly' | 'once';

export type PlanStatus = 'draft' | 'active' | 'paused' | 'ended';

export interface Plan {
  id: Uuid;
  groupId: Uuid;
  name: string;
  kind: PlanKind;
  frequency: PlanFrequency;
  status: PlanStatus;
  /**
   * Default amount owed per member per cycle, in minor units.
   * Null for `open` plans, where no obligation is generated.
   */
  defaultAmount: Minor | null;
  startDate: IsoDate;
  endDate: IsoDate | null;
  /** Days after a cycle closes before unpaid obligations count as arrears. */
  graceDays: number;
  createdAt: IsoDateTime;
}

/** Per-member override of a plan's default amount (discounts, exemptions, tiers). */
export interface PlanMemberOverride {
  id: Uuid;
  planId: Uuid;
  memberId: Uuid;
  /** Null means the member is exempt from this plan entirely. */
  amount: Minor | null;
  reason: string | null;
}

export type CycleStatus = 'upcoming' | 'open' | 'closed';

export interface Cycle {
  id: Uuid;
  planId: Uuid;
  /** Human label for the period, e.g. "March 2026" or "Week 12". */
  label: string;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  dueDate: IsoDate;
  status: CycleStatus;
}

/* -------------------------------------------------------------------------- */
/* The ledger: obligations, payments, allocations                              */
/* -------------------------------------------------------------------------- */

/** What a specific member owes for a specific cycle. */
export interface Obligation {
  id: Uuid;
  cycleId: Uuid;
  memberId: Uuid;
  amountDue: Minor;
  /** Denormalised sum of allocations against this obligation, maintained by the DB. */
  amountPaid: Minor;
  waived: boolean;
  waivedReason: string | null;
}

export type PaymentMethod = 'cash' | 'momo' | 'bank' | 'cheque' | 'card' | 'other';

/**
 * `pending` — recorded by a member, awaiting treasurer confirmation.
 * `confirmed` — counted in all balances and reports.
 * `rejected` — kept for the audit trail, excluded from balances.
 * `reversed` — a confirmed payment later undone by a reversal entry.
 */
export type PaymentStatus = 'pending' | 'confirmed' | 'rejected' | 'reversed';

/**
 * A payment is append-only. Corrections never mutate or delete a confirmed row —
 * they create a reversing entry that references it via `reversesPaymentId`. This
 * is what makes the books auditable and is why members can trust the numbers.
 */
export interface Payment {
  id: Uuid;
  groupId: Uuid;
  memberId: Uuid;
  amount: Minor;
  method: PaymentMethod;
  status: PaymentStatus;
  /** When the money actually changed hands — not when the row was created. */
  paidAt: IsoDateTime;
  reference: string | null;
  note: string | null;
  receiptUrl: string | null;
  recordedByMemberId: Uuid;
  confirmedByMemberId: Uuid | null;
  /** Set when this row reverses an earlier payment. */
  reversesPaymentId: Uuid | null;
  createdAt: IsoDateTime;
}

/**
 * Links money received to what it settles. Splitting payments from allocations is
 * what lets a single ₵200 payment clear two months of arrears plus part of a levy,
 * and lets a member pay ahead of schedule without corrupting per-cycle reporting.
 */
export interface Allocation {
  id: Uuid;
  paymentId: Uuid;
  /** Null when the payment is unallocated (e.g. an `open` plan donation or credit on account). */
  obligationId: Uuid | null;
  planId: Uuid | null;
  amount: Minor;
}

/* -------------------------------------------------------------------------- */
/* Money out                                                                   */
/* -------------------------------------------------------------------------- */

export type ExpenseStatus = 'pending' | 'approved' | 'rejected';

export interface Expense {
  id: Uuid;
  groupId: Uuid;
  title: string;
  category: string;
  amount: Minor;
  status: ExpenseStatus;
  spentAt: IsoDateTime;
  note: string | null;
  receiptUrl: string | null;
  recordedByMemberId: Uuid;
  approvedByMemberId: Uuid | null;
  createdAt: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* Rotating savings (susu)                                                     */
/* -------------------------------------------------------------------------- */

/** One member's turn to collect the pot in a rotating plan. */
export interface RotationSlot {
  id: Uuid;
  planId: Uuid;
  cycleId: Uuid;
  memberId: Uuid;
  position: number;
  expectedPayout: Minor;
  paidOutAmount: Minor | null;
  paidOutAt: IsoDateTime | null;
}

/* -------------------------------------------------------------------------- */
/* Derived views — computed, never stored                                      */
/* -------------------------------------------------------------------------- */

/** A member's standing, as shown on their profile and the leaderboard. */
export interface MemberStanding {
  memberId: Uuid;
  totalDue: Minor;
  totalPaid: Minor;
  /** Positive means the member owes the group; negative means they are in credit. */
  balance: Minor;
  /** Share of obligations settled on time, 0–100. */
  onTimeRate: number;
  /** Consecutive fully-paid cycles, used for streak badges. */
  streak: number;
}

/** Headline figures for the group dashboard. */
export interface GroupSummary {
  groupId: Uuid;
  /** Confirmed money in, minus approved money out. */
  cashOnHand: Minor;
  totalCollected: Minor;
  totalExpenses: Minor;
  outstanding: Minor;
  activeMembers: number;
  /** Share of the current cycle's obligations settled, 0–100. */
  collectionRate: number;
}
