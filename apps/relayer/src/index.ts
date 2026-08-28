import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import pg from "pg";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  formatEther,
  http,
  parseAbi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { randomUUID } from "node:crypto";

/**
 * nest-relayer — submits passkey-signed batches for RobinAccount wallets
 * and pays their gas. The account contract's signature check is the real
 * authorization; this service only decides WHOSE gas gets sponsored:
 *
 *   everyone:            DAILY_FREE sponsored txs per account per day
 *   gold names / ROBIN:  DAILY_BOOSTED — the token utility promise
 *
 * Gas on Robinhood Chain costs fractions of a cent, so sponsorship is a
 * rounding error next to the abuse limits that cap it.
 */
const PORT = Number(process.env.PORT ?? 42072);
const FACTORY = "0x518DbE1CEe1d0a9D21CcFa423D7707925743bDfC" as const;
const ROBIN_TOKEN = "0x4f3b422051a7d183A017898179961c9e9d50ac7c" as const;
const ROBIN_THRESHOLD = 100_000n * 10n ** 18n; // hold 100K ROBIN → boosted
const DAILY_FREE = 10;
const DAILY_BOOSTED = 100;
const MAX_CALLS = 10;
const MAX_DATA_BYTES = 40_000;
const GAS_CAP = 3_000_000n;

const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.RPC_URL ?? "https://robinhood-rpc.publicnode.com"] },
  },
});

const relayerAccount = privateKeyToAccount(process.env.RELAYER_PK as Hex);
const publicClient = createPublicClient({ chain, transport: http() });
const walletClient = createWalletClient({ chain, transport: http(), account: relayerAccount });

const factoryAbi = parseAbi([
  "function createAccount(uint256 x, uint256 y) returns (address)",
  "function getAddress(uint256 x, uint256 y) view returns (address)",
]);

const accountAbi = parseAbi([
  "struct Call { address target; uint256 value; bytes data; }",
  "struct WebAuthnAuth { bytes authenticatorData; string clientDataJSON; uint256 challengeLocation; uint256 responseTypeLocation; uint256 r; uint256 s; }",
  "function executeBatch(Call[] calls, WebAuthnAuth auth) payable",
  "function nonce() view returns (uint256)",
]);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

async function migrate() {
  await pool.query(`
    create schema if not exists relayer;
    create table if not exists relayer.relay_log (
      id uuid primary key,
      account text not null,
      tx_hash text,
      created_at bigint not null
    );
    create index if not exists relay_acct_idx on relayer.relay_log (account, created_at desc);
  `);
}

/** Sponsorship tier: boosted for gold primary names and ROBIN holders. */
async function dailyLimit(account: string): Promise<number> {
  try {
    const bal = await publicClient.readContract({
      address: ROBIN_TOKEN,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account as Hex],
    });
    if (bal >= ROBIN_THRESHOLD) return DAILY_BOOSTED;
  } catch {
    // fall through to the gold check
  }
  try {
    const rows = await pool.query(
      `select 1
         from robin_mainnet.primary_name p
         join robin_mainnet.gold_band g
           on g.label = replace(p.name, '.robin', '')
        where p.address = $1 and g.until > $2
        limit 1`,
      [account.toLowerCase(), Math.floor(Date.now() / 1000)],
    );
    if (rows.rows.length > 0) return DAILY_BOOSTED;
  } catch {
    // indexer schema unavailable — free tier still works
  }
  return DAILY_FREE;
}

async function usedToday(account: string): Promise<number> {
  const dayStart = Math.floor(Date.now() / 1000) - 86400;
  const res = await pool.query(
    `select count(*) as n from relayer.relay_log where account = $1 and created_at > $2`,
    [account.toLowerCase(), dayStart],
  );
  return Number(res.rows[0].n);
}

// Relayer EOA nonce discipline: serialize submissions.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

type RelayBody = {
  account: Hex;
  x?: string;
  y?: string;
  calls: { target: Hex; value: string; data: Hex }[];
  auth: {
    authenticatorData: Hex;
    clientDataJSON: string;
    challengeLocation: number;
    responseTypeLocation: number;
    r: string;
    s: string;
  };
};

const app = new Hono();
app.use("*", cors({ origin: "*", allowHeaders: ["Content-Type"] }));

