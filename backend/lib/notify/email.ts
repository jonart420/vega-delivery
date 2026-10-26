import nodemailer, { type Transporter } from "nodemailer";
import { brandColor, brandName, logoPath, publicBaseUrl } from "../branding";
import { escXml } from "../login-code";

/** E-mail via SMTP (any provider). Configured with SMTP_* variables; disabled without SMTP_HOST. */

let transporter: Transporter | null = null;

export const emailEnabled = () => !!process.env.SMTP_HOST;

function transport(): Transporter {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 587);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

function html(subject: string, text: string, link: string | null, linkLabel: string): string {
  const logo = logoPath();
  const color = brandColor();
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${escXml(p).replace(/\n/g, "<br>").replace(escXml(link ?? "\u0000"), "")}</p>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escXml(subject)}</title></head>
<body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="padding:20px 24px;border-bottom:3px solid ${color}">
${logo ? `<img src="${publicBaseUrl()}${logo}" alt="${escXml(brandName())}" height="36" style="height:36px">` : `<strong style="font-size:18px">${escXml(brandName())}</strong>`}
</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.5">${paragraphs}
${link ? `<p style="margin:20px 0"><a href="${escXml(link)}" style="background:${color};color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">${escXml(linkLabel)}</a></p>` : ""}
</td></tr></table></td></tr></table></body></html>`;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  link: string | null;
  linkLabel: string;
}): Promise<{ id: string }> {
  const from = process.env.SMTP_FROM || `${brandName()} <no-reply@localhost>`;
  const info = await transport().sendMail({
    from,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: html(opts.subject, opts.text, opts.link, opts.linkLabel),
  });
  return { id: info.messageId };
}
