import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { threads } from "@/db/schema";
import { admitRun } from "@/lib/run-limits";
import { backendFetch, getSession } from "@/lib/server";

type RunInput = {
  threadId?: unknown;
  messages?: { role?: string; content?: unknown }[];
  [key: string]: unknown;
};

function titleFrom(messages: RunInput["messages"]): string {
  const content = messages?.findLast((m) => m.role === "user")?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((part) => (part?.type === "text" ? part.text : "")).join(" ")
        : "";
  const line = text.trim().replace(/\s+/g, " ");
  return line ? line.slice(0, 80) : "New chat";
}

/** Authenticates, applies run limits and thread ownership, then streams the backend's SSE through. */
export async function POST(req: NextRequest, context: { params: Promise<{ agentId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { agentId } = await context.params;
  const model = req.nextUrl.searchParams.get("model") || undefined;
  const input = (await req.json()) as RunInput;
  if (typeof input.threadId !== "string" || !input.threadId) {
    return NextResponse.json({ error: "threadId is required" }, { status: 400 });
  }
  const threadId = input.threadId;
  const userId = session.user.id;

  const [existing] = await db.select({ userId: threads.userId }).from(threads).where(eq(threads.id, threadId));
  if (existing && existing.userId !== userId) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const denial = await admitRun(session.user);
  if (denial) return NextResponse.json({ error: "run_limit", ...denial }, { status: 429 });

  if (existing) {
    await db
      .update(threads)
      .set({ agentId, modelId: model ?? null, updatedAt: new Date() })
      .where(and(eq(threads.id, threadId), eq(threads.userId, userId)));
  } else {
    await db
      .insert(threads)
      .values({ id: threadId, userId, agentId, modelId: model ?? null, title: titleFrom(input.messages) });
  }

  const upstream = await backendFetch(`/${encodeURIComponent(agentId)}/ag-ui`, {
    method: "POST",
    headers: { Accept: "text/event-stream" },
    // Identity and model are set here, never taken from the browser.
    body: JSON.stringify({ ...input, forwardedProps: { user_id: userId, ...(model ? { model } : {}) } }),
    signal: req.signal,
  });

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
