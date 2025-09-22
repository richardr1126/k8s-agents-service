"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useState, Suspense, useEffect } from "react";
import { Loader2, AlertCircle, AlertTriangle, User } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { signIn } from "@/lib/auth-client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { showPrivacyPopup } from "@/components/privacy-popup";
import { wasSignedOut, clearSignedOut } from "@/lib/session-utils";

function SessionExpiredLoader({ setSessionExpired }: { setSessionExpired: (v: boolean) => void }) {
  const searchParams = useSearchParams();
  // Set the flag based on the URL param; this is allowed in Suspense boundary
  const reason = searchParams.get("reason");
  useEffect(() => {
    setSessionExpired(reason === "expired");
  }, [reason, setSessionExpired]);
  return null;
}

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loadingEmail, setLoadingEmail] = useState(false);
  const [loadingGithub, setLoadingGithub] = useState(false);
  const [loadingGuest, setLoadingGuest] = useState(false);
  const [rememberMe, setRememberMe] = useState(true); // Default to true for better UX
  const [sessionExpired, setSessionExpired] = useState(false);
  const [justSignedOut, setJustSignedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<{
    email?: string;
    password?: string;
  }>({});
  const isAnyLoading = loadingEmail || loadingGithub || loadingGuest;

  // Detect explicit sign-out and show a friendly note once
  useEffect(() => {
    if (wasSignedOut()) {
      setJustSignedOut(true);
      clearSignedOut();
    }
  }, []);

  // Email validation
  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  // Note: We intentionally do not auto-clear errors in an effect to avoid flicker
  // We'll clear errors only when the user edits inputs in onChange handlers.

  // Handle form validation
  const validateForm = (): boolean => {
    const errors: { email?: string; password?: string } = {};
    
    if (!email.trim()) {
      errors.email = "Email is required";
    } else if (!validateEmail(email)) {
      errors.email = "Please enter a valid email address";
    }
    
    if (!password.trim()) {
      errors.password = "Password is required";
    }
    
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSignIn = async () => {
    // Clear previous errors
    setError(null);
    setValidationErrors({});
    
    // Validate form
    if (!validateForm()) {
      return;
    }

    setLoadingEmail(true);
    
    try {
      const result = await signIn.email({
        email: email.trim(),
        password,
        rememberMe
      });

      if (result.error) {
        // Handle authentication errors
        const errorMessage = result.error.message || "An unknown error occurred";
        
        if (errorMessage.toLowerCase().includes("invalid") || 
            errorMessage.toLowerCase().includes("incorrect") ||
            errorMessage.toLowerCase().includes("credentials")) {
          setError("Invalid email or password. Please check your credentials and try again.");
        } else if (errorMessage.toLowerCase().includes("user not found") ||
                   errorMessage.toLowerCase().includes("account")) {
          setError("No account found with this email address.");
        } else if (errorMessage.toLowerCase().includes("blocked") ||
                   errorMessage.toLowerCase().includes("suspended")) {
          setError("Your account has been temporarily blocked. Please contact support.");
        } else {
          setError(errorMessage || "An error occurred during sign in. Please try again.");
        }
      } else {
        // Success - clear any expired session flags and redirect
        if (sessionExpired) {
          localStorage.removeItem('sessionExpired');
        }
        router.push('/');
      }
    } catch (err) {
      console.error("Sign in error:", err);
      setError("Unable to connect to the server. Please check your internet connection and try again.");
    } finally {
      setLoadingEmail(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        {/* Only this part uses useSearchParams via the loader, wrapped in Suspense */}
        <Suspense fallback={null}>
          <SessionExpiredLoader setSessionExpired={setSessionExpired} />
        </Suspense>
        
        {/* Animated header content */}
        <motion.div
          animate={{ y: 0 }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
        >
          <CardTitle className="text-lg md:text-xl">
            {sessionExpired ? "Session Expired" : "Sign In"}
          </CardTitle>
          <CardDescription className="text-xs md:text-sm">
            {sessionExpired
              ? "Please sign in again to access your account"
              : justSignedOut
              ? "Sign in to continue"
              : "Enter your email below to login to your account"}
          </CardDescription>
        </motion.div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          {/* Animated session/signout alerts */}
          <AnimatePresence>
            {(sessionExpired || justSignedOut) && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: "auto", marginBottom: 8 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md dark:bg-amber-950 dark:border-amber-800">
                  <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <div className="flex-1 text-sm text-amber-700 dark:text-amber-300">
                    {sessionExpired
                      ? "Your session has expired. Please sign in again to continue."
                      : "You've been signed out. Please sign in to continue."}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Animated error alert */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-md dark:bg-red-950 dark:border-red-800">
                  <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                  <div className="flex-1 text-sm text-red-700 dark:text-red-300">
                    {error}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="me@example.com"
                required
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError(null);
                  if (validationErrors.email) setValidationErrors((prev) => ({ ...prev, email: undefined }));
                }}
                value={email}
                className={validationErrors.email ? "border-red-500" : ""}
              />
              {validationErrors.email && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {validationErrors.email}
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <div className="flex items-center">
                <Label htmlFor="password">Password</Label>
                <Link
                    href="#"
                    className="ml-auto inline-block text-sm underline"
                  >
                    Forgot your password?
                  </Link>
              </div>

              <Input
                id="password"
                type="password"
                placeholder="password"
                autoComplete="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(null);
                  if (validationErrors.password) setValidationErrors((prev) => ({ ...prev, password: undefined }));
                }}
                className={validationErrors.password ? "border-red-500" : ""}
              />
              {validationErrors.password && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {validationErrors.password}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="remember"
                checked={rememberMe}
                onCheckedChange={(checked) => setRememberMe(Boolean(checked))}
              />
              <Label htmlFor="remember">Remember me</Label>
            </div>

          

          <Button
              type="submit"
              className="w-full"
              disabled={isAnyLoading}
              onClick={handleSignIn}
            >
              {loadingEmail ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <p> Login </p>
              )}
            </Button>

          

          <Button
            variant="outline"
            className="w-full gap-2"
            disabled={isAnyLoading}
            onClick={async () => {
              await signIn.social(
              {
                provider: "github",
                callbackURL: "/"
              },
              {
                onRequest: () => {
                   setLoadingGithub(true);
                },
                onResponse: () => {
                   setLoadingGithub(false);
                },
               },
              );
            }}
          >
            {loadingGithub ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="1em"
                  height="1em"
                  viewBox="0 0 24 24"
                >
                  <path
                    fill="currentColor"
                    d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5c.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34c-.46-1.16-1.11-1.47-1.11-1.47c-.91-.62.07-.6.07-.6c1 .07 1.53 1.03 1.53 1.03c.87 1.52 2.34 1.07 2.91.83c.09-.65.35-1.09.63-1.34c-2.22-.25-4.55-1.11-4.55-4.92c0-1.11.38-2 1.03-2.71c-.1-.25-.45-1.29.1-2.64c0 0 .84-.27 2.75 1.02c.79-.22 1.65-.33 2.5-.33s1.71.11 2.5.33c1.91-1.29 2.75-1.02 2.75-1.02c.55 1.35.2 2.39.1 2.64c.65.71 1.03 1.6 1.03 2.71c0 3.82-2.34 4.66-4.57 4.91c.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2"
                  ></path>
                </svg>
                Sign in with GitHub
              </>
            )}
          </Button>

          <Button
            variant="outline"
            className="w-full gap-2"
            disabled={isAnyLoading}
            onClick={async () => {
              try {
                setLoadingGuest(true);
                setError(null);
                await signIn.anonymous();
                if (sessionExpired) {
                  localStorage.removeItem('sessionExpired');
                }
                router.push('/');
              } catch (e) {
                console.error('Anonymous sign-in failed:', e);
                setError('Unable to sign in anonymously. Please try again or use another method.');
              } finally {
                setLoadingGuest(false);
              }
            }}
          >
            {loadingGuest ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <>
                <User className="h-4 w-4" />
                Continue as guest
              </>
            )}
          </Button>
        </div>
      </CardContent>
      <CardFooter>
        <div className="flex flex-col items-center w-full border-t py-4 gap-2">
          <p className="text-center text-xs text-neutral-500">
           Don&apos;t have an account?{" "}
            <Link
              href="/signup"
              className="underline"
            >
              <span className="dark:text-white/70 cursor-pointer">
								Sign up
							</span>
            </Link>
          </p>
          <p className="text-center text-xs text-neutral-500">
            By signing in, you agree to our{" "}
            <button
              onClick={() => showPrivacyPopup()}
              className="underline hover:text-neutral-700 dark:hover:text-neutral-300"
            >
              Privacy Policy
            </button>
          </p>
        </div>
      </CardFooter>
    </Card>
  );
}