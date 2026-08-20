// KEYLESS premium-batch preparation: 16 curated names, owner = the Safe,
// 1 year, no resolver records (treasury custody). Computes commitments,
// register calldata, and ETH values; writes the plan (with commit secrets)
// to ~/.robin-mainnet/premium-plan.json for the cast signing step.
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
  robinRegistrarControllerAbi,
} from "../dist/index.js";

// Names register TO the sale contract (it owns and sells them; the Safe
// owns the sale contract). Pass its address via PREMIUM_OWNER.
const OWNER = process.env.PREMIUM_OWNER;
if (!OWNER || OWNER.length !== 42) {
  console.error("set PREMIUM_OWNER to the deployed RobinPremiumSale address");
  process.exit(1);
}
const LABELS = [
  "vitalik", "satoshi", "elon", "brian", "jesse", "hayden", "sergey",
  "anatoly", "saylor", "balaji", "naval", "stani", "cobie", "ansem",
  "gcr", "justin",
];

const A = ROBIN_ADDRESSES[4663];
const pub = createPublicClient({ chain: robinhoodChain, transport: http() });
let total = 0n;
const items = [];
for (const label of LABELS) {
  const avail = await pub.readContract({
    address: A.controller, abi: robinRegistrarControllerAbi,
    functionName: "available", args: [label],
  });
  if (!avail) { console.log(`SKIP ${label} — no longer available!`); continue; }
  const reg = makeRegistration({
    label, owner: OWNER, duration: 31_536_000n, secret: randomSecret(),
  });
  const price = await pub.readContract({
    address: A.controller, abi: robinRegistrarControllerAbi,
    functionName: "rentPrice", args: [label, 31_536_000n],
  });
  const value = ((price.base + price.premium) * 105n) / 100n;
  total += value;
  items.push({
    label,
    commitment: makeCommitment(reg),
    registerData: encodeFunctionData({
      abi: robinRegistrarControllerAbi, functionName: "register", args: [reg],
    }),
    value: value.toString(),
  });
  console.log(`${label}: ${(Number(value) / 1e18).toFixed(5)} ETH`);
}
mkdirSync(join(homedir(), ".robin-mainnet"), { recursive: true });
writeFileSync(
  join(homedir(), ".robin-mainnet", "premium-plan.json"),
  JSON.stringify({ controller: A.controller, items }, null, 2),
);
console.log(`\n${items.length} names, total ≈ ${(Number(total) / 1e18).toFixed(4)} ETH (+gas)`);
console.log("PLAN_WRITTEN");
