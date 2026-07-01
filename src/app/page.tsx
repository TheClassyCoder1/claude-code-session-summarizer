import FeatureDashboard from "@/components/FeatureDashboard";
import AutoRefresh from "@/components/AutoRefresh";
import TabBadge from "@/components/TabBadge";
import ModeToggle from "@/components/ModeToggle";
import { readFeatureRecords } from "@/lib/featureLog";
import { deriveStatus } from "@/lib/featureTypes";
import { readMode, readPendingApprovals } from "@/lib/approvals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Home() {
  const [records, mode, pending] = await Promise.all([
    readFeatureRecords(),
    readMode(),
    readPendingApprovals(),
  ]);
  const pendingBySession = Object.fromEntries(pending.map((p) => [p.sessionId, p]));
  const attention =
    pending.length +
    records.filter((r) => {
      const s = deriveStatus(r);
      return s === "awaiting_approval" || s === "idle";
    }).length;

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <header className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Claude Session Dashboard</h1>
            <p className="text-sm text-slate-500">
              What you built with Claude Code — per session, with token usage and cost.
            </p>
          </div>
          <ModeToggle mode={mode} />
        </header>
        <FeatureDashboard records={records} pendingBySession={pendingBySession} />
      </div>
      <AutoRefresh />
      <TabBadge count={attention} />
    </main>
  );
}
