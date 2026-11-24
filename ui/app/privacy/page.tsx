import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";
import { PRIVACY_POLICY_EFFECTIVE_DATE } from "@/lib/privacy-policy";

export const metadata: Metadata = { title: "Privacy policy · chat.richardr.dev" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <div className="text-muted-foreground grid gap-2 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

/** The full privacy policy. Public, so it can be read before signing in. */
export default function PrivacyPage() {
  return (
    <div className="min-h-dvh">
      <header className="bg-background/80 sticky top-0 z-10 flex h-14 items-center border-b px-4 pt-[env(safe-area-inset-top)] backdrop-blur md:px-6">
        <Link href="/" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <BrandMark />
        </Link>
        <Button asChild variant="outline" size="sm" className="ml-auto">
          <Link href="/">Back to chat</Link>
        </Button>
      </header>
      <main className="mx-auto grid max-w-2xl gap-8 px-4 py-10 md:py-14">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Privacy policy</h1>
          <p className="text-muted-foreground mt-1.5 text-sm">Effective {PRIVACY_POLICY_EFFECTIVE_DATE}</p>
        </div>

        <Section title="What we store">
          <p>We store your conversations, sign-in details and usage to run and improve the service.</p>
        </Section>

        <Section title="Accounts and guests">
          <p>
            You can sign up with an email address (or GitHub, where available), or continue as a guest. For accounts
            we store your email, display name and profile picture.
          </p>
          <p>
            A guest session is tied to this browser. If you sign out or clear your cookies as a guest, you can&apos;t get
            back to that guest&apos;s chats. If you create an account or sign in while using a guest session, your guest
            chats move to that account.
          </p>
        </Section>

        <Section title="Conversations">
          <p>
            We keep chat messages, tool use and metadata for features, debugging and product improvement. Every chat
            belongs to your account or guest session, and other users can&apos;t open it.
          </p>
          <p>
            Chats aren&apos;t end-to-end encrypted. The operator of this service can read stored conversations. Your
            messages are also sent to the AI model providers that generate replies and to LangSmith, our tracing
            service, and each handles them under its own terms.
          </p>
        </Section>

        <Section title="Usage limits">
          <p>
            Each account and guest session can start a limited number of runs per minute and per day. Guests get fewer
            runs than accounts. The counter next to the message box shows how many you have left.
          </p>
        </Section>

        <Section title="Retention and deletion">
          <p>
            Deleting a chat stops any reply or background job still running in it and removes the chat, with what its
            jobs made (such as podcast audio), from our main databases. Deleting your account does the same for every
            chat. Copies may stay in LangSmith, our tracing service, for
            up to 14 days. Chats from a guest session you can no longer reach stay stored, and you can&apos;t delete
            them yourself.
          </p>
        </Section>

        <Section title="Security">
          <p>
            Don&apos;t share sensitive information, passwords or secrets in chats. We take reasonable security measures,
            but every chat is processed and stored.
          </p>
        </Section>

        <Section title="Your choices">
          <p>
            You can rename or delete your chats, sign out, and delete your account in Settings at any time. For
            questions, contact{" "}
            <a className="text-foreground font-medium underline-offset-4 hover:underline" href="mailto:me@richardr.dev">
              me@richardr.dev
            </a>
            .
          </p>
          <p>When this policy changes materially, you&apos;ll be asked to agree to it again.</p>
        </Section>
      </main>
    </div>
  );
}
