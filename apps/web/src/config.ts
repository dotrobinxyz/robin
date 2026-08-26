import { http, createConfig } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { defineChain, type Chain } from "viem";
import {
  robinAddressesFrom,
  withRobin,
  type RobinAddresses,
} from "robin-names";
import { DEPLOYMENTS } from "./generated/deployments";

export type NetworkKey = "local" | "robinhood-testnet" | "robinhood";

export const NETWORK = (import.meta.env.VITE_ROBIN_NETWORK ??
  "local") as NetworkKey;

const deployment = (DEPLOYMENTS as Record<string, unknown>)[NETWORK] as
  | Parameters<typeof robinAddressesFrom>[0]
  | undefined;
if (!deployment) {
  throw new Error(
    `No deployment record for network "${NETWORK}" — run the deploy and apps/web/scripts/sync-addresses.mjs`,
  );
}

export const ADDRESSES: RobinAddresses = robinAddressesFrom(deployment);

const BASE_CHAINS: Record<NetworkKey, Chain> = {
  local: defineChain({
    id: 31337,
    name: "Anvil",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  }),
  "robinhood-testnet": defineChain({
    id: 46630,
    name: "Robinhood Chain Testnet",
    testnet: true,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: ["https://rpc.testnet.chain.robinhood.com"] },
    },
    blockExplorers: {
      default: {
        name: "Blockscout",
        url: "https://explorer.testnet.chain.robinhood.com",
      },
    },
    contracts: {
      multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
    },
  }),
  robinhood: defineChain({
    id: 4663,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
    },
    blockExplorers: {
      default: {
        name: "Blockscout",
        url: "https://robinhoodchain.blockscout.com",
      },
    },
    contracts: {
      multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
    },
  }),
};

/** The active chain, with Robin wired in as its ENS. */
export const CHAIN = withRobin(BASE_CHAINS[NETWORK], ADDRESSES);

export const EXPLORER = CHAIN.blockExplorers?.default.url;

export const INDEXER_URL =
  import.meta.env.VITE_INDEXER_URL ?? "http://localhost:42069";

/**
 * REST endpoints (/verify, /tickers). Same host as the indexer — except in
 * the same-origin production build (empty INDEXER_URL), where /tickers would
 * collide with the SPA route of the same name, so we call the api domain.
 */
export const API_URL =
  INDEXER_URL === "" ? "https://api.dotrobin.xyz" : INDEXER_URL;

/** Premium auction length per network (oracle constructor parameter). */
export const PREMIUM_DAYS = NETWORK === "robinhood-testnet" ? 2 : 21;

const wcProjectId = import.meta.env.VITE_WC_PROJECT_ID as string | undefined;

export const wagmiConfig = createConfig({
  chains: [CHAIN],
  connectors: [
    injected(),
    ...(wcProjectId ? [walletConnect({ projectId: wcProjectId })] : []),
  ],
  transports: { [CHAIN.id]: http() },
});
