import { http, createConfig } from "wagmi";
import { injected, metaMask } from "wagmi/connectors";
import { defineChain } from "viem";
import { robinAddressesFrom, withRobin, type RobinAddresses } from "robin-names";

// Nest is mainnet-only: the pocket companion for live names.
const DEPLOYMENT = {
  DefaultReverseRegistrar: "0x3C0ae4a25307c66Fb5f558DF592cc4B70E42ffaa",
  GatewayProvider: "0xf1702Bc3441c87f51c01C035BC2aDA49eBF8a011",
  PublicResolver: "0x859fe65f2d58182C72E6B7Ca54e32c9a16d5bF04",
  ReverseRegistrar: "0x489ae7566b8E48C9B6F922DAe7a6c9c552B57C47",
  RobinBaseRegistrar: "0x218CCD54F64cdcB7d0B6e45eA4665846df01Ad5C",
  RobinMetadata: "0x8b002607cAA9c4fc96b137dfE81d062D1012485D",
  RobinPriceOracle: "0x38507fc485d269914A2DCCEF4973f9e572473730",
  RobinRegistrarController: "0x9080E579fa9776EFe4531004aBe78D8f25480f77",
  RobinRegistry: "0x29d8cEae06c4F97c784BD016A41eB45c9A2d6aE1",
  RobinReservedList: "0xE458B7c0f88A746baeaa9b2a687e6F3d8E1Ba3Eb",
  RobinWrapper: "0x2Ad2590817Dde5A070849DdFBB38959153D7B282",
  UniversalResolver: "0x1C336914666256e2c5131FB460C598F2EAB0292B",
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
} as const;

export const ADDRESSES: RobinAddresses = robinAddressesFrom(DEPLOYMENT);

const base = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});

export const CHAIN = withRobin(base, ADDRESSES);
export const EXPLORER = "https://robinhoodchain.blockscout.com";
export const INDEXER_URL = "https://api.dotrobin.xyz";
export const SITE = "https://dotrobin.xyz";

export const wagmiConfig = createConfig({
  chains: [CHAIN],
  // injected covers in-wallet browsers + extensions; metaMask (SDK) covers
  // Chrome/installed-PWA where no provider is injected — it deeplinks to the
  // MetaMask app and relays the session back.
  connectors: [
    injected(),
    metaMask({
      dappMetadata: {
        name: "nest — .robin",
        url: `${SITE}/nest/`,
        iconUrl: `${SITE}/nest/icon-512.png`,
      },
    }),
  ],
  transports: { [CHAIN.id]: http() },
});
