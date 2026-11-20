"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheckIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { acceptsCurrentPolicy } from "@/lib/privacy-policy";
import { onboardingQuery, type Onboarding } from "@/lib/queries";

const policyLink = (
  <a href="/privacy" target="_blank" rel="noreferrer" className="text-foreground font-medium underline underline-offset-4">
    Privacy policy
  </a>
);

/**
 * Asks each user, guests included, to agree to the privacy policy before chatting.
 * The agreement is saved with the account, so it holds across browsers and devices,
 * and is asked for again only when the policy changes.
 */
export function PrivacyGate() {
  const queryClient = useQueryClient();
  const { data } = useQuery(onboardingQuery);
  const [agreed, setAgreed] = useState(false);
  const checkboxId = useId();
  const accept = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/onboarding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ privacyAccepted: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as Onboarding;
    },
    onSuccess: (next) => queryClient.setQueryData(onboardingQuery.queryKey, next),
  });

  // Decide only once the saved state is in, so a returning user never sees it flash.
  // If it can't be read, don't block the chat; it is asked for on a later visit.
  const open = data !== undefined && !acceptsCurrentPolicy(data.privacyAcceptedAt);

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="gap-5 sm:max-w-md"
      >
        <div className="flex items-start gap-3">
          <div className="bg-brand-soft text-brand grid size-9 shrink-0 place-items-center rounded-lg">
            <ShieldCheckIcon className="size-4.5" />
          </div>
          <div className="grid gap-1">
            <DialogTitle>Privacy and your data</DialogTitle>
            <DialogDescription>Please read this before you start chatting.</DialogDescription>
          </div>
        </div>

        <ul className="text-muted-foreground grid list-disc gap-1.5 pl-5 text-sm leading-relaxed">
          <li>Your chats, sign-in details and usage are stored to run and improve the service.</li>
          <li>Deleted chats may stay in our tracing service for up to 14 days.</li>
          <li>Don&apos;t share passwords, secrets or other sensitive information in chats.</li>
          <li>Guest chats are tied to this browser. Create an account to keep them.</li>
        </ul>

        <label
          htmlFor={checkboxId}
          className="bg-muted/50 flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm"
        >
          <Checkbox id={checkboxId} checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-0.5" />
          <span>I have read and agree to the {policyLink}</span>
        </label>

        {accept.isError && (
          <p role="alert" className="text-destructive -mt-2 text-sm">
            Couldn&apos;t save your agreement. Please try again.
          </p>
        )}

        <Button className="w-full" disabled={!agreed || accept.isPending} onClick={() => accept.mutate()}>
          {accept.isPending ? "Saving…" : "Continue"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
