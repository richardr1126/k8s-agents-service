"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

// Key for localStorage to remember dismissal (updated for auth version)
const STORAGE_KEY = "privacy_notice_v2_auth_dismissed";

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
      <SheetContent side="bottom" className="border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 p-4 sm:p-6 w-full max-w-full max-h-[85vh] flex flex-col">
        <SheetHeader className="flex-shrink-0">
          <SheetTitle>Privacy Policy & Data Handling</SheetTitle>
          <SheetDescription asChild>
            <div className="max-h-[60vh] overflow-y-auto pr-2 space-y-3 text-sm leading-relaxed">
              <div>
                <h4 className="font-semibold mb-1">Data Collection & Storage</h4>
                <p>
                  We collect and store your conversations, authentication data, and usage information to provide and improve our AI agent services.
                </p>
              </div>
              
              <div>
                <h4 className="font-semibold mb-1">Account Information</h4>
                <p>
                  Your account details (email, name, profile picture) are securely stored using industry-standard authentication practices. 
                  All conversations and threads are linked to your authenticated account.
                </p>
              </div>

              <div>
                <h4 className="font-semibold mb-1">Conversation Data</h4>
                <p>
                  Chat conversations, including messages, tool interactions, and metadata, are stored for service operation, 
                  observability, debugging, and product improvement. This data persists across your sessions.
                </p>
              </div>

              <div>
                <h4 className="font-semibold mb-1">Data Retention & Deletion</h4>
                <p>
                  When you delete threads from your account, they are immediately removed from our primary databases. 
                  However, conversation data may persist in our observability platform (LangSmith) for up to 14 days 
                  for operational monitoring and debugging purposes.
                </p>
              </div>

              <div>
                <h4 className="font-semibold mb-1">Data Security</h4>
                <p>
                  <strong>Important:</strong> Avoid sharing sensitive personal information, passwords, or confidential data in conversations. 
                  While we implement security measures, conversations are processed and stored for service improvement.
                </p>
              </div>

              <div>
                <h4 className="font-semibold mb-1">Your Rights</h4>
                <p>
                  You may sign out at any time and delete individual conversation threads. 
                  For complete account deletion or data inquiries, please contact me on richardr.dev or at me@richardr.dev.
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
