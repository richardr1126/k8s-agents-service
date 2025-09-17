"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import BetterAuthSignIn from "@/components/better-auth-signin";
import BetterAuthSignUp from "@/components/better-auth-signup";

export function BetterAuthForm() {
  const [isSignUp, setIsSignUp] = useState(false);
  const router = useRouter();

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-md">
        <div className="flex gap-2 mb-4">
          <Button 
            variant={!isSignUp ? "default" : "outline"}
            onClick={() => {
              setIsSignUp(false);
              router.push('/signin');
            }}
            className="flex-1"
          >
            Sign In
          </Button>
          <Button 
            variant={isSignUp ? "default" : "outline"}
            onClick={() => {
              setIsSignUp(true);
              router.push('/signup');
            }}
            className="flex-1"
          >
            Sign Up
          </Button>
        </div>
        
        {isSignUp ? <BetterAuthSignUp /> : <BetterAuthSignIn />}
      </div>
    </div>
  );
}