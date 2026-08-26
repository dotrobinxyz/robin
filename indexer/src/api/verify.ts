import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { and, desc, eq, inArray, isNotNull, ne } from "ponder";
import { namehash, normalize } from "viem/ens";

/**
 * Verification + ticker registry API — /verify/:name and /tickers.
 *
 * Served entirely from the index (no RPC round-trips). A name "verifies" when
 * its node exists, its root .robin registration is unexpired, and it has a
 * chain address record. A matching primary name (reverse record) is reported
 * as a stronger, optional signal.
 *
 * Ticker registry: a name that publishes a `ticker.contract` text record maps
 * a ticker to a token contract. The listing is only **official** when the
 * name is owned by the protocol treasury (the deployment's finalOwner Safe) —
 * anyone can write records on their own name, but only Safe-held names are
 * protocol-curated. Consumers MUST check `official` before trusting a
 * ticker → contract mapping.
 */

type Hex = `0x${string}`;

const ETH_COIN_TYPE = 60n;
const TICKER_CONTRACT_KEY = "ticker.contract";
const TICKER_SYMBOL_KEY = "ticker.symbol";
const TICKER_KIND_KEY = "ticker.kind";
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

const str = (v: bigint | null | undefined) => (v == null ? null : v.toString());

/** The treasury Safe — names it owns carry protocol-curated records. */
const SAFE: Hex | null = (() => {
  try {
    const network = process.env.ROBIN_NETWORK ?? "local";
    const deployment = JSON.parse(
      readFileSync(
        process.env.DEPLOYMENT_FILE ??
          join(process.cwd(), `../contracts/deployments/robin-${network}.json`),
        "utf8",
      ),
    ) as Record<string, string>;
    const owner = deployment.finalOwner;
    return owner && ADDRESS_RE.test(owner)
      ? (owner.toLowerCase() as Hex)
      : null;
  } catch {
    return null;
  }
})();

