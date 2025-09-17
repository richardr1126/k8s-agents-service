"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

// Key for localStorage to remember dismissal (updated for auth version)
const STORAGE_KEY = "privacy_notice_v2_auth_dismissed";

/**
 * PrivacyPopup displays a lightweight disclosure about data handling with authentication.
 * - Conversations (messages, tool calls, metadata) are stored in LangSmith for observability.
 * - Conversations plus user/thread metadata are stored in the backend service and PostgreSQL database.
 * - User authentication data (email, name, profile picture) is stored securely using Better Auth.
 * - All data is associated with your authenticated user account and persists across sessions.
 * - Server-side data will persist for debugging and product improvement.
 * - You can manage your account and data through the authentication system.
 */
// Allow programmatic control via exported helper
let externalOpenSetter: ((open: boolean) => void) | null = null;

export function showPrivacyPopup() {
  if (externalOpenSetter) {
    externalOpenSetter(true);
  } else if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('privacy-popup-open'));
  }
}

export function PrivacyPopup() {

  const [open, setOpen] = useState(false);

  // Remove automatic popup display - now only shown via explicit user action
  // useEffect(() => {
  //   try {
  //     const dismissed = typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY);
  //     if (!dismissed) {
  //       // Defer open slightly to avoid layout shift on first paint
  //       const t = setTimeout(() => setOpen(true), 400);
  //       return () => clearTimeout(t);
  //     }
  //   } catch {
  //     // Ignore storage errors
  //   }
  // }, []);

  const handleDismiss = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, Date.now().toString());
    } catch {
      // ignore
    }
    setOpen(false);
  };

  // Register external setter & event listener
  useEffect(() => {
    externalOpenSetter = setOpen;
    const handler = () => setOpen(true);
    window.addEventListener('privacy-popup-open', handler);
    return () => {
      externalOpenSetter = null;
      window.removeEventListener('privacy-popup-open', handler);
    };
  }, []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="bottom" className="border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 p-4 sm:p-6 w-full max-w-full">
        <SheetHeader>
          <SheetTitle>Privacy & Data Usage Notice</SheetTitle>
          <SheetDescription asChild>
            <div className="space-y-2 text-sm leading-relaxed">
              <p>
                Your chat conversations are stored for <strong>observability</strong>, <strong>debugging</strong> and to <strong>improve the agents</strong>. 
                All data is associated with your authenticated user account.
              </p>
              <p>
                <strong>Your account information</strong> (email, name, profile picture) is securely stored using Better Auth. 
                <strong>Your conversations and threads</strong> are linked to your account and persist across sessions.
              </p>
              <p>
                <strong>Avoid sharing sensitive personal information in chat messages</strong> as conversations are stored permanently for service improvement.
                Deleting or archiving chats removes them from your view but they persist on our servers.
              </p>
              <p>
                You can sign out at any time, but your data will remain stored for operational and improvement purposes.
              </p>
            </div>
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 flex justify-end">
          <Button size="sm" variant="outline" onClick={handleDismiss}>Dismiss</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
