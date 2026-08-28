import { parseAbi } from "viem";

/** RobinGoldBand — deployed 2026-08-28, verified. Treasury = Safe; burn half
 *  accrues at RobinBurnVault 0x2E5BB9d71576cBA89557Cefe4eBE6d2339CFDe07. */
export const GOLD_BAND = "0x0dA8923A6920c2158cdE378e9aBcCa8a997f5268" as const;

export const goldAbi = parseAbi([
  "function isGold(bytes32 node) view returns (bool)",
  "function goldUntil(bytes32 node) view returns (uint256)",
  "function priceInUSDG(uint256 periods, bool yearly) pure returns (uint256)",
  "function priceInWei(uint256 periods, bool yearly) view returns (uint256)",
  "function extendWithUSDG(bytes32 node, uint256 periods, bool yearly)",
  "function extendWithETH(bytes32 node, uint256 periods, bool yearly) payable",
]);
