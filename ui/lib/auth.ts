import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { anonymous } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";

const github =
  process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
    ? { github: { clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET } }
    : {};

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL || "http://localhost:3000",
  emailAndPassword: { enabled: true },
  socialProviders: github,
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  advanced: {
    // A repo-specific prefix keeps cookies apart from other Better Auth apps on localhost.
    cookiePrefix: process.env.BETTER_AUTH_COOKIE_PREFIX || "k8s-agents-auth",
  },
  plugins: [
    anonymous({
      // Runs before the plugin deletes the guest, whose threads would otherwise cascade away.
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        if (newUser.user.id === anonymousUser.user.id || newUser.user.isAnonymous) return;
        await db
          .update(schema.threads)
          .set({ userId: newUser.user.id })
          .where(eq(schema.threads.userId, anonymousUser.user.id));
      },
    }),
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
