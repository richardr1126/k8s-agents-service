import { NextRequest, NextResponse } from "next/server";
import { actionEmail, EmailUnavailable, sendMail } from "@/lib/email";
import { baseUrl } from "@/lib/base-url";
import { requireAdmin } from "@/lib/server";
import { getAccountEmail, getMailerForTest } from "@/lib/settings/store";

/**
 * Sends a test email to the signed-in admin with the saved config, or with an
 * unsaved API key and sender from the form (`{ apiKey?, senderName?, senderEmail? }`).
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin();
  if (error) return error;
  const body = (await req.json().catch(() => ({}))) as { apiKey?: string; senderName?: string; senderEmail?: string };
  const saved = await getAccountEmail();
  const mailer = await getMailerForTest();
  const apiKey = body.apiKey || mailer?.apiKey;
  const name = body.senderName || saved?.senderName;
  const address = body.senderEmail || saved?.senderEmail;
  if (!apiKey || !name || !address) {
    return NextResponse.json({ error: "Fill in the sender and API key first" }, { status: 400 });
  }
  try {
    await sendMail(
      actionEmail({
        to: session.user.email,
        subject: "Test email",
        intro: "Account email works. Verification and password-reset emails will look like this.",
        action: "Open the site",
        url: baseUrl(),
        outro: `Sent from ${address} through Resend.`,
      }),
      apiKey,
      `${name} <${address}>`,
    );
  } catch (e) {
    const message = e instanceof EmailUnavailable ? e.message : e instanceof Error ? e.message : "Sending failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
  return NextResponse.json({ sentTo: session.user.email });
}
