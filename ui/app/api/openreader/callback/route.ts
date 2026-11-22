import { NextRequest, NextResponse } from "next/server";
import { baseUrl } from "@/lib/base-url";
import { CALLBACK_PATH, finishConnect, OpenReaderError, STATE_COOKIE } from "@/lib/openreader";
import { getSession } from "@/lib/server";

/** OpenReader's redirect back after the user approves or declines. */

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(`${baseUrl()}/signin`);
  let result = "connected";
  try {
    await finishConnect(session.user.id, req.nextUrl.searchParams, req.cookies.get(STATE_COOKIE)?.value);
  } catch (e) {
    if (!(e instanceof OpenReaderError)) console.error("OpenReader connect failed:", e instanceof Error ? e.message : e);
    result = e instanceof OpenReaderError ? e.message : "Connecting OpenReader failed.";
  }
  const res = NextResponse.redirect(`${baseUrl()}/settings?openreader=${encodeURIComponent(result)}#speech`);
  res.cookies.set(STATE_COOKIE, "", { path: CALLBACK_PATH, maxAge: 0 });
  return res;
}
