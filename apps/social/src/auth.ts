import { createHmac, timingSafeEqual } from "node:crypto";
import { verifyMessage } from "viem";
import type { Context } from "hono";

/**
 * Session auth: the wallet signs one message, the service hands back an
 * HMAC token good for 30 days. Likes and follows then cost zero prompts.
 *
 * The client must sign EXACTLY:
 *   nest social session\naddress: <0x lowercase>\nissued: <unix seconds>
 */
const SESSION_TTL = 30 * 86400;
const SKEW = 600;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET not set");
  return s;
}

export function sessionMessage(address: string, issuedAt: number): string {
  return `nest social session\naddress: ${address.toLowerCase()}\nissued: ${issuedAt}`;
}

export async function issueToken(
  address: string,
  issuedAt: number,
  signature: `0x${string}`,
): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - issuedAt) > SKEW) return null;
  const ok = await verifyMessage({
    address: address as `0x${string}`,
    message: sessionMessage(address, issuedAt),
    signature,
  }).catch(() => false);
  if (!ok) return null;
  const payload = Buffer.from(
    JSON.stringify({ a: address.toLowerCase(), e: now + SESSION_TTL }),
  ).toString("base64url");
  const mac = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function tokenAddress(token: string | undefined): string | null {
  if (!token) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expect = createHmac("sha256", secret()).update(payload).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      a: string;
      e: number;
    };
    if (data.e < Date.now() / 1000) return null;
    return data.a;
  } catch {
    return null;
  }
}

export function bearerAddress(c: Context): string | null {
  const h = c.req.header("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  return tokenAddress(h.slice(7));
}
