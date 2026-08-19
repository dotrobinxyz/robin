import type { Address } from "viem";

/** Every Robin contract for one deployment. */
export type RobinAddresses = {
  registry: Address;
  baseRegistrar: Address;
  controller: Address;
  priceOracle: Address;
  wrapper: Address;
  metadata: Address;
  reservedList: Address;
  publicResolver: Address;
  reverseRegistrar: Address;
  defaultReverseRegistrar: Address;
  universalResolver: Address;
  usdg: Address;
};

const ZERO = "0x0000000000000000000000000000000000000000" as const;

/**
 * Canonical deployments by chain id.
 *
 * - 4663  — Robinhood Chain mainnet (populated at mainnet deploy)
 * - 46630 — Robinhood Chain testnet
 *
 * For a local/anvil deployment, build your own with `robinAddressesFrom`
 * using the deploy script's deployments/robin-local.json.
 */
export const ROBIN_ADDRESSES: Record<number, RobinAddresses> = {
  4663: {
    registry: ZERO,
    baseRegistrar: ZERO,
    controller: ZERO,
    priceOracle: ZERO,
    wrapper: ZERO,
    metadata: ZERO,
    reservedList: ZERO,
    publicResolver: ZERO,
    reverseRegistrar: ZERO,
    defaultReverseRegistrar: ZERO,
    universalResolver: ZERO,
    usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  },
  46630: {
    registry: "0x8705DEC51223E119C5C9f03121626d086A8eF753",
    baseRegistrar: "0x78443cD8242AfCC56F8779a1D9acB8971cD67ac8",
    controller: "0x042C39d404C58528963E691a6befC905511a3Dcb",
    priceOracle: "0x6ab29612665a93682a3C6d64f1523f6991723111",
    wrapper: "0xB1125eb75343054722881F995FE961f93290e1aF",
    metadata: "0x525c188297509941f6f97Cd0ff639cD3011Cb886",
    reservedList: "0x0e558E92D0B4B93C450f4a48EB95Ed3f467ce6de",
    publicResolver: "0x293758cf47CE956fbeD160E54259Af2549faa090",
    reverseRegistrar: "0x818145E450422484c240a7294de5f71e3A39e4F4",
    defaultReverseRegistrar: "0x7eBd20420BaDa148A053545Cc284B71f6599FA55",
    universalResolver: "0x7112730612e4253Ba2e418A86580615A2c3CDB1D",
    usdg: "0x8B0E0ff53C68D738f91b81fC602554c936325Ca6", // mock USDG (testnet has no canonical USDG)
  },
};

/** Maps a deployments/robin-<network>.json record to RobinAddresses. */
export function robinAddressesFrom(deployment: {
  RobinRegistry: Address;
  RobinBaseRegistrar: Address;
  RobinRegistrarController: Address;
  RobinPriceOracle: Address;
  RobinWrapper: Address;
  RobinMetadata: Address;
  RobinReservedList: Address;
  PublicResolver: Address;
  ReverseRegistrar: Address;
  DefaultReverseRegistrar: Address;
  UniversalResolver: Address;
  usdg: Address;
}): RobinAddresses {
  return {
    registry: deployment.RobinRegistry,
    baseRegistrar: deployment.RobinBaseRegistrar,
    controller: deployment.RobinRegistrarController,
    priceOracle: deployment.RobinPriceOracle,
    wrapper: deployment.RobinWrapper,
    metadata: deployment.RobinMetadata,
    reservedList: deployment.RobinReservedList,
    publicResolver: deployment.PublicResolver,
    reverseRegistrar: deployment.ReverseRegistrar,
    defaultReverseRegistrar: deployment.DefaultReverseRegistrar,
    universalResolver: deployment.UniversalResolver,
    usdg: deployment.usdg,
  };
}

export function getRobinAddresses(chainId: number): RobinAddresses {
  const addresses = ROBIN_ADDRESSES[chainId];
  if (!addresses || addresses.registry === ZERO) {
    throw new Error(
      `Robin is not deployed on chain ${chainId} in this SDK version — ` +
        `pass addresses explicitly (robinAddressesFrom) or upgrade robin-names.`,
    );
  }
  return addresses;
}
