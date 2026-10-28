import { getCurrentPublishedTerms } from "@/lib/data/terms";
import { DataUnavailable } from "@/components/data-unavailable";
import { EmptyState } from "@/components/empty-state";
import { formatAuDate } from "@/lib/utils/format";

export const metadata = { title: "Terms & Conditions — Perfect Play" };

export default async function TermsPage() {
  const result = await getCurrentPublishedTerms();

  if (result.status === "unavailable") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <DataUnavailable context="Terms & Conditions" />
      </div>
    );
  }

  if (!result.data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <EmptyState title="Terms & Conditions not yet published" description="Check back soon." />
      </div>
    );
  }

  const terms = result.data;

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Terms &amp; Conditions</h1>
      <p className="mt-2 text-sm text-muted-2">
        Version {terms.versionNumber} — effective {formatAuDate(terms.effectiveDate)}
      </p>
      <p className="mt-4 rounded-lg border border-border bg-surface-raised p-4 text-sm text-muted">
        This is a DRAFT pending regulatory and legal review. Licensed operator details will appear here. Eligibility
        and participation requirements apply. Final terms are subject to regulatory and legal approval.
      </p>

      <div className="mt-8 space-y-8">
        {terms.content.map((section, i) => (
          <section key={i}>
            <h2 className="text-base font-semibold text-foreground">{section.heading}</h2>
            <p className="mt-2 whitespace-pre-line text-sm text-muted">{section.body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
