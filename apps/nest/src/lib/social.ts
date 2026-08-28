import type { WalletClient } from "viem";

/**
 * Client for the nest-social service. One wallet signature opens a 30-day
 * session; after that every action is a plain authenticated fetch — no
 * gas, no prompts.
 */
export const SOCIAL = "https://api.dotrobin.xyz/social";

export type Chirp = {
  id: string;
  name: string;
  gold: boolean;
  text: string;
  imageUrl: string | null;
  replyTo: string | null;
  createdAt: number;
  likes: number;
  replies: number;
  liked: boolean;
};

export type Notification = {
  id: string;
  kind: "follow" | "mention" | "reply" | "like";
  actor: string;
  chirp_id: string | null;
  created_at: string;
  read: boolean;
};

const KEY = "nest:social-session";

type Stored = { address: string; token: string; name: string | null; gold: boolean };

export function storedSession(address: string | undefined): Stored | null {
  if (!address) return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    return s.address === address.toLowerCase() ? s : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
}

/** Sign in (one wallet signature) unless a session for this address exists. */
export async function ensureSession(
  walletClient: WalletClient,
  address: string,
): Promise<Stored> {
  const existing = storedSession(address);
  if (existing) return existing;
  const issuedAt = Math.floor(Date.now() / 1000);
  const message = `nest social session\naddress: ${address.toLowerCase()}\nissued: ${issuedAt}`;
  const signature = await walletClient.signMessage({
    account: address as `0x${string}`,
    message,
  });
  const res = await fetch(`${SOCIAL}/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: address.toLowerCase(), issuedAt, signature }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "sign-in failed");
  const stored: Stored = {
    address: address.toLowerCase(),
    token: body.token,
    name: body.name,
    gold: body.gold,
  };
  localStorage.setItem(KEY, JSON.stringify(stored));
  return stored;
}

function headers(token?: string): HeadersInit {
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
}

async function call<T>(
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${SOCIAL}${path}`, {
    method: opts.method ?? "GET",
    headers: headers(opts.token),
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `${res.status}`);
  return data as T;
}

export const social = {
  feed: (scope: "all" | "following", token?: string) =>
    call<{ chirps: Chirp[] }>(`/feed${scope === "following" ? "?scope=following" : ""}`, { token }),
  chirpsOf: (name: string, token?: string) =>
    call<{ chirps: Chirp[] }>(`/chirps/${name}`, { token }),
  thread: (id: string, token?: string) =>
    call<{ chirp: Chirp | null; replies: Chirp[] }>(`/thread/${id}`, { token }),
  post: (token: string, body: { text: string; imageUrl?: string; replyTo?: string }) =>
    call<Chirp>(`/chirp`, { method: "POST", token, body }),
  remove: (token: string, id: string) =>
    call<{ ok: true }>(`/chirp/${id}`, { method: "DELETE", token }),
  like: (token: string, id: string, on: boolean) =>
    call<{ ok: true }>(`/chirp/${id}/like`, { method: on ? "POST" : "DELETE", token }),
  follow: (token: string, name: string, on: boolean) =>
    call<{ ok: true }>(`/follow/${name}`, { method: on ? "POST" : "DELETE", token }),
  follows: (name: string, token?: string) =>
    call<{ followers: number; following: number; followedByMe: boolean }>(`/follows/${name}`, {
      token,
    }),
  inbox: (token: string) => call<{ notifications: Notification[] }>(`/inbox`, { token }),
  inboxRead: (token: string) => call<{ ok: true }>(`/inbox/read`, { method: "POST", token }),
  report: (token: string, id: string) =>
    call<{ ok: true }>(`/report/${id}`, { method: "POST", token }),
};

export async function uploadImage(token: string, file: File): Promise<string> {
  const form = new FormData();
  form.append("image", file);
  const res = await fetch(`${SOCIAL}/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "upload failed");
  return data.url as string;
}
