import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { ProviderError } from "@/lib/tts/providers";

export function invalid(error: ZodError) {
  return NextResponse.json(
    { error: error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") },
    { status: 400 },
  );
}

/** Turns a ProviderError into its response; rethrows anything else. */
export function providerError(e: unknown) {
  if (e instanceof ProviderError) return NextResponse.json({ error: e.message }, { status: e.status });
  throw e;
}
