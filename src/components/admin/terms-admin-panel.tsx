"use client";

import { useState } from "react";
import { formatAuDate, formatAuDateTime } from "@/lib/utils/format";

interface TermsSectionInput {
  heading: string;
  body: string;
}

interface TermsVersionRow {
  id: number;
  versionNumber: string;
  effectiveDate: string;
  publishedAt: string | null;
  status: "draft" | "published" | "archived";
  content: TermsSectionInput[];
  createdAt: string;
}

const EMPTY_SECTION: TermsSectionInput = { heading: "", body: "" };

/**
 * Admin Terms & Conditions manager (Phase 23): create a draft, edit it, preview it, and
 * publish it. Publishing archives whatever was previously published — see
 * src/lib/data/terms.ts:publishTermsVersion. A published or archived version can never be
 * edited again (immutability preserves what a user's historical acceptance actually
 * pointed at); to change published content, create and publish a new draft version.
 */
export function TermsAdminPanel({ initialVersions }: { initialVersions: TermsVersionRow[] }) {
  const [versions, setVersions] = useState(initialVersions);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [acceptanceCount, setAcceptanceCount] = useState<number | null>(null);

  const [versionNumber, setVersionNumber] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [sections, setSections] = useState<TermsSectionInput[]>([{ ...EMPTY_SECTION }]);

  const selected = versions.find((v) => v.id === selectedId) ?? null;

  function startNewDraft() {
    setSelectedId(null);
    setVersionNumber("");
    setEffectiveDate("");
    setSections([{ ...EMPTY_SECTION }]);
    setError(null);
    setAcceptanceCount(null);
  }

  async function selectVersion(v: TermsVersionRow) {
    setSelectedId(v.id);
    setVersionNumber(v.versionNumber);
    setEffectiveDate(v.effectiveDate);
    setSections(v.content.length ? v.content : [{ ...EMPTY_SECTION }]);
    setError(null);
    setAcceptanceCount(null);
    const res = await fetch(`/api/admin/terms/${v.id}/acceptances`, { credentials: "include" });
    const body = await res.json();
    if (body.ok) setAcceptanceCount(body.data.acceptances.length);
  }

  function updateSection(index: number, field: keyof TermsSectionInput, value: string) {
    setSections((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }

  function addSection() {
    setSections((prev) => [...prev, { ...EMPTY_SECTION }]);
  }

  function removeSection(index: number) {
    setSections((prev) => prev.filter((_, i) => i !== index));
  }

  async function saveDraft() {
    setError(null);
    if (!versionNumber.trim() || !effectiveDate.trim()) {
      setError("Version number and effective date are required.");
      return;
    }
    const cleanSections = sections.map((s) => ({ heading: s.heading.trim(), body: s.body.trim() })).filter((s) => s.heading && s.body);
    if (cleanSections.length === 0) {
      setError("At least one section with a heading and body is required.");
      return;
    }

    setSaving(true);
    const isNew = selectedId === null;
    const res = await fetch(isNew ? "/api/admin/terms" : `/api/admin/terms/${selectedId}`, {
      method: isNew ? "POST" : "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionNumber: versionNumber.trim(), effectiveDate, content: cleanSections }),
    });
    const body = await res.json();
    setSaving(false);
    if (!body.ok) {
      setError(body.errors?.[0] ?? body.message ?? "Save failed.");
      return;
    }
    const saved: TermsVersionRow = body.data.version;
    setVersions((prev) => (isNew ? [saved, ...prev] : prev.map((v) => (v.id === saved.id ? saved : v))));
    setSelectedId(saved.id);
  }

  async function publish() {
    if (!selectedId) return;
    setPublishing(true);
    setError(null);
    const res = await fetch(`/api/admin/terms/${selectedId}/publish`, { method: "POST", credentials: "include" });
    const body = await res.json();
    setPublishing(false);
    if (!body.ok) {
      setError(body.message ?? "Publish failed.");
      return;
    }
    const published: TermsVersionRow = body.data.version;
    setVersions((prev) => prev.map((v) => (v.id === published.id ? published : v.status === "published" ? { ...v, status: "archived" } : v)));
  }

  const isEditable = selected === null || selected.status === "draft";

  return (
    <div className="grid grid-cols-[280px_1fr] gap-6">
      <div className="flex flex-col gap-2">
        <button onClick={startNewDraft} className="rounded-md bg-brand px-3 py-1.5 text-left text-sm font-bold text-black">
          + New draft
        </button>
        {versions.map((v) => (
          <button
            key={v.id}
            onClick={() => selectVersion(v)}
            className={`rounded-md border px-3 py-2 text-left text-sm ${selectedId === v.id ? "border-brand text-foreground" : "border-border text-muted hover:text-foreground"}`}
          >
            <div className="font-bold">v{v.versionNumber}</div>
            <div className="text-xs uppercase tracking-wide">{v.status}</div>
            <div className="text-xs">{formatAuDate(v.effectiveDate)}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4">
        {error && <p className="text-sm text-danger">{error}</p>}

        {selected && (
          <div className="text-xs text-muted">
            {selected.status === "published" && selected.publishedAt && `Published ${formatAuDateTime(selected.publishedAt)}. `}
            {acceptanceCount !== null && `${acceptanceCount} user${acceptanceCount === 1 ? "" : "s"} accepted this version.`}
          </div>
        )}

        <div className="flex gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Version number
            <input
              value={versionNumber}
              onChange={(e) => setVersionNumber(e.target.value)}
              disabled={!isEditable}
              placeholder="e.g. 1.1"
              className="w-32 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-50"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Effective date
            <input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              disabled={!isEditable}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-50"
            />
          </label>
        </div>

        <div className="flex flex-col gap-3">
          {sections.map((section, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wide text-muted">Section {i + 1}</span>
                {isEditable && sections.length > 1 && (
                  <button onClick={() => removeSection(i)} className="text-xs text-muted hover:text-foreground">
                    Remove
                  </button>
                )}
              </div>
              <input
                value={section.heading}
                onChange={(e) => updateSection(i, "heading", e.target.value)}
                disabled={!isEditable}
                placeholder="Heading"
                className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm font-bold text-foreground disabled:opacity-50"
              />
              <textarea
                value={section.body}
                onChange={(e) => updateSection(i, "body", e.target.value)}
                disabled={!isEditable}
                placeholder="Body"
                rows={4}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-50"
              />
            </div>
          ))}
          {isEditable && (
            <button onClick={addSection} className="self-start rounded-md border border-border px-3 py-1.5 text-xs font-bold text-foreground">
              + Add section
            </button>
          )}
        </div>

        {isEditable && (
          <div className="flex gap-3">
            <button onClick={saveDraft} disabled={saving} className="rounded-md bg-brand px-3 py-1.5 text-sm font-bold text-black disabled:opacity-50">
              {saving ? "Saving…" : "Save draft"}
            </button>
            {selectedId !== null && (
              <button onClick={publish} disabled={publishing} className="rounded-md border border-border px-3 py-1.5 text-sm font-bold text-foreground disabled:opacity-50">
                {publishing ? "Publishing…" : "Publish"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
