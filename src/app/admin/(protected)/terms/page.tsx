import { TermsAdminPanel } from "@/components/admin/terms-admin-panel";
import { listTermsVersions } from "@/lib/data/terms";

export default async function AdminTermsPage() {
  const result = await listTermsVersions();
  if (result.status === "unavailable") {
    return <p className="text-sm text-danger">{result.message}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-bold text-foreground">Terms & Conditions</h1>
        <p className="mt-1 text-sm text-muted">
          DRAFT content pending real Australian gambling-law legal review — never treat a version here as final or
          legally reviewed. Publishing a new version archives whatever was published before; a published or archived
          version is permanently immutable so a user&apos;s historical acceptance always points at exactly what they
          agreed to.
        </p>
      </div>
      <TermsAdminPanel
        initialVersions={result.data.map((v) => ({
          id: v.id,
          versionNumber: v.versionNumber,
          effectiveDate: v.effectiveDate,
          publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
          status: v.status,
          content: v.content,
          createdAt: v.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
