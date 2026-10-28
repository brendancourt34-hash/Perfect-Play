import { and, desc, eq, notInArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { WithdrawalStatus } from "@/db/schema";
import { debitWallet, getBalance } from "./wallet";
import { logEvent } from "@/lib/monitoring/log";
import { safeQuery, type DataResult } from "./result";

export type Withdrawal = typeof schema.withdrawals.$inferSelect;

/** Statuses a withdrawal can still move on from — once completed/rejected/cancelled it is permanently terminal. */
const TERMINAL_STATUSES: readonly WithdrawalStatus[] = ["completed", "rejected", "cancelled"];

export type RequestWithdrawalResult =
  | { status: "ok"; withdrawal: Withdrawal }
  | { status: "insufficient_funds"; balanceCents: number; requiredCents: number }
  | { status: "unavailable"; message: string };

/**
 * Records a withdrawal request only — never touches the wallet balance (see the
 * withdrawals table's doc comment in src/db/schema.ts). The balance is re-checked here
 * purely for UX (no point accepting a request the user obviously can't cover), but the
 * authoritative, actually-balance-affecting check happens again at completion time in
 * completeWithdrawal, since the balance can legitimately change between request and
 * processing (e.g. more deposits, or another withdrawal completing first).
 */
export async function requestWithdrawal(userId: number, amountCents: number): Promise<RequestWithdrawalResult> {
  if (amountCents <= 0) return { status: "unavailable", message: "Withdrawal amount must be positive." };

  const balanceResult = await getBalance(userId);
  if (balanceResult.status === "unavailable") return balanceResult;
  if (balanceResult.data < amountCents) {
    return { status: "insufficient_funds", balanceCents: balanceResult.data, requiredCents: amountCents };
  }

  const result = await safeQuery(async () => {
    const [row] = await getDb().insert(schema.withdrawals).values({ userId, amountCents, status: "requested" }).returning();
    return row;
  });
  if (result.status === "unavailable") return result;
  logEvent("withdrawal_requested", { userId, withdrawalId: result.data.id, amountCents });
  return { status: "ok", withdrawal: result.data };
}

export async function listWithdrawalsForUser(userId: number): Promise<DataResult<Withdrawal[]>> {
  return safeQuery(() => getDb().select().from(schema.withdrawals).where(eq(schema.withdrawals.userId, userId)).orderBy(desc(schema.withdrawals.requestedAt)));
}

export interface AdminWithdrawalSummary extends Withdrawal {
  userEmail: string;
}

/** Admin queue view — joins in the requesting user's email so the admin doesn't have to cross-reference a bare userId. */
export async function listAllWithdrawals(): Promise<DataResult<AdminWithdrawalSummary[]>> {
  return safeQuery(async () => {
    const rows = await getDb()
      .select({ withdrawal: schema.withdrawals, userEmail: schema.users.email })
      .from(schema.withdrawals)
      .innerJoin(schema.users, eq(schema.users.id, schema.withdrawals.userId))
      .orderBy(desc(schema.withdrawals.requestedAt));
    return rows.map((r) => ({ ...r.withdrawal, userEmail: r.userEmail }));
  });
}

export type UpdateWithdrawalStatusResult =
  | { status: "ok"; withdrawal: Withdrawal }
  | { status: "not_found" }
  | { status: "already_terminal"; currentStatus: WithdrawalStatus }
  | { status: "insufficient_funds"; balanceCents: number; requiredCents: number }
  | { status: "unavailable"; message: string };

/**
 * Admin-only status transition. Only a transition INTO "completed" ever touches the
 * wallet. Rejecting or cancelling a request never touches the balance, since nothing was
 * ever deducted at request time. A withdrawal already in a terminal state can never be
 * transitioned again — the ledger/status history is immutable once final.
 *
 * Every transition (not just "completed") claims the new status via a single atomic
 * conditional UPDATE (`WHERE status NOT IN (terminal)`), never a read-then-write check —
 * this is a genuine defect fixed in this audit: the previous read-then-check let two
 * concurrent "complete this withdrawal" admin actions (two admins, or one admin's
 * double-click/retried request) both pass the non-atomic terminal-status check and both
 * call debitWallet, double-debiting the customer for one real withdrawal request. Now, at
 * most one caller's claim can ever succeed; a loser sees zero rows affected and reports
 * the real current status as already_terminal, exactly as if it had arrived a moment
 * later. debitWallet's own relatedWithdrawalId idempotency guard (src/lib/data/wallet.ts)
 * is a second, independent backstop against the same double-debit, enforced by the
 * database itself.
 *
 * If the claim succeeds but the subsequent debit fails (insufficient funds — the balance
 * can legitimately have dropped since the request was made — or a transient DB error),
 * the claim is compensated: the withdrawal's status is reverted to what it was before
 * this call, so it never gets stuck permanently showing "completed" with no money ever
 * actually having moved.
 */
export async function updateWithdrawalStatus(withdrawalId: number, newStatus: WithdrawalStatus, adminNote?: string): Promise<UpdateWithdrawalStatusResult> {
  const db = getDb();
  const preCheck = await safeQuery(async () => {
    const rows = await db.select().from(schema.withdrawals).where(eq(schema.withdrawals.id, withdrawalId)).limit(1);
    return rows[0] ?? null;
  });
  if (preCheck.status === "unavailable") return preCheck;
  const existing = preCheck.data;
  if (!existing) return { status: "not_found" };

  const isTerminalTarget = TERMINAL_STATUSES.includes(newStatus);
  const claimResult = await safeQuery(async () => {
    const rows = await db
      .update(schema.withdrawals)
      .set({ status: newStatus, adminNote: adminNote ?? existing.adminNote, processedAt: isTerminalTarget ? new Date() : existing.processedAt })
      .where(and(eq(schema.withdrawals.id, withdrawalId), notInArray(schema.withdrawals.status, [...TERMINAL_STATUSES])))
      .returning();
    return rows[0] ?? null;
  });
  if (claimResult.status === "unavailable") return claimResult;
  if (!claimResult.data) {
    const currentRows = await db.select().from(schema.withdrawals).where(eq(schema.withdrawals.id, withdrawalId)).limit(1);
    return { status: "already_terminal", currentStatus: currentRows[0]?.status ?? existing.status };
  }
  const claimed = claimResult.data;
  logEvent("withdrawal_status_changed", { withdrawalId, userId: existing.userId, fromStatus: existing.status, toStatus: newStatus });

  if (newStatus !== "completed") {
    return { status: "ok", withdrawal: claimed };
  }

  const debitResult = await debitWallet(existing.userId, existing.amountCents, "withdrawal", "Perfect Play Balance withdrawal", { relatedWithdrawalId: withdrawalId });
  if (debitResult.status === "ok") {
    return { status: "ok", withdrawal: claimed };
  }

  // The debit failed after we already claimed "completed" — compensate by reverting to
  // the pre-claim status rather than leaving a "completed" withdrawal with no real debit.
  logEvent(
    "refund_anomaly",
    { withdrawalId, userId: existing.userId, reason: "completed_status_claimed_but_debit_failed", message: debitResult.status === "unavailable" ? debitResult.message : "insufficient_funds" },
    "error",
  );
  await db.update(schema.withdrawals).set({ status: existing.status, processedAt: existing.processedAt }).where(eq(schema.withdrawals.id, withdrawalId));
  return debitResult;
}
