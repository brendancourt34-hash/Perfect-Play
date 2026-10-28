/**
 * Structured operational logging — Perfect Play has no external error-reporting/APM
 * service connected (Sentry, Datadog, etc. — none configured anywhere in this codebase),
 * so this is a clean, consistent structured-log HOOK rather than a fake integration. Every
 * call produces one single-line JSON object to stdout/stderr, which is exactly the shape
 * every existing ad-hoc `console.error(JSON.stringify({...}))` call site in this codebase
 * already produced (see settlement.ts's prize_credit_failed/rollover_push_failed) — this
 * module just gives that pattern one name and one place to extend, so a real log
 * aggregator (Datadog, CloudWatch, etc.) can be pointed at stdout later without touching
 * every call site again.
 *
 * NEVER log: passwords, password hashes, session tokens, payment credentials, full
 * card/bank details, or any other secret. Every call site in this codebase only ever
 * passes ids, amounts (cents), codes, and short enums — see each call site's own comment.
 */

export type LogLevel = "info" | "warn" | "error";

/** Every event name this codebase actually emits — kept as a literal union (not a bare string) so a typo in an event name is a compile error, not a silently-unsearchable log line. */
export type MonitoringEvent =
  | "package_purchase_succeeded"
  | "package_purchase_failed"
  | "package_purchase_idempotent_replay"
  | "package_purchase_cap_exceeded"
  | "wallet_debit"
  | "wallet_credit"
  | "entry_created"
  | "duplicate_purchase_request"
  | "cutoff_rejected"
  | "max_entry_cap_rejected"
  | "settlement_started"
  | "settlement_completed"
  | "settlement_failed"
  | "rollover_started"
  | "rollover_completed"
  | "rollover_failed"
  | "payment_confirmed"
  | "withdrawal_requested"
  | "withdrawal_status_changed"
  | "refund_issued"
  | "refund_anomaly"
  | "provider_sync_failed"
  | "round_generation_failed"
  | "auto_selection_failed"
  | "missing_player_data"
  | "entry_selection_count_mismatch"
  | "perfect_play_moment_created"
  | "customer_event_broadcast"
  | "sports_data_sync_started"
  | "sports_data_sync_completed"
  | "round_lock_failed"
  | "push_token_registered"
  | "push_token_removed"
  | "push_send_succeeded"
  | "push_send_failed"
  | "push_token_invalid";

/** Never a secret/credential/PII value — every call site here only ever passes ids, enums, and integer cent amounts. */
export type LogFields = Record<string, string | number | boolean | null | undefined>;

const REDACTED_KEY_PATTERN = /password|secret|token|credential|card|cvv|pan\b/i;

/** Defense-in-depth: strips any field whose KEY looks sensitive, even if a future call site accidentally passes one — never trusts every call site to have gotten it right by convention alone. */
function sanitize(fields: LogFields): LogFields {
  const clean: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    clean[key] = REDACTED_KEY_PATTERN.test(key) ? "[redacted]" : value;
  }
  return clean;
}

/**
 * Emits one structured JSON log line for an operationally-significant event (see
 * MonitoringEvent for the full catalogue this codebase currently emits). `level` defaults
 * to "info" — most of these events are normal, expected occurrences (a successful
 * purchase, a completed settlement), not failures; pass "warn"/"error" explicitly for the
 * failure-shaped events.
 */
export function logEvent(event: MonitoringEvent, fields: LogFields = {}, level: LogLevel = "info"): void {
  const line = JSON.stringify({ event, level, at: new Date().toISOString(), ...sanitize(fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
