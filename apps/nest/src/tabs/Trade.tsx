import { useMemo, useState } from "react";
import { useBalance, useReadContract } from "wagmi";
import { useActive } from "../lib/activeAccount";
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
  netAfterFee,
  permit2Abi,
  quoterAbi,
  spotFromSqrtPrice,
  stateViewAbi,
  universalRouterAbi,
} from "../lib/swap";

const SLIPPAGE_BPS = 100n; // 1%
const MAX_UINT160 = (1n << 160n) - 1n;
const MAX_UINT48 = (1n << 48n) - 1n;

/** 2.1M / 645.8K style, for meme-scale ROBIN amounts. */
function compact(units: bigint): string {
  const n = Number(formatEther(units));
  if (n >= 1e6) return `${(n / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`;
  if (n >= 1e3) return `${(n / 1e3).toLocaleString("en-US", { maximumFractionDigits: 1 })}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function EthIcon() {
  return (
    <svg className="token-ico" viewBox="0 0 16 16" fill="none">
      <path d="M8 1.5v4.87L3.9 8.2 8 1.5z" fill="#8C8578" />
      <path d="M8 1.5l4.1 6.7L8 6.37V1.5z" fill="#F1EADF" />
      <path d="M8 9.1L3.9 8.2 8 14.5V9.1z" fill="#8C8578" />
      <path d="M8 9.1v5.4l4.1-6.3L8 9.1z" fill="#F1EADF" />
      <path d="M3.9 8.2L8 6.37 12.1 8.2 8 9.1 3.9 8.2z" fill="#B7AE9E" />
    </svg>
  );
}

function TokenChip({ eth }: { eth: boolean }) {
  return (
    <span className="token-chip">
      {eth ? <EthIcon /> : <img className="token-ico" src="/nest/mark.svg" alt="" />}
      {eth ? "ETH" : "ROBIN"}
    </span>
  );
}

export function TradeTab() {
  const active = useActive();
  const address = active.address;
  const isConnected = active.kind !== "none";
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
          { poolKey: POOL_KEY, zeroForOne: buying, exactAmount: amountIn!, hookData: "0x" },
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
      const fair = buying ? spot : 1 / spot;
      const impact = Math.max(0, (1 - outN / inN / fair) * 100);
      return { out, impact, spot };
    },
  });

  // Spot rate for the footer line even before an amount is typed.
  const { data: spotOnly } = useQuery({
    queryKey: ["swap-spot"],
    enabled: Boolean(publicClient),
    refetchInterval: 30_000,
    queryFn: async () => {
      const [sqrtPriceX96] = await publicClient!.readContract({
        address: STATE_VIEW,
        abi: stateViewAbi,
        functionName: "getSlot0",
        args: [POOL_ID],
      });
      return spotFromSqrtPrice(sqrtPriceX96);
    },
  });

  const minOut = quote ? (quote.out * (10_000n - SLIPPAGE_BPS)) / 10_000n : null;
  const spot = quote?.spot ?? spotOnly;
  const rate =
    spot === undefined
      ? null
      : buying
        ? `1 ETH ≈ ${compact(parseEther(String(Math.round(spot))))} ROBIN`
        : `1M ROBIN ≈ ${formatEth(parseEther(String((1e6 / spot).toFixed(8))))}`;

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
      `swapped ✓ ${amount} ${buying ? "ETH" : "ROBIN"} → ~${
        quote
          ? buying
            ? `${compact(netAfterFee(quote.out))} ROBIN`
            : formatEth(netAfterFee(quote.out))
          : ""
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
      <div className="h1">Trade.</div>
      <div className="card">
        {done && <div className="toast">{done}</div>}

        <div className="trade-box">
          <label>pay</label>
          <div className="row" style={{ gap: 10 }}>
            <input
              className="trade-amt"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <TokenChip eth={buying} />
          </div>
          <button
            className="trade-balance"
            onClick={() => setAmount(formatEther(balance))}
          >
            balance {buying ? formatEth(balance).replace(" ETH", "") : compact(balance)}
          </button>
          {insufficient && (
            <p className="small" style={{ color: "#e08a7e", margin: "4px 0 0" }}>
              not enough {buying ? "ETH" : "ROBIN"}
            </p>
          )}
        </div>

        <div className="flip-wrap">
          <button
            className="flip-btn"
            title="flip"
            onClick={() => {
              setBuying(!buying);
              setAmount("");
              setDone("");
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 4v16" />
              <path d="M6 14l6 6 6-6" />
            </svg>
          </button>
        </div>

        <div className="trade-box">
          <label>receive</label>
          <div className="row" style={{ gap: 10 }}>
            <span className="trade-amt out">
              {!amountIn
                ? "—"
                : quote
                  ? `≈ ${
                      buying
                        ? compact(netAfterFee(quote.out))
                        : formatEth(netAfterFee(quote.out)).replace(" ETH", "")
                    }`
                  : "…"}
            </span>
            <TokenChip eth={!buying} />
          </div>
        </div>

        <p className="rate-line">
          {rate ?? "…"} · slippage 1% · 0.5% app fee
          {quote && quote.impact > 3 && (
            <span style={{ color: "#e08a7e" }}> · moves price {quote.impact.toFixed(1)}%</span>
          )}
        </p>

        <button
          className="btn block"
          onClick={swap}
          disabled={busy !== null || !amountIn || !quote || insufficient}
        >
          {busy ? <span className="progress-ring" /> : null} swap
        </button>
        {error && (
          <p className="notice danger" style={{ marginTop: 10 }}>
            {error}
          </p>
        )}
      </div>
      <p className="rate-line" style={{ marginTop: 0 }}>
        routed via robinhood chain dexes
      </p>
    </>
  );
}
