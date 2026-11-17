import { getMailer } from "@/lib/settings/store";

type Mail = { to: string; subject: string; text: string; html: string };

export class EmailUnavailable extends Error {
  constructor() {
    super("Account email is not set up");
  }
}

/** Sends through the Resend HTTP API with the key saved in admin settings. */
export async function sendMail(mail: Mail, apiKey?: string, from?: string): Promise<void> {
  const mailer = await getMailer();
  const key = apiKey ?? mailer?.apiKey;
  const sender = from ?? mailer?.from;
  if (!key || !sender) throw new EmailUnavailable();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: sender,
      to: [mail.to],
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      ...(mailer?.replyTo && { reply_to: mailer.replyTo }),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend refused the email (${res.status}): ${detail.slice(0, 300)}`);
  }
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A plain message with one button; every account email uses this shape. */
export function actionEmail(opts: { to: string; subject: string; intro: string; action: string; url: string; outro: string }): Mail {
  const text = `${opts.intro}\n\n${opts.action}: ${opts.url}\n\n${opts.outro}`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
<p style="margin:0 0 24px;font-size:15px;line-height:1.5">${escape(opts.intro)}</p>
<p style="margin:0 0 24px"><a href="${escape(opts.url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600">${escape(opts.action)}</a></p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#666">${escape(opts.outro)}</p>
</div></body></html>`;
  return { to: opts.to, subject: opts.subject, text, html };
}
