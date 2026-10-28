import { SimulationTool } from "@/components/admin/simulation-tool";

export default function AdminSimulationPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold text-foreground">Perfect Rate Simulation</h1>
        <p className="mt-1 text-sm text-muted">
          Internal modeling tool for testing Perfect Play&apos;s mathematical behaviour with no real money and no real
          customers. Compare the EXPECTED PERFECT rate here against the ACTUAL PERFECT rate on the Dashboard once a
          round has settled.
        </p>
      </div>
      <SimulationTool />
    </div>
  );
}
