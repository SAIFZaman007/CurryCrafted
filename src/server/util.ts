import { randomInt } from "crypto";

/* Small shared helpers: input coercion, formatting and response shaping. */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PHONE_RE = /^[0-9+()\s-]{7,20}$/;

export type Json = Record<string, unknown>;

/** Trimmed, length-capped string; anything that isn't a string becomes "". */
export function text(value: unknown, maxLen = 200): string {
  return typeof value === "string" ? value.trim().slice(0, maxLen) : "";
}

/** Lenient numeric coercion for untrusted JSON. Returns null when the value isn't a finite number. */
export function num(value: unknown): number | null {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function whole(value: unknown): number | null {
  const n = num(value);
  return n === null ? null : Math.floor(n);
}

export function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function formatPrice(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  return `${sign}£${(Math.abs(pence) / 100).toFixed(2)}`;
}

export function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no easily confused characters
export function randomCode(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
