import { cn } from "@/lib/utils/format";

const STYLES: Record<string, string> = {
  pending: "bg-surface-raised text-muted border-border",
  paid: "bg-brand-soft text-brand-text border-brand/30",
  failed: "bg-danger-soft text-danger border-danger/30",
  cancelled: "bg-surface-raised text-muted border-border",
  refunded: "bg-gold-soft text-gold border-gold/40",
};

/** Displays the existing competition_entries.paymentStatus value — never invents a state. */
export function PaymentStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
        STYLES[status] ?? STYLES.pending,
        className,
      )}
    >
      {status}
    </span>
  );
}