function parseRobinName(
  raw: string,
): { name: string; labels: string[] } | null {
  let n = decodeURIComponent(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  if (n.length === 0) return null;
  if (!n.includes(".")) n = `${n}.robin`;
  let name: string;
  try {
    name = normalize(n);
  } catch {
    return null;
  }
  const labels = name.split(".");
  if (labels.length < 2) return null;
  if (labels[labels.length - 1] !== "robin") return null;
  if (labels.some((l) => l.length === 0)) return null;
  return { name, labels };
}

async function recordsAt(node: Hex) {
  const [texts, addrs] = await Promise.all([
    db.select().from(schema.textRecord).where(eq(schema.textRecord.node, node)),
    db
      .select()
      .from(schema.addressRecord)
      .where(
        and(
          eq(schema.addressRecord.node, node),
          eq(schema.addressRecord.coinType, ETH_COIN_TYPE),
        ),
      )
      .limit(1),
  ]);
  const records: Record<string, string> = {};
  for (const t of texts) if (t.value) records[t.key] = t.value;
  return { records, address: (addrs[0]?.value ?? null) as Hex | null };
}

function tickerBlock(
  labels: string[],
  records: Record<string, string>,
  owner: Hex | null,
  rootActive: boolean,
) {
  const contract = records[TICKER_CONTRACT_KEY];
  if (!contract || !ADDRESS_RE.test(contract)) return null;
  return {
    symbol:
      records[TICKER_SYMBOL_KEY] ?? labels[0]!.toUpperCase(),
    kind: records[TICKER_KIND_KEY] ?? null,
    contract: contract as Hex,
    official:
      SAFE != null &&
      owner != null &&
      owner.toLowerCase() === SAFE &&
      labels.length === 2 &&
      rootActive,
  };
}

export const verifyApi = new Hono();

verifyApi.get("/verify", (c) =>
  c.json({
    usage: "GET /verify/:name — verify a .robin name",
    example: "/verify/goldfinch.robin",
    tickers: "GET /tickers — the official ticker → contract registry",
  }),
);

verifyApi.get("/verify/:name", async (c) => {
  const parsed = parseRobinName(c.req.param("name"));
  if (!parsed) {
    return c.json({ error: "not a valid .robin name" }, 400);
  }
  const { name, labels } = parsed;
  const node = namehash(name) as Hex;
  const rootName = labels.slice(-2).join(".");
  const rootNode = namehash(rootName) as Hex;
  const now = BigInt(Math.floor(Date.now() / 1000));

  const [rootRows, subRows, { records, address }] = await Promise.all([
    db
      .select()
      .from(schema.name)
      .where(eq(schema.name.node, rootNode))
      .limit(1),
    labels.length > 2
      ? db
          .select()
          .from(schema.subname)
          .where(eq(schema.subname.id, node))
          .limit(1)
      : Promise.resolve([]),
    recordsAt(node),
  ]);
  const root = rootRows[0] ?? null;
  const sub = subRows[0] ?? null;

  // Records can only be set by the node's owner, so their presence proves the
  // node exists even when a subname was created outside the wrapper.
  const hasRecords = address != null || Object.keys(records).length > 0;
  const registered =
    labels.length === 2 ? root != null : sub != null || hasRecords;
  const rootActive = root != null && root.expiresAt > now;
  const owner = ((labels.length === 2 ? root?.owner : sub?.owner) ??
    null) as Hex | null;

  let primary: string | null = null;
  if (address) {
    const p = await db
      .select()
      .from(schema.primaryName)
      .where(eq(schema.primaryName.address, address.toLowerCase() as Hex))
      .limit(1);
    primary = p[0]?.name ?? null;
  }

  const checks = {
    registered,
    rootActive,
    addressSet: address != null,
    primaryMatch: address != null && primary === name,
  };

  c.header("cache-control", "public, max-age=30");
  return c.json({
    name,
    node,
    verified: checks.registered && checks.rootActive && checks.addressSet,
    checks,
    address,
    owner,
    primaryName: primary,
    root: root
      ? {
          name: rootName,
          node: rootNode,
          owner: root.owner,
          expiresAt: str(root.expiresAt),
          active: rootActive,
          wrapped: root.wrapped,
        }
      : null,
    records,
    ticker: tickerBlock(labels, records, owner, rootActive),
    asOf: str(now),
  });
});

/** The ticker → token-contract registry, built from ticker.contract records. */
verifyApi.get("/tickers", async (c) => {
  const now = BigInt(Math.floor(Date.now() / 1000));

  const contractRecords = await db
    .select()
    .from(schema.textRecord)
    .where(
      and(
        eq(schema.textRecord.key, TICKER_CONTRACT_KEY),
        isNotNull(schema.textRecord.value),
        ne(schema.textRecord.value, ""),
      ),
    )
    .orderBy(desc(schema.textRecord.updatedAt))
    .limit(500);

  const nodes = contractRecords
    .filter((r) => r.value && ADDRESS_RE.test(r.value))
    .map((r) => r.node as Hex);
  if (nodes.length === 0) {
    c.header("cache-control", "public, max-age=30");
    return c.json({ tickers: [], total: 0, asOf: str(now) });
  }

  const [names2ld, extraTexts] = await Promise.all([
    db.select().from(schema.name).where(inArray(schema.name.node, nodes)),
    db
      .select()
      .from(schema.textRecord)
      .where(
        and(
          inArray(schema.textRecord.node, nodes),
          inArray(schema.textRecord.key, [
            TICKER_SYMBOL_KEY,
            TICKER_KIND_KEY,
            "url",
            "description",
          ]),
        ),
      ),
  ]);
  const nameByNode = new Map(names2ld.map((n) => [n.node as Hex, n]));
  const textsByNode = new Map<Hex, Record<string, string>>();
  for (const t of extraTexts) {
    if (!t.value) continue;
    const rec = textsByNode.get(t.node as Hex) ?? {};
    rec[t.key] = t.value;
    textsByNode.set(t.node as Hex, rec);
  }

  const tickers = [];
  for (const r of contractRecords) {
    const node = r.node as Hex;
    if (!r.value || !ADDRESS_RE.test(r.value)) continue;
    const row = nameByNode.get(node);
    if (!row || !row.label) continue; // only 2LDs can be listings
    const active = row.expiresAt > now;
    const texts = textsByNode.get(node) ?? {};
    tickers.push({
      name: `${row.label}.robin`,
      node,
      symbol: texts[TICKER_SYMBOL_KEY] ?? row.label.toUpperCase(),
      kind: texts[TICKER_KIND_KEY] ?? null,
      contract: r.value as Hex,
      official:
        SAFE != null && row.owner.toLowerCase() === SAFE && active,
      active,
      expiresAt: str(row.expiresAt),
      url: texts["url"] ?? null,
      description: texts["description"] ?? null,
      updatedAt: str(r.updatedAt),
    });
  }
  tickers.sort(
    (a, b) =>
      Number(b.official) - Number(a.official) ||
      a.symbol.localeCompare(b.symbol),
  );

  c.header("cache-control", "public, max-age=30");
  return c.json({ tickers, total: tickers.length, asOf: str(now) });
});
