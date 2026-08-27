import { parseAbi } from "viem";
import { NETWORK } from "../config";

/**
 * RobinSubnameShop — names that earn. Singleton, adminless; sellers open a
 * shop on a locked wrapped name, buyers self-serve mint emancipated
 * subnames. 90% to the seller, 10% to the protocol treasury, in-transaction.
 */

export const SHOP_ADDRESS: `0x${string}` | undefined =
  NETWORK === "robinhood"
    ? "0x092c412d6fcdf9484D1396889b588B43382463fa"
    : undefined;

export const shopAbi = parseAbi([
  "struct Listing { address seller; uint256 priceUSDG; uint256 priceETH; }",
  "function listings(bytes32 parentNode) view returns (address seller, uint256 priceUSDG, uint256 priceETH)",
  "function openShop(bytes32 parentNode, uint256 priceUSDG, uint256 priceETH)",
  "function closeShop(bytes32 parentNode)",
  "function buyWithETH(bytes32 parentNode, string label) payable returns (bytes32)",
  "function buyWithUSDG(bytes32 parentNode, string label) returns (bytes32)",
  "function treasury() view returns (address)",
  "function FEE_BPS() view returns (uint256)",
]);
