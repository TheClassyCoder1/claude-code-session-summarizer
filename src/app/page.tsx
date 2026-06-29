import FeatureDashboard from "@/components/FeatureDashboard";
import AutoRefresh from "@/components/AutoRefresh";
import TabBadge from "@/components/TabBadge";
import { readFeatureRecords } from "@/lib/featureLog";
import { deriveStatus } from "@/lib/featureTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Home() {
  const records = await readFeatureRecords();
  const attention = records.filter((r) => {
    const s = deriveStatus(r);
    return s === "awaiting_approval" || s === "idle";
  }).length;

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">claude-code-summarizer</h1>
          <p className="text-sm text-slate-500">
            What you built with Claude Code — per session, with token usage and cost.
          </p>
        </header>
        <FeatureDashboard records={records} />
      </div>
      <AutoRefresh />
      <TabBadge count={attention} />
    </main>
  );
}
