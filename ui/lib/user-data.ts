import { eq } from "drizzle-orm";
import { db } from "@/db";
import { threads } from "@/db/schema";
import { backendFetch } from "@/lib/server";

/**
 * Deletes what a user has in the agent service: each conversation (with its
 * background jobs and their files), then any jobs left over. Their rows here go
 * with the user (ON DELETE CASCADE), but this data lives in the backend.
 */
export async function deleteBackendData(userId: string): Promise<void> {
  const rows = await db.select({ id: threads.id }).from(threads).where(eq(threads.userId, userId));
  const results = await Promise.allSettled(
    rows.map(async ({ id }) => {
      const res = await backendFetch("/thread", { method: "DELETE", body: JSON.stringify({ thread_id: id }) });
      if (!res.ok) throw new Error(`thread ${id}: ${res.status}`);
      // Gone in the backend, so a retry after a partial failure skips it.
      await db.delete(threads).where(eq(threads.id, id));
    }),
  );
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length) throw new Error(`Couldn't delete ${failed.length} of ${rows.length} conversations in the agent service`);
  const res = await backendFetch(`/user/${encodeURIComponent(userId)}/data`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Couldn't delete the account's background jobs in the agent service (${res.status})`);
}

/** Gives a guest's background jobs to the account they signed up or in with. */
export async function moveBackendData(fromUserId: string, toUserId: string): Promise<void> {
  const res = await backendFetch(`/user/${encodeURIComponent(fromUserId)}/data/move`, {
    method: "POST",
    body: JSON.stringify({ to_user_id: toUserId }),
  });
  if (!res.ok) throw new Error(`Couldn't move the guest's background jobs in the agent service (${res.status})`);
}
