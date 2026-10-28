import { PlatformSettingsPanel } from "@/components/admin/platform-settings-panel";
import { getMaxEntriesPerRound, getPrizePoolAllocationBps } from "@/lib/data/platform-settings";
import { listAllEntryPackages } from "@/lib/data/entry-packages";

export default async function AdminSettingsPage() {
  const [maxEntriesResult, packagesResult, prizePoolAllocationBpsResult] = await Promise.all([
    getMaxEntriesPerRound(),
    listAllEntryPackages(),
    getPrizePoolAllocationBps(),
  ]);
  if (maxEntriesResult.status === "unavailable" || packagesResult.status === "unavailable" || prizePoolAllocationBpsResult.status === "unavailable") {
    return <p className="text-sm text-danger">Data is temporarily unavailable. Try again shortly.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-bold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Platform-wide, admin-configurable rules — never hard-coded in application logic. Changes here apply only to
          entries/purchases made from now on; anything already purchased keeps the price and entry count it actually
          paid, permanently.
        </p>
      </div>
      <PlatformSettingsPanel
        initialMaxEntries={maxEntriesResult.data}
        initialPackages={packagesResult.data}
        initialPrizePoolAllocationBps={prizePoolAllocationBpsResult.data}
      />
    </div>
  );
}
