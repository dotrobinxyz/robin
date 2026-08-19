import { defineChain, type Chain } from "viem";
import { ROBIN_ADDRESSES, type RobinAddresses } from "./addresses.js";

const ZERO = "0x0000000000000000000000000000000000000000";

function ensContracts(addresses: RobinAddresses | undefined) {
  if (!addresses || addresses.registry === ZERO) return {};
  return {
    ensRegistry: { address: addresses.registry },
    ensUniversalResolver: { address: addresses.universalResolver },
  };
}

/**
 * Robinhood Chain mainnet (4663), with Robin wired in as the chain's ENS —
 * `getEnsName`, `getEnsAddress`, `getEnsText`, `getEnsAvatar` and every
 * other viem/wagmi ENS action work out of the box against .robin names.
 */
export const robinhoodChain: Chain = defineChain({
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
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
    ...ensContracts(ROBIN_ADDRESSES[4663]),
  },
});

/** Robinhood Chain testnet (46630), Robin wired in. */
export const robinhoodChainTestnet: Chain = defineChain({
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
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
    ...ensContracts(ROBIN_ADDRESSES[46630]),
  },
});

/**
 * Wires Robin resolution into any viem Chain object — the one-line
 * integration for dapps that already have their own chain config:
 *
 * ```ts
 * import { withRobin } from "robin-names";
 * const chain = withRobin(myRobinhoodChainConfig);
 * // viem's getEnsName / getEnsAddress now resolve .robin
 * ```
 */
export function withRobin(
  chain: Chain,
  addresses?: RobinAddresses,
): Chain {
  const robin = addresses ?? ROBIN_ADDRESSES[chain.id];
  if (!robin || robin.registry === ZERO) {
    throw new Error(
      `No Robin deployment known for chain ${chain.id} — pass addresses explicitly.`,
    );
  }
  return {
    ...chain,
    contracts: {
      ...chain.contracts,
      ensRegistry: { address: robin.registry },
      ensUniversalResolver: { address: robin.universalResolver },
    },
  };
}
