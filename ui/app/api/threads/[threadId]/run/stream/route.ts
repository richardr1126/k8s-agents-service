import { NextRequest, NextResponse } from "next/server";
import { backendFetch } from "@/lib/server";
import { ownedThread } from "@/lib/owned-thread";

// Streams for as long as the reply runs; past this the client reconnects from where it was.
export const maxDuration = 300;

/** The running reply's events from `since` on: rejoining after a dropped stream or a reload. */
export async function GET(req: NextRequest, context: { params: Promise<{ threadId: string }> }) {
  const owned = await ownedThread(context);
  if ("status" in owned) return NextResponse.json({ error: "Thread not found" }, { status: owned.status });
  const since = Math.max(0, Number(req.nextUrl.searchParams.get("since")) || 0);
  const upstream = await backendFetch(
    `/${encodeURIComponent(owned.agent)}/ag-ui/${encodeURIComponent(owned.threadId)}/live?since=${since}`,
    { headers: { Accept: "text/event-stream" }, signal: req.signal },
  );
  if (upstream.status === 404) return NextResponse.json({ error: "No reply is running" }, { status: 404 });
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
