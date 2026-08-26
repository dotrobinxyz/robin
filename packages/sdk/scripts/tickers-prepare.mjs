// KEYLESS ticker-wave preparation: registry names, owner = the treasury Safe,
// 1 year, ticker.* + description records baked into the registration data so
// listings go live atomically with the register (no separate records
// ceremony). Computes commitments, register calldata, ETH values, and the
// setReserved(false) calldata the Safe must batch for reserved labels.
// Writes the plan (with commit secrets) to ~/.robin-mainnet/tickers-plan.json.
import { createPublicClient, http, encodeFunctionData } from "viem";
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  robinhoodChain,
  ROBIN_ADDRESSES,
  makeRegistration,
  makeCommitment,
  randomSecret,
  robinNode,
  robinRegistrarControllerAbi,
  robinReservedListAbi,
  publicResolverAbi,
} from "../dist/index.js";

const OWNER = process.env.TICKER_OWNER;
if (!OWNER || OWNER.length !== 42) {
  console.error("set TICKER_OWNER to the treasury Safe address");
  process.exit(1);
}

// Wave T1. `contract` only where the canonical token already exists on 4663 —
// the rest are registered to protect the label and listed later.
const WAVE = [
  { label: "usdg", kind: "stable", contract: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", reserved: true,
    description: "Global Dollar — the canonical USDG token on Robinhood Chain." },
  { label: "weth", kind: "crypto", contract: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", reserved: true,
    description: "Wrapped Ether — the canonical WETH token on Robinhood Chain." },
  { label: "tsla", kind: "equity", reserved: true },
  { label: "aapl", kind: "equity", reserved: true },
  { label: "nvda", kind: "equity", reserved: true },
  { label: "hood", kind: "equity", reserved: true },
  { label: "openai", kind: "private", reserved: false },
  { label: "spacex", kind: "private", reserved: false },
];

const A = ROBIN_ADDRESSES[4663];
const pub = createPublicClient({ chain: robinhoodChain, transport: http() });
let total = 0n;
const items = [];
for (const t of WAVE) {
  if (!t.reserved) {
    const avail = await pub.readContract({
      address: A.controller, abi: robinRegistrarControllerAbi,
      functionName: "available", args: [t.label],
    });
    if (!avail) { console.log(`SKIP ${t.label} — no longer available!`); continue; }
  }
  const node = robinNode(t.label);
  const texts = {
    "ticker.symbol": t.label.toUpperCase(),
    "ticker.kind": t.kind,
    ...(t.contract ? { "ticker.contract": t.contract } : {}),
    description:
      t.description ??
      `Reserved for the canonical ${t.label.toUpperCase()} listing on Robinhood Chain.`,
  };
  const data = Object.entries(texts).map(([key, value]) =>
    encodeFunctionData({
      abi: publicResolverAbi,
      functionName: "setText",
      args: [node, key, value],
    }),
  );
  const reg = makeRegistration({
    label: t.label, owner: OWNER, duration: 31_536_000n, secret: randomSecret(),
    resolver: A.publicResolver, data,
  });
  const price = await pub.readContract({
    address: A.controller, abi: robinRegistrarControllerAbi,
    functionName: "rentPrice", args: [t.label, 31_536_000n],
  });
  const value = ((price.base + price.premium) * 105n) / 100n;
  total += value;
  items.push({
    label: t.label,
    reserved: t.reserved,
    commitment: makeCommitment(reg),
    registerData: encodeFunctionData({
      abi: robinRegistrarControllerAbi, functionName: "register", args: [reg],
    }),
    value: value.toString(),
  });
  console.log(
    `${t.label}${t.reserved ? " (reserved)" : ""}: ${(Number(value) / 1e18).toFixed(5)} ETH` +
      (t.contract ? ` → lists ${t.contract}` : ""),
  );
}
// setReserved is batch-native (string[]) — the Safe makes ONE direct call to
// the reserved list, no MultiSend wrapping needed.
const reservedLabels = items.filter((i) => i.reserved).map((i) => i.label);
const unreserveData =
  reservedLabels.length > 0
    ? encodeFunctionData({
        abi: robinReservedListAbi,
        functionName: "setReserved",
        args: [reservedLabels, false],
      })
    : null;

mkdirSync(join(homedir(), ".robin-mainnet"), { recursive: true });
writeFileSync(
  join(homedir(), ".robin-mainnet", "tickers-plan.json"),
  JSON.stringify(
    {
      controller: A.controller,
      reservedList: A.reservedList,
      safe: OWNER,
      reservedLabels,
      unreserveData,
      items,
    },
    null,
    2,
  ),
);
console.log(`\n${items.length} names, total ≈ ${(Number(total) / 1e18).toFixed(4)} ETH (+gas)`);
console.log("PLAN_WRITTEN");
