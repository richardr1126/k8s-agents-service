import { NextResponse } from "next/server";
import { backendFetch, getSession } from "@/lib/server";

/** A background job of the signed-in user's, from the backend. */
export async function GET(_req: Request, context: { params: Promise<{ jobId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { jobId } = await context.params;
  if (!/^job-[a-f0-9]{12}$/.test(jobId)) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const res = await backendFetch(
    `/jobs/${encodeURIComponent(jobId)}?user_id=${encodeURIComponent(session.user.id)}`,
  );
  if (res.status === 404) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (!res.ok) return NextResponse.json({ error: "Failed to load the job" }, { status: 502 });
  return NextResponse.json(await res.json(), { headers: { "Cache-Control": "no-store" } });
}
