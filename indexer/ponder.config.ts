import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createConfig } from "ponder";

import {
  publicResolverAbi,
  reverseRegistrarAbi,
  robinBaseRegistrarAbi,
  robinRegistrarControllerAbi,
  robinRegistryAbi,
  robinReservedListAbi,
  robinWrapperAbi,
} from "./abis/robin";

// Network selection: ROBIN_NETWORK ∈ local | robinhood-testnet | robinhood.
// Addresses come straight from the deploy script's record, so the indexer
// can never drift from what's on chain.
const network = process.env.ROBIN_NETWORK ?? "local";

const CHAINS: Record<string, { id: number; rpc: string | string[] }> = {
  local: { id: 31337, rpc: process.env.RPC_URL ?? "http://127.0.0.1:8545" },
  "robinhood-testnet": {
    id: 46630,
    // The official endpoint is load-balanced with laggy replicas
    // (BlockNotFoundError on fresh heads) — give ponder fallbacks.
    rpc: process.env.RPC_URL
      ? [process.env.RPC_URL]
      : [
          "https://rpc.testnet.chain.robinhood.com",
          "https://robinhood-testnet.drpc.org",
          "https://robinhood-sepolia-rpc.publicnode.com",
        ],
  },
  robinhood: {
    id: 4663,
    rpc: process.env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com",
  },
};

const chainInfo = CHAINS[network];
if (!chainInfo) throw new Error(`unknown ROBIN_NETWORK: ${network}`);

const deployment = JSON.parse(
  readFileSync(
    process.env.DEPLOYMENT_FILE ??
      join(__dirname, `../contracts/deployments/robin-${network}.json`),
    "utf8",
  ),
) as Record<string, string>;

const startBlock = Number(process.env.START_BLOCK ?? 0);

export default createConfig({
  // In production set DATABASE_URL (Postgres). For dev, PGlite — kept off
  // Windows-mounted paths (WSL drvfs I/O stalls it); override with PGLITE_DIR.
  database: process.env.DATABASE_URL
    ? { kind: "postgres", connectionString: process.env.DATABASE_URL }
    : {
        kind: "pglite",
        directory:
          process.env.PGLITE_DIR ??
          join(
            process.env.HOME ?? ".",
            ".robin-indexer",
            `pglite-${network}`,
          ),
      },
  chains: {
    robinhood: { id: chainInfo.id, rpc: chainInfo.rpc },
  },
  contracts: {
    RobinRegistrarController: {
      chain: "robinhood",
      abi: robinRegistrarControllerAbi,
      address: deployment.RobinRegistrarController as `0x${string}`,
      startBlock,
    },
    RobinBaseRegistrar: {
      chain: "robinhood",
      abi: robinBaseRegistrarAbi,
      address: deployment.RobinBaseRegistrar as `0x${string}`,
      startBlock,
    },
    RobinWrapper: {
      chain: "robinhood",
      abi: robinWrapperAbi,
      address: deployment.RobinWrapper as `0x${string}`,
      startBlock,
    },
    RobinRegistry: {
      chain: "robinhood",
      abi: robinRegistryAbi,
      address: deployment.RobinRegistry as `0x${string}`,
      startBlock,
    },
    RobinReservedList: {
      chain: "robinhood",
      abi: robinReservedListAbi,
      address: deployment.RobinReservedList as `0x${string}`,
      startBlock,
    },
    PublicResolver: {
      chain: "robinhood",
      abi: publicResolverAbi,
      address: deployment.PublicResolver as `0x${string}`,
      startBlock,
    },
    ReverseRegistrar: {
      chain: "robinhood",
      abi: reverseRegistrarAbi,
      address: deployment.ReverseRegistrar as `0x${string}`,
      startBlock,
    },
  },
});
