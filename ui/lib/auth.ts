import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { Pool } from "pg";

// Create PostgreSQL connection pool for auth
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL || "http://localhost:3000",
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Set to true in production
    rememberMe: {
      enabled: true,
      durationInDays: 30, // 30 days when "remember me" is checked
    },
    async sendResetPassword(data) {
      // Send an email to the user with a link to reset their password
      console.log("Password reset requested for:", data.user.email);
    },
  },
  socialProviders: {
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET && {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
      },
    }),
  },
  session: {
    expiresIn: 60 * 60 * 24 * 1, // 1 day (default - shorter for security)
    updateAge: 60 * 60 * 24, // 24 hours
  },
  advanced: {
    generateId: () => {
      // Generate user-friendly IDs similar to current system
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 8);
      return `user-${timestamp}-${random}`;
    },
  },
  plugins: [nextCookies()], // Enable Next.js cookie handling
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;