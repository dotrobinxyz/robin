import { useMemo, useState } from "react";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { erc20Abi, formatEther, parseEther } from "viem";
import { useQuery } from "@tanstack/react-query";
import { CHAIN } from "../config";
import { formatEth } from "../lib/format";
import { useTx } from "../lib/useTx";
import {
  PERMIT2,
  POOL_ID,
  POOL_KEY,
  ROBIN_TOKEN,
  STATE_VIEW,
  UNIVERSAL_ROUTER,
  V4_QUOTER,
  encodeV4Swap,
  permit2Abi,
  quoterAbi,
  spotFromSqrtPrice,
  stateViewAbi,
  universalRouterAbi,
} from "../lib/swap";

const SLIPPAGE_BPS = 100n; // 1%
const MAX_UINT160 = (1n << 160n) - 1n;
const MAX_UINT48 = (1n << 48n) - 1n;

function fmtRobin(units: bigint): string {
  const n = Number(formatEther(units));
  return `${n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 0 : 2 })} ROBIN`;
}

export function TradeTab() {
  const { address, isConnected } = useAccount();
  const { run, busy, error, walletClient, publicClient } = useTx();
  const [buying, setBuying] = useState(true); // true: ETH -> ROBIN
  const [amount, setAmount] = useState("");
  const [done, setDone] = useState("");

  const { data: ethBal, refetch: refetchEth } = useBalance({
    address,
    query: { enabled: Boolean(address) },
  });
  const { data: robinBal, refetch: refetchRobin } = useReadContract({
    address: ROBIN_TOKEN,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address!],
    query: { enabled: Boolean(address) },
  });

  const amountIn = useMemo(() => {
    const t = amount.trim();
    if (!t || !/^\d*\.?\d+$/.test(t)) return null;
    try {
      const u = parseEther(t);
      return u > 0n ? u : null;
    } catch {
      return null;
    }
  }, [amount]);

  const balance = buying ? (ethBal?.value ?? 0n) : (robinBal ?? 0n);
  const insufficient = amountIn !== null && amountIn > balance;

  const { data: quote } = useQuery({
    queryKey: ["swap-quote", buying, amountIn?.toString()],
    enabled: Boolean(publicClient && amountIn),
    refetchInterval: 15_000,
    queryFn: async () => {
      const [out] = await publicClient!.readContract({
        address: V4_QUOTER,
        abi: quoterAbi,
        functionName: "quoteExactInputSingle",
        args: [
          {
            poolKey: POOL_KEY,
            zeroForOne: buying,
            exactAmount: amountIn!,
            hookData: "0x",
          },
        ],
      });
      const [sqrtPriceX96] = await publicClient!.readContract({
        address: STATE_VIEW,
        abi: stateViewAbi,
        functionName: "getSlot0",
        args: [POOL_ID],
      });
      const spot = spotFromSqrtPrice(sqrtPriceX96); // ROBIN per ETH
      const inN = Number(formatEther(amountIn!));
      const outN = Number(formatEther(out));
      const exec = outN / inN;
      const fair = buying ? spot : 1 / spot;
      const impact = Math.max(0, (1 - exec / fair) * 100);
      return { out, impact };
    },
  });

  const minOut = quote ? (quote.out * (10_000n - SLIPPAGE_BPS)) / 10_000n : null;

  async function swap() {
    if (!walletClient || !publicClient || !address || !amountIn || !minOut) return;
    setDone("");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const { commands, inputs } = encodeV4Swap(buying, amountIn, minOut);

    if (buying) {
      await run(
        "swap",
        [
          async () =>
            walletClient.writeContract({
              address: UNIVERSAL_ROUTER,
              abi: universalRouterAbi,
              functionName: "execute",
              args: [commands, inputs, deadline],
              value: amountIn,
              chain: CHAIN,
              account: address,
            }),
        ],
        onSwapped,
      );
    } else {
      // Selling ROBIN pulls it through Permit2 — two one-time approvals.
      const erc20Allowance = await publicClient.readContract({
        address: ROBIN_TOKEN,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, PERMIT2],
      });
      const [p2Amount, p2Expiration] = await publicClient.readContract({
        address: PERMIT2,
        abi: permit2Abi,
        functionName: "allowance",
        args: [address, ROBIN_TOKEN, UNIVERSAL_ROUTER],
      });
      const now = BigInt(Math.floor(Date.now() / 1000));
      const needsP2 = p2Amount < amountIn || BigInt(p2Expiration) <= now;
      await run(
        "swap",
        [
          async () =>
            erc20Allowance >= amountIn
              ? null
              : walletClient.writeContract({
                  address: ROBIN_TOKEN,
                  abi: erc20Abi,
                  functionName: "approve",
                  args: [PERMIT2, 2n ** 256n - 1n],
                  chain: CHAIN,
                  account: address,
                }),
          async () =>
            !needsP2
              ? null
              : walletClient.writeContract({
                  address: PERMIT2,
                  abi: permit2Abi,
                  functionName: "approve",
                  args: [ROBIN_TOKEN, UNIVERSAL_ROUTER, MAX_UINT160, Number(MAX_UINT48)],
                  chain: CHAIN,
                  account: address,
                }),
          async () =>
            walletClient.writeContract({
              address: UNIVERSAL_ROUTER,
              abi: universalRouterAbi,
              functionName: "execute",
              args: [commands, inputs, deadline],
              chain: CHAIN,
              account: address,
            }),
        ],
        onSwapped,
      );
    }
  }

  function onSwapped() {
    setDone(
      `Swapped. ${amount} ${buying ? "ETH" : "ROBIN"} → ~${
        quote ? (buying ? fmtRobin(quote.out) : formatEth(quote.out)) : ""
      }`,
    );
    setAmount("");
    refetchEth();
    refetchRobin();
  }

  if (!isConnected) {
    return <div className="empty">connect a wallet to trade.</div>;
  }

  return (
    <>
      <div className="card">
        <div className="row between" style={{ marginBottom: 12 }}>
          <h3 className="card-title" style={{ margin: 0 }}>
            {buying ? "Buy ROBIN." : "Sell ROBIN."}
          </h3>
          <div className="chips">
            <button className={`chip${buying ? " on" : ""}`} onClick={() => { setBuying(true); setDone(""); }}>
              buy
            </button>
            <button className={`chip${buying ? "" : " on"}`} onClick={() => { setBuying(false); setDone(""); }}>
              sell
            </button>
          </div>
        </div>
        {done && <div className="toast">{done}</div>}
        <div className="field">
          <label>you pay ({buying ? "ETH" : "ROBIN"})</label>
          <input
            className="input mono"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <p className="small muted mono" style={{ margin: "6px 0 0" }}>
            balance {buying ? formatEth(balance) : fmtRobin(balance)}
          </p>
          {insufficient && (
            <p className="small" style={{ color: "#e08a7e", margin: "4px 0 0" }}>
              not enough {buying ? "ETH" : "ROBIN"}
            </p>
          )}
        </div>
        <div className="field">
          <label>you receive (est.)</label>
          <p className="mono" style={{ margin: 0, fontSize: 18 }}>
            {!amountIn ? "—" : quote ? (buying ? fmtRobin(quote.out) : formatEth(quote.out)) : "…"}
          </p>
          {quote && minOut !== null && (
            <p className="small muted mono" style={{ margin: "6px 0 0" }}>
              min received {buying ? fmtRobin(minOut) : formatEth(minOut)} · impact+fees{" "}
              {quote.impact.toFixed(1)}%
            </p>
          )}
        </div>
        {quote && quote.impact > 3 && (
          <p className="notice danger" style={{ marginBottom: 12 }}>
            thin pool — this order moves the price {quote.impact.toFixed(1)}%. the swap
            reverts if you'd get less than the minimum shown.
          </p>
        )}
        <button
          className="btn block"
          onClick={swap}
          disabled={busy !== null || !amountIn || !quote || insufficient}
        >
          {busy ? <span className="progress-ring" /> : null}
          {!amountIn ? "enter an amount" : buying ? "buy ROBIN" : "sell ROBIN"}
        </button>
        {error && (
          <p className="notice danger" style={{ marginTop: 10 }}>
            {error}
          </p>
        )}
      </div>
      <p className="small muted" style={{ margin: "0 4px" }}>
        routes only the canonical ETH/ROBIN pool on Uniswap v4 via the UniversalRouter,
        with a hard minimum-received guard (1% slippage). ROBIN is a small memecoin pool —
        prices move fast; nothing here is financial advice.
      </p>
    </>
  );
}
