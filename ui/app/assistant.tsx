"use client";

import { Thread } from "@/components/assistant-ui/thread";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { CustomRuntimeProvider } from "@/components/custom-runtime-provider";
import { TaskToolUI } from "@/components/task-ui";
import { UserProvider } from "@/components/auth-user-provider";
import { ServiceInfoProvider } from "@/components/service-info-provider";
import { useSession, signIn } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, MessagesSquare } from "lucide-react";
import { 
  wasUserPreviouslyAuthenticated, 
  markUserAsAuthenticated, 
  updateLastActivity,
  wasSignedOut,
  clearSignedOut,
} from "@/lib/session-utils";

function AssistantFloatingTrigger() {
  return (
    <div className="absolute top-2 left-2 z-20">
      <SidebarTrigger className="rounded-full border size-11 bg-background/80 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/60" />
    </div>
  );
}

function AuthenticatedContent() {
  return (
    <ServiceInfoProvider>
      <UserProvider>
        <CustomRuntimeProvider>
          <SidebarProvider>
            <div className="flex h-dvh w-full pr-0.5">
              <AppSidebar />
              <SidebarInset>
                <div className="min-h-0 relative flex-1">
                  <AssistantFloatingTrigger />
                  <Thread />
                  <TaskToolUI />
                </div>
              </SidebarInset>
            </div>
          </SidebarProvider>
        </CustomRuntimeProvider>
      </UserProvider>
    </ServiceInfoProvider>
  );
}

function AssistantContent() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [hasAttemptedAuth, setHasAttemptedAuth] = useState(false);
  const [wasAuthenticated, setWasAuthenticated] = useState(() => wasUserPreviouslyAuthenticated());

  // Track when user becomes authenticated and update activity
  useEffect(() => {
    if (session?.user && !session.user.isAnonymous) {
      markUserAsAuthenticated();
      setWasAuthenticated(true);
      updateLastActivity();
    }
  }, [session]);

  // Update activity on user interaction (optional - for better session tracking)
  useEffect(() => {
    // Only attach listeners for fully authenticated (non-anonymous) users
    if (!session?.user || session.user.isAnonymous) return;

    const handleActivity = () => {
      updateLastActivity();
    };

    // Track user activity
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    events.forEach(event => {
      document.addEventListener(event, handleActivity, { passive: true });
    });

    return () => {
      events.forEach(event => {
        document.removeEventListener(event, handleActivity);
      });
    };
  }, [session]);

  // Handle authentication state
  useEffect(() => {
    if (isPending || hasAttemptedAuth) return;

    if (!session) {
      if (wasSignedOut()) {
        // User explicitly signed out: go to normal sign-in page
        clearSignedOut();
        router.push('/signin');
      } else if (wasAuthenticated) {
        // User was previously authenticated but session expired
        // Redirect to sign-in page instead of creating anonymous session
        router.push('/signin?reason=expired');
      } else {
        // New user - create anonymous session
        const signInAnonymously = async () => {
          try {
            await signIn.anonymous();
          } catch (error) {
            console.error('Failed to sign in anonymously:', error);
            router.push('/signin');
          }
        };
        
        signInAnonymously();
      }
      setHasAttemptedAuth(true);
    }
  }, [session, isPending, router, wasAuthenticated, hasAttemptedAuth]);

  // Show loading state while checking auth or signing in
  // Always show the loading card until we have a session object to avoid flicker
  if (isPending || !session) {
    return (
      <div className="flex h-dvh w-full items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="flex aspect-square size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <MessagesSquare className="size-6" />
              </div>
            </div>
            <CardTitle className="text-lg md:text-xl">chat.richardr.dev</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <div className="flex items-center justify-center gap-3 mb-4">
              <Loader2 className="size-5 animate-spin" />
              <span className="text-sm text-muted-foreground">
                {isPending ? "Checking authentication..." : "Signing in anonymously..."}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {isPending
                ? "Please wait while we verify your session"
                : "Setting up your temporary session to get started"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <AuthenticatedContent />;
}

export const Assistant = () => {
  return (
    <Suspense fallback={<div className="flex h-dvh w-full items-center justify-center">Loading...</div>}>
      <AssistantContent />
    </Suspense>
  );
};
