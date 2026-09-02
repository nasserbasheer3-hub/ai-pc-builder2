import crypto from 'node:crypto';

export function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function daysAgoStr(days) {
  const d = new Date(Date.now() - days * 86400000);
  return d.toISOString().slice(0, 10);
}

export function weekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getUTCDay() || 7; // Monday = 1 ... Sunday = 7
  d.setUTCDate(d.getUTCDate() - day + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function toISO(dt) {
  return new Date(dt).toISOString();
}

export function parseId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function fmtMoney(value, currency = 'USD') {
  if (value == null) return null;
  const syms = { USD: '$', EUR: '€', GBP: '£' };
  return `${syms[currency] || ''}${Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function ok(res, data, meta) {
  return res.json({ ok: true, data, meta });
}

export function fail(res, status, code, message) {
  return res.status(status).json({ ok: false, code, message });
}
