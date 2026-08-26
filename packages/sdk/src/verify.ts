// Typed clients for Robin's REST endpoints — /verify/:name and /tickers.
//
// These are index-backed reads served from api.dotrobin.xyz (or any
// self-hosted robin indexer). For trustless on-chain resolution use the
// viem actions instead; these endpoints add derived state a single RPC
// call can't give you — verification verdicts and the ticker registry.

type Hex = `0x${string}`;

export const DEFAULT_API_URL = "https://api.dotrobin.xyz";

export type VerifyChecks = {
  registered: boolean;
  rootActive: boolean;
  addressSet: boolean;
  primaryMatch: boolean;
};

export type TickerInfo = {
  symbol: string;
  kind: string | null;
  contract: Hex;
  /**
   * true only when the name is held by the protocol treasury Safe — the
   * signal that the ticker → contract mapping is protocol-curated. Always
   * check this before trusting a mapping.
   */
  official: boolean;
};

export type VerifyResult = {
  name: string;
  node: Hex;
  verified: boolean;
  checks: VerifyChecks;
  address: Hex | null;
  owner: Hex | null;
  primaryName: string | null;
  root: {
    name: string;
    node: Hex;
    owner: Hex;
    expiresAt: string;
    active: boolean;
    wrapped: boolean;
  } | null;
  records: Record<string, string>;
  ticker: TickerInfo | null;
  asOf: string;
};

export type TickerListing = {
  name: string;
  node: Hex;
  symbol: string;
  kind: string | null;
  contract: Hex;
  official: boolean;
  active: boolean;
  expiresAt: string | null;
  url: string | null;
  description: string | null;
  updatedAt: string | null;
};

export type ApiOptions = {
  /** Base URL of a robin indexer (default: the public api.dotrobin.xyz). */
  apiUrl?: string;
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`robin api ${res.status} for ${url}`);
  return (await res.json()) as T;
}

/**
 * Verify a .robin name: registered, unexpired root, address set — plus its
 * records and (when present) its ticker listing. Accepts a bare label,
 * a full name, or a subname.
 */
export async function verifyName(
  name: string,
  opts: ApiOptions = {},
): Promise<VerifyResult> {
  const base = opts.apiUrl ?? DEFAULT_API_URL;
  return getJson<VerifyResult>(
    `${base}/verify/${encodeURIComponent(name.trim())}`,
  );
}

/** The full ticker registry, official listings first. */
export async function getTickers(
  opts: ApiOptions = {},
): Promise<TickerListing[]> {
  const base = opts.apiUrl ?? DEFAULT_API_URL;
  const body = await getJson<{ tickers: TickerListing[] }>(`${base}/tickers`);
  return body.tickers;
}

/**
 * Canonical contract for one ticker, or null if there is no official
 * listing. `getTicker("usdg")` → the one true USDG token on Robinhood
 * Chain. Unofficial (community) records never pass this filter — use
 * verifyName() to inspect those.
 */
export async function getTicker(
  symbolOrLabel: string,
  opts: ApiOptions = {},
): Promise<TickerInfo | null> {
  const result = await verifyName(symbolOrLabel, opts);
  return result.ticker?.official ? result.ticker : null;
}
