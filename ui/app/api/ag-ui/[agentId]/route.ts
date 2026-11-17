import { and, eq } from "drizzle-orm";
import { after, NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { threads } from "@/db/schema";
import { admitRun } from "@/lib/run-limits";
import { backendFetch, getSession } from "@/lib/server";

type RunInput = {
  threadId?: unknown;
  messages?: { role?: string; content?: unknown }[];
  [key: string]: unknown;
};

function lastUserText(messages: RunInput["messages"]): string {
  const content = messages?.findLast((m) => m.role === "user")?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((part) => (part?.type === "text" ? part.text : "")).join(" ")
        : "";
  return text.trim().replace(/\s+/g, " ");
}

/** Replaces the placeholder title with one from the title model, unless the user renamed it first. */
async function autoTitle(threadId: string, text: string, placeholder: string) {
  try {
    const res = await backendFetch("/title", { method: "POST", body: JSON.stringify({ text }) });
    if (!res.ok) return;
    const { title } = (await res.json()) as { title?: string };
    if (!title?.trim()) return;
    await db
      .update(threads)
      .set({ title: title.trim().slice(0, 200) })
      .where(and(eq(threads.id, threadId), eq(threads.title, placeholder)));
  } catch {
    // The placeholder stays; titles are cosmetic.
  }
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
    const text = lastUserText(input.messages);
    const placeholder = text ? text.slice(0, 80) : "New chat";
    await db.insert(threads).values({ id: threadId, userId, agentId, modelId: model ?? null, title: placeholder });
    // Starts now, alongside the run; `after` keeps the function alive until it settles.
    if (text) after(autoTitle(threadId, text, placeholder));
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
