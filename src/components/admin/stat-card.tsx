import { cn } from "@/lib/utils/format";

export function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: "brand" | "gold" | "danger" }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-bold",
          tone === "brand" ? "text-brand-text" : tone === "gold" ? "text-gold" : tone === "danger" ? "text-danger" : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function StatGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">{title}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{children}</div>
    </section>
  );
}
