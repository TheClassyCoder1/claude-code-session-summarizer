import Board from "@/components/Board";
import { listCards } from "@/lib/store";

// Read fresh from the store on each request.
export const dynamic = "force-dynamic";

export default async function Home() {
  const cards = await listCards();

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">claude-kanban</h1>
          <p className="text-sm text-slate-500">
            A simple board — drag cards between columns, or let Claude break a
            goal into tasks.
          </p>
        </header>
        <Board initialCards={cards} />
      </div>
    </main>
  );
}
