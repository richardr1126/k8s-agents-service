import { eq } from "drizzle-orm";
import { db } from "@/db";
import { threads } from "@/db/schema";
import { backendFetch } from "@/lib/server";

/**
 * Deletes a user's conversations in the agent service. Their rows here go
 * with the user (ON DELETE CASCADE), but the checkpoints live in the backend.
 */
export async function deleteBackendThreads(userId: string): Promise<void> {
  const rows = await db.select({ id: threads.id }).from(threads).where(eq(threads.userId, userId));
  const results = await Promise.allSettled(
    rows.map(async ({ id }) => {
      const res = await backendFetch("/thread", { method: "DELETE", body: JSON.stringify({ thread_id: id }) });
      if (!res.ok) throw new Error(`thread ${id}: ${res.status}`);
    }),
  );
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length) throw new Error(`Couldn't delete ${failed.length} of ${rows.length} conversations in the agent service`);
}
