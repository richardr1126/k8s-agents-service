import { anonymousClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Same origin in the browser, so no base URL is needed.
export const authClient = createAuthClient({ plugins: [anonymousClient()] });

export const { signIn, signUp, signOut, useSession } = authClient;
