import { NextResponse } from "next/server";
import { baseUrl } from "@/lib/base-url";
import { beginConnect, CALLBACK_PATH, OpenReaderError, STATE_COOKIE } from "@/lib/openreader";
import { getSession } from "@/lib/server";

/** Sends the user to OpenReader to approve speech access. */

const back = (result: string) => `${baseUrl()}/settings?openreader=${encodeURIComponent(result)}#speech`;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.redirect(`${baseUrl()}/signin`);
  if (session.user.isAnonymous) return NextResponse.redirect(back("Create an account to connect OpenReader."));
  try {
    const { url, cookie } = await beginConnect(session.user.id);
    const res = NextResponse.redirect(url);
    res.cookies.set(STATE_COOKIE, cookie, {
      httpOnly: true,
      secure: baseUrl().startsWith("https:"),
      sameSite: "lax",
      path: CALLBACK_PATH,
      maxAge: 600,
    });
    return res;
  } catch (e) {
    if (e instanceof OpenReaderError) return NextResponse.redirect(back(e.message));
    throw e;
  }
}
