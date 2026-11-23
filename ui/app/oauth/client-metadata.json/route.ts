import { NextResponse } from "next/server";
import { clientMetadata } from "@/lib/openreader";

/**
 * This app's OAuth client ID metadata document. Its URL is the client ID OpenReader
 * sees, so the consent screen names this site and only its own redirect is allowed.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(clientMetadata(), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
