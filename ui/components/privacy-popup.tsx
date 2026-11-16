"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

// Key for localStorage to remember dismissal (updated for auth version)
const STORAGE_KEY = "privacy_notice_v4_guest_dismissed";

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
                  You can sign up with an email address (or GitHub, where available), or choose &quot;Continue as guest&quot;. A guest session is tied to this browser. If you sign out or clear your cookies as a guest, you cannot get back to that guest&apos;s chats. If you create an account or sign in while using a guest session, your guest chats move to that account. For accounts we store your email, name, and profile picture.
                </p>
              </div>

              <div>
                <h4 className="font-semibold mb-1">Conversation Data</h4>
                <p>
                  We keep chat messages, tool use, and metadata for features, debugging, and product improvement. Every chat belongs to your account or guest session, and only you can open it.
                </p>
              </div>

              <div>
                <h4 className="font-semibold mb-1">Usage Limits</h4>
                <p>
                  Each account and guest session can start a limited number of runs per minute and per day. Guests get fewer runs than accounts. The counter next to the message box shows how many you have left.
                </p>
              </div>

              <div>
                <h4 className="font-semibold mb-1">Data Retention & Deletion</h4>
                <p>
                  Deleted threads are removed from our main databases. Copies may stay in LangSmith for up to 14 days. Chats from a guest session you can no longer reach stay stored, and you cannot delete them yourself.
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
                  You can rename or delete your threads and sign out at any time. For account deletion or questions, contact richardr.dev or me@richardr.dev.
                </p>
              </div>
            </div>
          </SheetDescription>
        </SheetHeader>
        <div className="flex justify-between items-center flex-shrink-0">
          <p className="text-xs text-muted-foreground">Last updated: November 2026</p>
          <Button size="sm" variant="outline" onClick={handleDismiss}>I Understand</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
