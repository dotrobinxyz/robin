import { encodeAbiParameters, parseAbi, type Hex } from "viem";

/**
 * ROBIN trades on Uniswap v4. This routes exactly ONE pool — the canonical
 * ETH/ROBIN pool with real liquidity — through the canonical UniversalRouter,
 * never the PONS periphery. The PoolKey below is keccak-verified against the
 * live pool id; the pool's PONS fee hook (V2MemeHook) skims output, but the
 * router's amountOutMinimum makes anything beyond the quoted+slippage take
 * revert on-chain.
 */
export const ROBIN_TOKEN = "0x4f3b422051a7d183A017898179961c9e9d50ac7c" as const;
export const UNIVERSAL_ROUTER = "0x40d6bdac60c0810fC3ed30a988A4c3ac890fdd43" as const;
export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
export const V4_QUOTER = "0x08A50911bac753b7e11a7e5631afA19F14C1Af55" as const;
export const STATE_VIEW = "0x0284Cb0bcbaa8B87A8AA409D0e41afA7a76355F2" as const;

export const POOL_ID =
  "0x66391572735679fcd5495729626c089dafd57c384af61e2c4ca1bfc7d257bcb6" as const;

export const POOL_KEY = {
  currency0: "0x0000000000000000000000000000000000000000",
  currency1: ROBIN_TOKEN,
  fee: 0,
  tickSpacing: 200,
  hooks: "0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044",
} as const;

export const quoterAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteExactSingleParams params) view returns (uint256 amountOut, uint256 gasEstimate)",
]);

export const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
]);

export const universalRouterAbi = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
]);

export const permit2Abi = parseAbi([
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
]);

const POOL_KEY_COMPONENTS = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] as const;

/**
 * UniversalRouter calldata for a single-pool v4 exact-in swap:
 * command V4_SWAP (0x10); actions SWAP_EXACT_IN_SINGLE (0x06) +
 * SETTLE_ALL (0x0c) + TAKE_ALL (0x0f). Output goes to the caller.
 */
export function encodeV4Swap(
  zeroForOne: boolean,
  amountIn: bigint,
  minOut: bigint,
): { commands: Hex; inputs: Hex[] } {
  const swapParams = encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "poolKey", type: "tuple", components: POOL_KEY_COMPONENTS },
          { name: "zeroForOne", type: "bool" },
          { name: "amountIn", type: "uint128" },
          { name: "amountOutMinimum", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    [
      {
        poolKey: POOL_KEY,
        zeroForOne,
        amountIn,
        amountOutMinimum: minOut,
        hookData: "0x",
      },
    ],
  );
  const inCurrency = zeroForOne ? POOL_KEY.currency0 : POOL_KEY.currency1;
  const outCurrency = zeroForOne ? POOL_KEY.currency1 : POOL_KEY.currency0;
  const settle = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [inCurrency, amountIn],
  );
  const take = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [outCurrency, minOut],
  );
  const input = encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    ["0x060c0f", [swapParams, settle, take]],
  );
  return { commands: "0x10", inputs: [input] };
}

/** Spot price (ROBIN per ETH) from slot0's sqrtPriceX96. */
export function spotFromSqrtPrice(sqrtPriceX96: bigint): number {
  const s = Number(sqrtPriceX96) / 2 ** 96;
  return s * s;
}
