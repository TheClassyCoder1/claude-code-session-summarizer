import { writeDecision } from "@/lib/approvals";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { sessionId, decision } = await request.json();
    await writeDecision(sessionId, decision);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: "invalid request" }, { status: 400 });
  }
}
