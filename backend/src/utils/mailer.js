import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { db } from '../db.js';

// Email delivery:
//  - SMTP configured  -> real delivery via nodemailer.
//  - SMTP not set, dev -> stored in the outbox table; the API exposes a debug link.
//  - SMTP not set, prod-> returns false so routes can respond honestly
//    (never pretend a verification/reset email was delivered).

export function smtpConfigured() {
  return Boolean(config.email.smtpHost && config.email.smtpUser && config.email.smtpPass);
}

function transport() {
  return nodemailer.createTransport({
    host: config.email.smtpHost,
    port: config.email.smtpPort,
    secure: config.email.smtpPort === 465,
    auth: { user: config.email.smtpUser, pass: config.email.smtpPass },
    tls: { rejectUnauthorized: true },
  });
}

// Returns true when the email was accepted for delivery, false when delivery is impossible.
export async function sendMail(toEmail, subject, body, link) {
  if (smtpConfigured()) {
    try {
      await transport().sendMail({
        from: config.email.from,
        to: toEmail,
        subject,
        text: body,
      });
      console.log(`[mailer:smtp] to=${toEmail} subject="${subject}" delivered`);
      return true;
    } catch (err) {
      console.error(`[mailer:smtp] send failed for ${toEmail}: ${err.message}`);
      return false;
    }
  }

  if (config.nodeEnv === 'production') {
    console.error(`[mailer] SMTP not configured in production — delivery impossible for ${toEmail}`);
    return false;
  }

  try {
    db.prepare('INSERT INTO outbox (to_email, subject, body, link, purpose) VALUES (?, ?, ?, ?, ?)')
      .run(toEmail, subject, body, link, subject.includes('Verify') ? 'email_verify' : 'password_reset');
  } catch {
    /* outbox failures are non-fatal */
  }
  console.log(`[mailer:dev] to=${toEmail} subject="${subject}" link=${link || '(none)'}`);
  return true;
}

export function lastOutboxLink(email) {
  const row = db.prepare('SELECT link FROM outbox WHERE to_email = ? ORDER BY id DESC LIMIT 1').get(email);
  return row ? row.link : null;
}
