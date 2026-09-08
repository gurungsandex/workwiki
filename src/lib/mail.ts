import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '@/env';

/** Nodemailer over SMTP. Every company already has a relay. */

let transport: Transporter | null = null;

export function mailConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.MAIL_FROM);
}

function transporter(): Transporter {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } : undefined,
    });
  }
  return transport;
}

export interface Message {
  to: string;
  subject: string;
  text: string;
}

/**
 * Send, or say plainly that mail is not configured. A failure here never
 * changes what the caller tells the user: "if that address is on file, a link
 * is on its way" is the same sentence either way.
 */
export async function sendMail(message: Message): Promise<{ sent: boolean; reason?: string }> {
  if (!mailConfigured()) return { sent: false, reason: 'SMTP is not configured on this deployment.' };
  try {
    await transporter().sendMail({
      from: env.MAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: (error as Error).message };
  }
}

/** The mandatory test send in the setup wizard. */
export async function verifyMail(): Promise<{ ok: boolean; reason?: string }> {
  if (!mailConfigured()) return { ok: false, reason: 'Set SMTP_HOST and MAIL_FROM first.' };
  try {
    await transporter().verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
}
