import { timingSafeEqual } from "node:crypto";

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Constant-time check of the shared secret. HMAC-over-body is planned for Phase 1. */
export function validSignature(provided: string | null, secret: string): boolean {
  return provided ? safeEqual(provided, secret) : false;
}
