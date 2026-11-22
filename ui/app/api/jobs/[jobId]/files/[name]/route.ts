import { NextResponse } from "next/server";
import { backendFetch, getSession } from "@/lib/server";

/** A file a background job of the signed-in user's produced, such as a podcast episode. */
export async function GET(req: Request, context: { params: Promise<{ jobId: string; name: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { jobId, name } = await context.params;
  if (!/^job-[a-f0-9]{12}$/.test(jobId) || !/^[\w.-]{1,100}$/.test(name)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  const range = req.headers.get("range");
  const res = await backendFetch(
    `/jobs/${encodeURIComponent(jobId)}/files/${encodeURIComponent(name)}?user_id=${encodeURIComponent(session.user.id)}`,
    { headers: range ? { Range: range } : {} },
  );
  if (res.status === 404) return NextResponse.json({ error: "File not found" }, { status: 404 });
  if (!res.ok && res.status !== 416) return NextResponse.json({ error: "Failed to load the file" }, { status: 502 });
  const headers = new Headers({ "Cache-Control": "private, max-age=3600", "Accept-Ranges": "bytes" });
  for (const h of ["content-type", "content-length", "content-range"]) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (new URL(req.url).searchParams.has("download")) headers.set("Content-Disposition", `attachment; filename="${name}"`);
  return new NextResponse(res.body, { status: res.status, headers });
}
