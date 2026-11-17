import { anonymousClient, inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type { auth } from "@/lib/auth";

// Same origin in the browser, so no base URL is needed.
export const authClient = createAuthClient({ plugins: [anonymousClient(), inferAdditionalFields<typeof auth>()] });

export const { signIn, signUp, signOut, useSession } = authClient;
