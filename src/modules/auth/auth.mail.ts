import { randomUUID } from "node:crypto";
import dns from "node:dns/promises";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { env } from "../../config/env";
import { AppError } from "../../middleware/error-handler";
import { logger } from "../../utils/logger";

type SmtpEndpoint = { port: number; secure: boolean };

/**
 * Prefer the authenticated SMTP mailbox as the visible From address.
 * Mismatched From/SMTP identity is a common Gmail spam trigger.
 */
function resolveFrom(): { name: string; address: string } {
  const name = (env.MAIL_FROM_NAME || "AI Playground").trim() || "AI Playground";
  const address = (
    env.SMTP_USER?.trim() ||
    env.MAIL_FROM_EMAIL?.trim() ||
    ""
  ).toLowerCase();

  if (!address) {
    throw new AppError(
      503,
      "Email is not configured. Set SMTP_USER / MAIL_FROM_EMAIL on the backend.",
    );
  }

  return { name, address };
}

/**
 * Gmail STARTTLS :587 is unreliable from Docker Desktop on Windows
 * (intermittent ECONNREFUSED / connection timeout to Google anycast IPs).
 * Prefer implicit SSL :465 first, then fall back to the configured endpoint.
 */
function smtpEndpoints(): SmtpEndpoint[] {
  const configured: SmtpEndpoint = {
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
  };
  const ssl465: SmtpEndpoint = { port: 465, secure: true };
  const starttls587: SmtpEndpoint = { port: 587, secure: false };

  const ordered: SmtpEndpoint[] = [];
  const seen = new Set<string>();

  const push = (endpoint: SmtpEndpoint) => {
    const key = `${endpoint.port}:${endpoint.secure ? "s" : "p"}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    ordered.push(endpoint);
  };

  // Prefer SSL 465 for Gmail hosts; otherwise honor configured port first.
  if (env.SMTP_HOST.toLowerCase().includes("gmail.com")) {
    push(ssl465);
    push(configured);
    push(starttls587);
  } else {
    push(configured);
    if (configured.port !== 465) {
      push(ssl465);
    }
    if (configured.port !== 587) {
      push(starttls587);
    }
  }

  return ordered;
}

async function resolveIpv4(host: string): Promise<string> {
  const { address } = await dns.lookup(host, { family: 4 });
  return address;
}

async function createTransport(endpoint: SmtpEndpoint) {
  const hostName = env.SMTP_HOST;
  // Connect by IPv4 address; keep the hostname for EHLO / TLS SNI / cert checks.
  const ipv4 = await resolveIpv4(hostName);

  const options: SMTPTransport.Options = {
    host: ipv4,
    port: endpoint.port,
    secure: endpoint.secure,
    requireTLS: !endpoint.secure && endpoint.port === 587,
    name: hostName,
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 20_000,
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
    tls: {
      servername: hostName,
      minVersion: "TLSv1.2",
    },
  };

  return nodemailer.createTransport(options);
}

function isTransientSmtpConnectError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  const msg = err.message.toLowerCase();
  const code =
    typeof (err as NodeJS.ErrnoException).code === "string"
      ? (err as NodeJS.ErrnoException).code!.toLowerCase()
      : "";
  return (
    code === "econnrefused" ||
    code === "etimedout" ||
    code === "econnreset" ||
    code === "enetunreach" ||
    code === "enotfound" ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("connection timeout") ||
    msg.includes("greeting never received")
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildVerificationHtml(name: string, otp: string, expiryMinutes: number): string {
  const safeName = escapeHtml(name);
  const safeOtp = escapeHtml(otp);

  // Transactional, brand-consistent HTML — avoid marketing/spam patterns.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <title>AI Playground email verification</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;color:#111827;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 12px 28px;font-family:Arial,Helvetica,sans-serif;">
              <p style="margin:0 0 8px 0;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#4f46e5;font-weight:700;">AI Playground</p>
              <h1 style="margin:0;font-size:22px;line-height:1.3;color:#111827;">Confirm your email address</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 0 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#475569;">
              <p style="margin:0 0 12px 0;">Hi ${safeName},</p>
              <p style="margin:0;">Enter this verification code in AI Playground to finish creating your account. The code expires in ${expiryMinutes} minutes.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px;font-family:Arial,Helvetica,sans-serif;" align="center">
              <div style="display:inline-block;background:#eef2ff;border:1px solid #c7d2fe;border-radius:12px;padding:18px 28px;">
                <span style="font-size:32px;font-weight:700;letter-spacing:0.28em;color:#312e81;font-family:Consolas,Monaco,monospace;">${safeOtp}</span>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 28px 28px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:#64748b;">
              <p style="margin:0 0 8px 0;">Do not share this code with anyone. AI Playground will never ask you for your password by email.</p>
              <p style="margin:0;">If you did not request this code, you can ignore this message.</p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#94a3b8;">
          Sent by AI Playground
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildVerificationText(name: string, otp: string, expiryMinutes: number): string {
  return [
    `AI Playground email verification`,
    ``,
    `Hi ${name},`,
    ``,
    `Your verification code is: ${otp}`,
    ``,
    `This code expires in ${expiryMinutes} minutes.`,
    `Do not share this code with anyone.`,
    ``,
    `If you did not create an AI Playground account, you can ignore this email.`,
  ].join("\n");
}

export async function sendVerificationEmail(
  to: string,
  name: string,
  otp: string,
): Promise<void> {
  const from = resolveFrom();
  const expiryMinutes = Math.max(1, Math.floor(env.OTP_TTL_SECONDS / 60));
  const messageIdDomain = from.address.includes("@")
    ? from.address.split("@")[1]
    : "localhost";

  const mail = {
    from: { name: from.name, address: from.address },
    // Keep envelope sender aligned with the authenticated mailbox.
    envelope: {
      from: from.address,
      to,
    },
    replyTo: { name: from.name, address: from.address },
    to,
    // Do not put the OTP first in the subject — that pattern is heavily abused by phishing mail.
    subject: "Your AI Playground verification code",
    text: buildVerificationText(name, otp, expiryMinutes),
    html: buildVerificationHtml(name, otp, expiryMinutes),
    messageId: `<verify-${randomUUID()}@${messageIdDomain}>`,
    headers: {
      "X-Entity-Ref-ID": randomUUID(),
      "X-Auto-Response-Suppress": "All",
    },
  };

  const endpoints = smtpEndpoints();
  let lastError: unknown;

  for (let i = 0; i < endpoints.length; i += 1) {
    const endpoint = endpoints[i]!;
    try {
      const transport = await createTransport(endpoint);
      await transport.sendMail(mail);
      if (i > 0) {
        logger.info("Verification email sent after SMTP fallback", {
          to,
          port: endpoint.port,
          secure: endpoint.secure,
        });
      }
      return;
    } catch (err) {
      lastError = err;
      const canRetry =
        i < endpoints.length - 1 && isTransientSmtpConnectError(err);
      if (!canRetry) {
        break;
      }
      logger.warn("SMTP endpoint unreachable; trying next", {
        to,
        port: endpoint.port,
        secure: endpoint.secure,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  logger.error("Failed to send verification email", {
    to,
    // deliberately omit OTP from logs
    error: lastError instanceof Error ? lastError.message : "unknown",
  });
  throw new AppError(
    503,
    "Unable to send verification email. Please try again shortly.",
  );
}
