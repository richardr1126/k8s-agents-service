import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { anonymous } from "better-auth/plugins";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { baseUrl } from "@/lib/base-url";
import { actionEmail, sendMail } from "@/lib/email";
import { getMailer, getSettings } from "@/lib/settings/store";
import { deleteBackendThreads } from "@/lib/user-data";

/** Whether GitHub sign-in is configured; the sign-in page shows the button only then. */
export const githubSignIn = Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);

const github = githubSignIn
  ? { github: { clientId: process.env.GITHUB_CLIENT_ID!, clientSecret: process.env.GITHUB_CLIENT_SECRET! } }
  : {};

export type AccessStatus = "active" | "pending" | "suspended";

export const ACCESS_MESSAGES: Record<Exclude<AccessStatus, "active">, string> = {
  pending: "Your account is waiting for an admin to approve it.",
  suspended: "This account has been suspended.",
};

/** Better Auth options fixed when the instance is built; one instance per combination. */
type AuthConfig = { email: boolean };

function buildAuth({ email }: AuthConfig) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema }),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: baseUrl(),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: email,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      ...(email && {
        sendResetPassword: async ({ user, url }) => {
          await sendMail(
            actionEmail({
              to: user.email,
              subject: "Reset your password",
              intro: "Someone asked to reset the password for your account. If it was you, choose a new one below.",
              action: "Reset password",
              url,
              outro: "The link works for one hour. If you didn't ask for this, you can ignore this email.",
            }),
          );
        },
      }),
    },
    ...(email && {
      emailVerification: {
        sendOnSignUp: true,
        sendOnSignIn: true,
        autoSignInAfterVerification: true,
        expiresIn: 60 * 60,
        sendVerificationEmail: async ({ user, url }) => {
          await sendMail(
            actionEmail({
              to: user.email,
              subject: "Confirm your email",
              intro: "Confirm this address to finish setting up your account.",
              action: "Confirm email",
              url,
              outro: "The link works for one hour. If you didn't sign up, you can ignore this email.",
            }),
          );
        },
      },
    }),
    socialProviders: github,
    user: {
      additionalFields: {
        isAdmin: { type: "boolean", defaultValue: false, input: false },
        // "bootstrap" until the env-provided password is changed, then "managed".
        adminSource: { type: "string", required: false, input: false },
        accessStatus: { type: "string", defaultValue: "active", input: false },
        runLimitExempt: { type: "boolean", defaultValue: false, input: false },
      },
      ...(email && { changeEmail: { enabled: true } }),
      // Conversations in the agent service go first; the rows here cascade with the user.
      deleteUser: { enabled: true, beforeDelete: async (user) => deleteBackendThreads(user.id) },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60,
      // Off so role, approval and suspension changes apply on the next request.
      cookieCache: { enabled: false },
    },
    advanced: {
      // A repo-specific prefix keeps cookies apart from other Better Auth apps on localhost.
      cookiePrefix: "k8s-agents-auth",
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const { values } = await getSettings();
            if (user.isAnonymous) {
              if (!values.allowGuests) throw new APIError("FORBIDDEN", { message: "Guest sessions are turned off." });
              return;
            }
            if (values.signupPolicy === "closed") {
              throw new APIError("FORBIDDEN", { message: "New accounts are closed. Ask an admin for access." });
            }
            const accessStatus: AccessStatus = values.signupPolicy === "approval" ? "pending" : "active";
            return { data: { ...user, accessStatus } };
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const [row] = await db
              .select({ accessStatus: schema.user.accessStatus, isAnonymous: schema.user.isAnonymous })
              .from(schema.user)
              .where(eq(schema.user.id, session.userId));
            const status = (row?.accessStatus ?? "active") as AccessStatus;
            if (status !== "active") throw new APIError("FORBIDDEN", { message: ACCESS_MESSAGES[status] });
          },
        },
      },
      account: {
        update: {
          // The bootstrap admin gets admin rights once they replace the env-provided password.
          after: async (account, ctx) => {
            if (!ctx || account.providerId !== "credential") return;
            if (ctx.path !== "/change-password" && ctx.path !== "/reset-password") return;
            const promoted = await db
              .update(schema.user)
              .set({ isAdmin: true, adminSource: "managed", updatedAt: new Date() })
              .where(and(eq(schema.user.id, account.userId), eq(schema.user.adminSource, "bootstrap")))
              .returning({ email: schema.user.email });
            if (promoted.length) console.log(`Bootstrap admin ${promoted[0].email} is now an admin`);
          },
        },
      },
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
}

type Auth = ReturnType<typeof buildAuth>;

const globalForAuth = globalThis as unknown as { authInstances?: Map<string, Auth> };
const instances = (globalForAuth.authInstances ??= new Map());

/** The Better Auth instance for the current settings (whether account email is on). */
export async function getAuth(): Promise<Auth> {
  const config: AuthConfig = { email: Boolean(await getMailer()) };
  const key = JSON.stringify(config);
  let instance = instances.get(key);
  if (!instance) {
    instance = buildAuth(config);
    instances.set(key, instance);
  }
  return instance;
}

/** For `auth generate`; the schema does not depend on the config. */
export const auth = buildAuth({ email: false });

export type Session = Auth["$Infer"]["Session"];
