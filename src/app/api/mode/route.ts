import { writeMode } from "@/lib/approvals";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { mode } = await request.json();
    const set = await writeMode(mode);
    return Response.json({ ok: true, mode: set });
  } catch {
    return Response.json({ ok: false, error: "invalid mode" }, { status: 400 });
  }
}
