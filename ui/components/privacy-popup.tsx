"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

// Key for localStorage to remember dismissal (updated for auth version)
const STORAGE_KEY = "privacy_notice_v3_auth_dismissed";

/**
 * PrivacyPopup displays a comprehensive privacy policy for the AI agents service.
 * Covers data collection, storage, retention policies, and user rights.
 * - Account information stored securely with Better Auth
 * - Conversations stored for service operation and improvement  
 * - Deleted threads removed from primary databases but may persist in LangSmith for 14 days
 * - Users can manage threads and request account deletion
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
  useEffect(() => {
    try {
      const dismissed = typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY);
      if (!dismissed) {
        // Defer open slightly to avoid layout shift on first paint
        const t = setTimeout(() => setOpen(true), 400);
        return () => clearTimeout(t);
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

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
      <SheetContent side="bottom" className="gap-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 p-4 sm:p-8 w-full max-w-full max-h-[85vh] flex flex-col">
        <SheetHeader className="flex-shrink-0">
          <SheetTitle>Privacy Policy & Data Handling</SheetTitle>
          <SheetDescription asChild>
            <div className="max-h-[60vh] overflow-y-auto pr-2 space-y-3 text-sm leading-relaxed">
              <div>
                <h4 className="font-semibold mb-1">Data Collection & Storage</h4>
                <p>
                  We store your conversations, authentication, and usage data to run and improve the service.
                </p>
              </div>

              <div>
                <h4 className="font-semibold mb-1">Account Information</h4>
                <p>
                  You start with an anonymous account linked to your browser. If your cookie expires or is cleared, you get a new anonymous account. Old threads from the previous account cannot be deleted or managed. If you sign up, your threads move to your new account. Your email, name, and profile picture are stored securely. All chats link to your account.
                </p>
              </div>

              <div>
                <h4 className="font-semibold mb-1">Conversation Data</h4>
                <p>
                  We keep chat messages, tool use, and metadata for features, debugging, and product improvement. If you lose your anonymous account, you cannot delete or manage old threads. Signing up moves your threads to your account.
                </p>
              </div>

              <div>
                <h4 className="font-semibold mb-1">Data Retention & Deletion</h4>
                <p>
                  Deleted threads are removed from our main databases. Copies may stay in LangSmith for up to 14 days. If you lose your anonymous account, you cannot delete or manage those threads. Signing up keeps your threads under your control.
                </p>
              </div>

              <div>
                <h4 className="font-semibold mb-1">Data Security</h4>
                <p>
                  <strong>Important:</strong> Do not share sensitive info, passwords, or secrets in chats. We use security measures, but all chats are processed and stored.
                </p>
              </div>

              <div>
                <h4 className="font-semibold mb-1">Your Rights</h4>
                <p>
                  You can sign out or delete threads anytime if you have access. If you lose your anonymous account, you cannot delete or manage old threads. Signing up keeps your threads under your control. For account deletion or questions, contact richardr.dev or me@richardr.dev.
                </p>
              </div>
            </div>
          </SheetDescription>
        </SheetHeader>
        <div className="flex justify-between items-center flex-shrink-0">
          <p className="text-xs text-muted-foreground">Last updated: September 2025</p>
          <Button size="sm" variant="outline" onClick={handleDismiss}>I Understand</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
