import { githubSignIn } from "@/lib/auth";
import { getMailer, getSettings } from "@/lib/settings/store";

/** What the sign-in and sign-up pages need to know about the current settings. */
export type PublicAuthConfig = {
  githubSignIn: boolean;
  allowGuests: boolean;
  signupPolicy: "open" | "approval" | "closed";
  email: boolean;
};

export async function getPublicAuthConfig(): Promise<PublicAuthConfig> {
  const [{ values }, mailer] = await Promise.all([getSettings(), getMailer()]);
  return { githubSignIn, allowGuests: values.allowGuests, signupPolicy: values.signupPolicy, email: Boolean(mailer) };
}