app.get("/health", async (c) => {
  const balance = await publicClient.getBalance({ address: relayerAccount.address });
  return c.json({
    ok: true,
    relayer: relayerAccount.address,
    balance: formatEther(balance),
    factory: FACTORY,
  });
});

app.get("/account/:x/:y", async (c) => {
  const x = BigInt(c.req.param("x"));
  const y = BigInt(c.req.param("y"));
  const address = await publicClient.readContract({
    address: FACTORY,
    abi: factoryAbi,
    functionName: "getAddress",
    args: [x, y],
  });
  const [code, balance] = await Promise.all([
    publicClient.getCode({ address }),
    publicClient.getBalance({ address }),
  ]);
  const nonce =
    code && code !== "0x"
      ? await publicClient.readContract({ address, abi: accountAbi, functionName: "nonce" })
      : 0n;
  return c.json({
    address,
    deployed: Boolean(code && code !== "0x"),
    nonce: nonce.toString(),
    balance: balance.toString(),
  });
});

app.post("/relay", async (c) => {
  const body = await c.req.json<RelayBody>().catch(() => null);
  if (!body?.account || !Array.isArray(body.calls) || !body.auth) {
    return c.json({ error: "account, calls, auth required" }, 400);
  }
  if (body.calls.length === 0 || body.calls.length > MAX_CALLS) {
    return c.json({ error: `1..${MAX_CALLS} calls` }, 400);
  }
  const dataBytes = body.calls.reduce((n, x) => n + (x.data.length - 2) / 2, 0);
  if (dataBytes > MAX_DATA_BYTES) return c.json({ error: "calldata too large" }, 400);

  const account = body.account.toLowerCase() as Hex;
  const [limit, used] = await Promise.all([dailyLimit(account), usedToday(account)]);
  if (used >= limit) {
    return c.json(
      {
        error:
          limit === DAILY_FREE
            ? `daily free limit reached (${DAILY_FREE}) — gold names and 100K+ $ROBIN holders get ${DAILY_BOOSTED}/day`
            : `daily limit reached (${limit})`,
      },
      429,
    );
  }

  const calls = body.calls.map((x) => ({
    target: x.target,
    value: BigInt(x.value),
    data: x.data,
  }));
  const auth = {
    authenticatorData: body.auth.authenticatorData,
    clientDataJSON: body.auth.clientDataJSON,
    challengeLocation: BigInt(body.auth.challengeLocation),
    responseTypeLocation: BigInt(body.auth.responseTypeLocation),
    r: BigInt(body.auth.r),
    s: BigInt(body.auth.s),
  };

  try {
    const result = await enqueue(async () => {
      // First transaction ever? Deploy the counterfactual account.
      const code = await publicClient.getCode({ address: body.account });
      if ((!code || code === "0x") && body.x && body.y) {
        const predicted = await publicClient.readContract({
          address: FACTORY,
          abi: factoryAbi,
          functionName: "getAddress",
          args: [BigInt(body.x), BigInt(body.y)],
        });
        if (predicted.toLowerCase() !== account) throw new Error("key does not match account");
        const deployHash = await walletClient.writeContract({
          address: FACTORY,
          abi: factoryAbi,
          functionName: "createAccount",
          args: [BigInt(body.x), BigInt(body.y)],
        });
        await publicClient.waitForTransactionReceipt({ hash: deployHash });
      }

      // Simulate: rejects bad signatures, wrong nonces, reverting calls.
      const { request } = await publicClient.simulateContract({
        address: body.account,
        abi: accountAbi,
        functionName: "executeBatch",
        args: [calls, auth],
        account: relayerAccount,
        gas: GAS_CAP,
      });
      const hash = await walletClient.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { hash, status: receipt.status };
    });

    await pool.query(
      `insert into relayer.relay_log (id, account, tx_hash, created_at) values ($1,$2,$3,$4)`,
      [randomUUID(), account, result.hash, Math.floor(Date.now() / 1000)],
    );
    return c.json({ txHash: result.hash, status: result.status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const short = msg.split("\n")[0]!.slice(0, 300);
    return c.json({ error: short }, 400);
  }
});

await migrate();
serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" });
console.log(`nest-relayer ${relayerAccount.address} listening on ${PORT}`);
