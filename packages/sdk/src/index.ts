// robin-names — resolve and register .robin names on Robinhood Chain.
//
// One-line dapp integration:
//   import { createPublicClient, http } from "viem";
//   import { robinhoodChain } from "robin-names";
//   const client = createPublicClient({ chain: robinhoodChain, transport: http() });
//   await client.getEnsName({ address: "0x..." });   // → "trader.robin"

export {
  robinhoodChain,
  robinhoodChainTestnet,
  withRobin,
} from "./chains.js";

export {
  ROBIN_ADDRESSES,
  getRobinAddresses,
  robinAddressesFrom,
  type RobinAddresses,
} from "./addresses.js";

export {
  getRobinName,
  getRobinAddress,
  getRobinText,
  getRobinAvatar,
} from "./actions.js";

export {
  ROBIN_NODE,
  REVERSE_RECORD_NONE,
  REVERSE_RECORD_CHAIN,
  REVERSE_RECORD_DEFAULT,
  SECONDS_PER_YEAR,
  MIN_REGISTRATION_DURATION_MAINNET,
  MAX_REGISTRATION_DURATION,
  type Registration,
  makeRegistration,
  makeCommitment,
  randomSecret,
  robinNode,
  robinTokenId,
  validateLabel,
} from "./registration.js";

export {
  DEFAULT_API_URL,
  verifyName,
  getTickers,
  getTicker,
  type ApiOptions,
  type VerifyChecks,
  type VerifyResult,
  type TickerInfo,
  type TickerListing,
} from "./verify.js";

export { normalize, namehash, labelhash } from "viem/ens";

export * from "./generated/abis.js";
