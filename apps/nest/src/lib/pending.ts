import type { Registration } from "robin-names";
import type { Hex } from "viem";

/**
 * A commit-reveal registration in flight. Persisted to localStorage so an app
 * close or wallet roundtrip between commit and reveal never loses the secret.
 * Same format as the web app, plus a last-label pointer so the register sheet
 * can resume automatically on reopen.
 */
export type PendingRegistration = {
  registration: Registration;
  commitment: Hex;
  committedAt: number;
  currency: "USDG" | "ETH";
};

const key = (chainId: number, label: string) => `robin:pending:${chainId}:${label}`;
const lastKey = (chainId: number) => `robin:pending-last:${chainId}`;

export function savePending(chainId: number, pending: PendingRegistration): void {
  localStorage.setItem(
    key(chainId, pending.registration.label),
    JSON.stringify(pending, (_, v) => (typeof v === "bigint" ? `#bigint:${v}` : v)),
  );
  localStorage.setItem(lastKey(chainId), pending.registration.label);
}

export function loadPending(chainId: number, label: string): PendingRegistration | null {
  const raw = localStorage.getItem(key(chainId, label));
  if (!raw) return null;
  try {
    return JSON.parse(raw, (_, v) =>
      typeof v === "string" && v.startsWith("#bigint:") ? BigInt(v.slice(8)) : v,
    ) as PendingRegistration;
  } catch {
    return null;
  }
}

export function clearPending(chainId: number, label: string): void {
  localStorage.removeItem(key(chainId, label));
  if (localStorage.getItem(lastKey(chainId)) === label) {
    localStorage.removeItem(lastKey(chainId));
  }
}

export function lastPendingLabel(chainId: number): string | null {
  const label = localStorage.getItem(lastKey(chainId));
  return label && loadPending(chainId, label) ? label : null;
}
